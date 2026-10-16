import "server-only";
import type { MasterRow } from "@/lib/master-csv";
import { getLookups } from "@/lib/data";
import {
  buildHealthRows,
  buildPriceRows,
  buildReturnRates,
  DEFAULT_FLIPKART_SETTINGS,
  returnHistoryReady,
  type Cover,
  type CoverState,
  type FlipkartSettings,
  type HealthRow,
  type PriceChange,
  type PriceInput,
  type PriceRow,
  type ReturnRate,
} from "@/lib/flipkart-analysis";
import { COVER_HISTORY_DAYS, coverBySku, coversPerWarehouse, type DispatchRow } from "@/lib/cover";
import { readForecast, type ForecastRaw } from "@/lib/forecast";
import { addDays, todayIST } from "@/lib/format";
import { NOT_FOUND_DAYS } from "@/lib/new-listing";
import { logError } from "@/lib/redact";
import { SETTING_KEYS } from "@/lib/settings-keys";
import { createClient } from "@/lib/supabase/server";
import { RUN_COLUMNS, toRun, type OrderSyncState, type RunRowRaw } from "@/lib/orders-sync";
import type { SessionUser } from "@/lib/types";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const PAGE = 1000;

/** Reads every row of a query, 1000 at a time (the API's own limit). The query must have a stable order. */
async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

export type MasterData = {
  products: { id: string; code: string | null; name: string }[];
  links: { sku: string; masterId: string; units: number }[];
  /** SKUs taken out of the checks ("Removed"). */
  removed: string[];
};

/** The master SKUs: products, which channel SKUs belong to them (with units per order), and removed SKUs. */
export async function loadMasterData(supabase: Supabase): Promise<MasterData> {
  try {
    const [products, links, removed] = await Promise.all([
      fetchAll<{ id: string; code: string | null; name: string }>((from, to) => supabase.from("master_products").select("id, code, name").order("id").range(from, to)),
      fetchAll<{ channel_sku: string; master_id: string; units_per_order: number }>((from, to) =>
        supabase.from("sku_master").select("channel_sku, master_id, units_per_order").order("channel_sku").range(from, to),
      ),
      fetchAll<{ channel_sku: string }>((from, to) => supabase.from("sku_excluded").select("channel_sku").order("channel_sku").range(from, to)),
    ]);
    return {
      products,
      links: links.map((l) => ({ sku: l.channel_sku, masterId: l.master_id, units: l.units_per_order })),
      removed: removed.map((r) => r.channel_sku),
    };
  } catch (error) {
    return fail("master products", error);
  }
}

/** Every Flipkart listing's SKU and title. */
export async function loadListingTitles(supabase: Supabase): Promise<{ sku: string; title: string | null }[]> {
  try {
    return await fetchAll<{ sku: string; title: string | null }>((from, to) => supabase.from("stock_listings").select("sku, title").eq("platform", "flipkart").order("sku").range(from, to));
  } catch (error) {
    return fail("listing titles", error);
  }
}

/** The mapping as rows (product name, SKU, units) for grouping and matching. */
export function masterRows(data: MasterData): MasterRow[] {
  const byId = new Map(data.products.map((p) => [p.id, p]));
  return data.links.flatMap((l) => {
    const p = byId.get(l.masterId);
    return p ? [{ master: p.name, sku: l.sku, units: l.units, ...(p.code ? { code: p.code } : {}) }] : [];
  });
}

function fail(where: string, error: unknown): never {
  logError(where, error);
  throw new Error("Could not load the Flipkart page");
}

function whole(value: unknown, fallback: number, min = 0): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
}

export async function loadFlipkartSettings(supabase: Supabase): Promise<FlipkartSettings> {
  const { data, error } = await supabase.from("app_settings").select("key, value").in("key", SETTING_KEYS);
  if (error) fail("flipkart settings", error);
  const d = DEFAULT_FLIPKART_SETTINGS;
  const out = { ...d };
  for (const row of data ?? []) {
    if (row.key === "price_drop_percent") out.priceDropPercent = whole(row.value, d.priceDropPercent, 1);
    if (row.key === "dispatch_sla_days") out.dispatchSlaDays = whole(row.value, d.dispatchSlaDays, 1);
    if (row.key === "running_out_days") out.runningOutDays = whole(row.value, d.runningOutDays, 1);
    if (row.key === "new_inactive_days") out.newInactiveDays = whole(row.value, d.newInactiveDays, 1);
    if (row.key === "return_rate_percent") out.returnRatePercent = whole(row.value, d.returnRatePercent, 1);
  }
  return out;
}

// --- Pending orders ------------------------------------------------------------------------------------------

/** Shipped and not yet delivered, per warehouse ID (Seller Hub's In Transit, as a count). */
export async function loadInTransit(supabase: Supabase): Promise<Record<string, number>> {
  const { data, error } = await supabase.rpc("flipkart_in_transit");
  if (error) fail("in transit", error);
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as { warehouse_id: string | null; shipments: number }[]) {
    if (r.warehouse_id) out[r.warehouse_id] = Number(r.shipments) || 0;
  }
  return out;
}

// --- Sync runs -------------------------------------------------------------------------------------------------------

/** The sync state for the page and for the progress poll. Throws on a database error. */
export async function readOrderSyncState(supabase: Supabase, canSeeError: boolean): Promise<OrderSyncState> {
  const runs = () => supabase.from("order_runs").select(RUN_COLUMNS);
  const lastDone = (kind: "pending" | "daily" | "upcoming") => runs().eq("kind", kind).eq("status", "done").order("finished_at", { ascending: false }).limit(1);
  const [latest, pending, daily, upcoming, backfill] = await Promise.all([
    runs().neq("kind", "backfill").order("created_at", { ascending: false }).limit(1),
    lastDone("pending"),
    lastDone("daily"),
    lastDone("upcoming"),
    runs().eq("kind", "backfill").order("created_at", { ascending: false }).limit(1),
  ]);
  const err = latest.error ?? pending.error ?? daily.error ?? upcoming.error ?? backfill.error;
  if (err) throw new Error(err.message);
  const one = (r: { data: RunRowRaw[] | null }) => (r.data?.[0] ? toRun(r.data[0], canSeeError) : null);
  return { latest: one(latest), lastPending: one(pending), lastDaily: one(daily), lastUpcoming: one(upcoming), backfill: one(backfill) };
}

export async function loadOrderSyncState(supabase: Supabase, canSeeError: boolean): Promise<OrderSyncState> {
  try {
    return await readOrderSyncState(supabase, canSeeError);
  } catch (error) {
    return fail("order sync state", error);
  }
}

// --- Returns ---------------------------------------------------------------------------------------------------------------
// The list and its totals are read a page at a time: see src/server/returns-view.ts.

export async function loadReturnRates(
  supabase: Supabase,
  settings: FlipkartSettings,
  today: string,
  coverageFrom?: string | null,
): Promise<{ rates: ReturnRate[]; historyReady: boolean; coverageFrom: string | null }> {
  const [rates, coverage] = await Promise.all([
    supabase.rpc("flipkart_return_rates", { p_days: 30 }),
    coverageFrom !== undefined
      ? Promise.resolve({ data: coverageFrom, error: null })
      : supabase.from("order_runs").select("coverage_from").eq("kind", "backfill").not("coverage_from", "is", null).order("created_at", { ascending: false }).limit(1).then((r) => ({ data: r.data?.[0]?.coverage_from ?? null, error: r.error })),
  ]);
  if (rates.error || coverage.error) fail("return rates", rates.error ?? coverage.error);
  const from = (coverage.data as string | null) ?? null;
  const historyReady = returnHistoryReady(from, today);
  return { rates: buildReturnRates(rates.data, settings, historyReady), historyReady, coverageFrom: from };
}

// --- Days of cover ---------------------------------------------------------------------------------------------------------------

export type CoverData = {
  covers: Cover[];
  state: CoverState;
  /** Every SKU's cover over all warehouses. A scoped version is made with coverBySku(raw, days, ids). */
  soonest: Record<string, Cover>;
  coverageFrom: string | null;
  /** The dispatch rows the covers come from (units dispatched and stock per SKU and warehouse). */
  raw: DispatchRow[];
  /** The same rows with the product title, for lists that show it. */
  forecast: ForecastRaw[];
  days: number;
};

/**
 * Days of cover: ONE calculation (src/lib/cover.ts) from the same dispatch history the Forecasting tab uses: units
 * dispatched per day over the last 30 complete days, and the stock there is now. Row level security means a warehouse
 * user's numbers cover only their own warehouses.
 */
export async function loadCover(supabase: Supabase): Promise<CoverData> {
  const { data, error } = await supabase.rpc("flipkart_forecast", { p_days: 30 });
  if (error) fail("days of cover", error);
  const parsed = readForecast(data);
  if (!parsed) fail("days of cover", new Error("unreadable forecast"));
  const { meta, raw } = parsed as NonNullable<typeof parsed>;
  const rows: DispatchRow[] = raw.map((r) => ({ sku: r.sku, wid: r.wid, disp: r.disp, stock: r.stock }));
  const ready = meta.days >= COVER_HISTORY_DAYS;
  const covers: Cover[] = ready ? coversPerWarehouse(rows, meta.days) : [];
  const state: CoverState = {
    state: ready ? "ready" : "collecting",
    readyOn: meta.historyFrom ? addDays(meta.historyFrom, COVER_HISTORY_DAYS) : null,
    ordersReady: ready,
    stockReady: ready,
  };
  return { covers, state, soonest: ready ? coverBySku(rows, meta.days, null) : {}, coverageFrom: meta.historyFrom, raw: rows, forecast: raw, days: meta.days };
}

/** SKUs with no stock at a warehouse that has orders waiting to be packed there. */
export async function loadEmpties(supabase: Supabase): Promise<{ sku: string; warehouseId: string; orders: number; units: number }[]> {
  const { data, error } = await supabase.rpc("flipkart_empty_with_orders");
  if (error) fail("empty with orders", error);
  return (Array.isArray(data) ? data : []).flatMap((r) => {
    const x = r as { sku?: unknown; warehouse_id?: unknown; orders?: unknown; units?: unknown };
    return typeof x.sku === "string" && typeof x.warehouse_id === "string" ? [{ sku: x.sku, warehouseId: x.warehouse_id, orders: Number(x.orders) || 0, units: Number(x.units) || 0 }] : [];
  });
}

/** Listings that went inactive within the last N days (and were not already inactive when tracking began). */
export async function loadNewInactive(supabase: Supabase, today: string, days: number): Promise<{ sku: string; inactiveSince: string | null }[]> {
  const { data, error } = await supabase
    .from("stock_listings")
    .select("sku, inactive_since")
    .eq("platform", "flipkart")
    .eq("status", "INACTIVE")
    .eq("inactive_before_tracking", false)
    .gte("inactive_since", addDays(today, -days))
    .order("inactive_since", { ascending: false });
  if (error) fail("new inactive", error);
  return (data ?? []).map((r) => ({ sku: r.sku, inactiveSince: r.inactive_since }));
}

// --- Prices and listing health (owner and admin only: the database enforces it for prices) ---------------------------

type ListingPriceRow = { sku: string; title: string | null; status: string; mrp: number | null; selling_price: number | null };

export async function loadPriceRows(supabase: Supabase, snapshotDate: string, settings: FlipkartSettings, full: boolean): Promise<PriceRow[]> {
  try {
    const since = full ? addDays(snapshotDate, -400) : addDays(snapshotDate, -3);
    const [listings, changes] = await Promise.all([
      fetchAll<ListingPriceRow>((from, to) =>
        supabase.from("stock_listings").select("sku, title, status, mrp, selling_price").eq("platform", "flipkart").order("sku").range(from, to),
      ),
      fetchAll<{ sku: string; change_date: string; old_mrp: number | null; new_mrp: number | null; old_selling_price: number | null; new_selling_price: number | null }>((from, to) =>
        supabase
          .from("price_changes")
          .select("sku, change_date, old_mrp, new_mrp, old_selling_price, new_selling_price")
          .eq("platform", "flipkart")
          .gte("change_date", since)
          .order("id")
          .range(from, to),
      ),
    ]);
    const bySku = new Map<string, PriceChange[]>();
    for (const c of changes) {
      const list = bySku.get(c.sku) ?? [];
      list.push({ date: c.change_date, oldMrp: c.old_mrp, newMrp: c.new_mrp, oldSelling: c.old_selling_price, newSelling: c.new_selling_price });
      bySku.set(c.sku, list);
    }
    const inputs: PriceInput[] = listings.map((l) => ({
      sku: l.sku,
      title: l.title,
      status: l.status,
      mrp: l.mrp,
      sellingPrice: l.selling_price,
      changes: (bySku.get(l.sku) ?? []).sort((a, b) => b.date.localeCompare(a.date)),
    }));
    return buildPriceRows(inputs, settings, snapshotDate);
  } catch (error) {
    return fail("prices", error);
  }
}

export async function loadHealthRows(supabase: Supabase, settings: FlipkartSettings): Promise<{ rows: HealthRow[]; total: number; taxUnread: number }> {
  try {
    const listings = await fetchAll<{
      sku: string;
      title: string | null;
      status: string;
      packages: unknown;
      fulfillment: unknown;
      hsn: string | null;
      tax_code: string | null;
      tax_read: boolean;
    }>((from, to) =>
      supabase.from("stock_listings").select("sku, title, status, packages, fulfillment, hsn, tax_code, tax_read").eq("platform", "flipkart").order("sku").range(from, to),
    );
    // New listings whose real package, read from Flipkart, is over the weight limit (owner and admin only: the
    // database hides these posts from everyone else).
    const { data: heavy } = await supabase
      .from("posts")
      .select("id, number, sku, live_package")
      .eq("type", "new_listing")
      .eq("status", "done")
      .eq("live_over_weight", true);
    const heavyBySku = new Map<string, { id: string; number: number; total: number }>();
    for (const p of heavy ?? []) if (p.sku) heavyBySku.set(p.sku, { id: p.id, number: p.number, total: Number(p.live_package?.total ?? 0) });

    const rows = buildHealthRows(
      listings.map((l) => ({ sku: l.sku, title: l.title, status: l.status, packages: l.packages, fulfillment: l.fulfillment, hsn: l.hsn, taxCode: l.tax_code, taxRead: l.tax_read, listingPost: heavyBySku.get(l.sku) ?? null })),
      settings,
    );
    return { rows, total: listings.length, taxUnread: listings.filter((l) => !l.tax_read).length };
  } catch (error) {
    return fail("listing health", error);
  }
}

/** New-listing requests marked done 3 or more days ago that the daily sync still cannot find on Flipkart. */
export async function loadListingsNotFound(supabase: Supabase, now: Date): Promise<{ postId: string; number: number; title: string; sku: string; doneAt: string }[]> {
  const cutoff = new Date(now.getTime() - NOT_FOUND_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("posts")
    .select("id, number, title, sku, done_at")
    .eq("type", "new_listing")
    .eq("status", "done")
    .eq("live_found", false)
    .lte("done_at", cutoff)
    .order("done_at");
  if (error) return fail("new listings not found", error);
  return (data ?? []).flatMap((p) => (p.sku && p.done_at ? [{ postId: p.id, number: p.number, title: p.title, sku: p.sku, doneAt: p.done_at }] : []));
}

// --- Who sees what -----------------------------------------------------------------------------------------------------------------

export const canSeePrices = (user: Pick<SessionUser, "role">) => user.role !== "warehouse";
export const canSyncOrders = (user: Pick<SessionUser, "role">) => user.role === "owner" || user.role === "admin";

export async function warehousesFor(user: SessionUser): Promise<{ id: string; name: string }[]> {
  const lookups = await getLookups();
  return lookups.warehouses.filter((w) => user.role !== "warehouse" || user.warehouseIds.includes(w.id)).map((w) => ({ id: w.id, name: w.name }));
}

export { todayIST };

/** The day of the latest good stock snapshot, or null before the first sync. */
export async function latestSnapshotDate(supabase: Supabase): Promise<string | null> {
  const { data, error } = await supabase.from("stock_runs").select("snapshot_date").eq("status", "done").order("finished_at", { ascending: false }).limit(1);
  if (error) fail("snapshot date", error);
  return data?.[0]?.snapshot_date ?? null;
}
