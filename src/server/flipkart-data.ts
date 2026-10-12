import "server-only";
import { getLookups } from "@/lib/data";
import {
  buildHealthRows,
  buildPriceRows,
  buildReturnRates,
  computeCover,
  DEFAULT_FLIPKART_SETTINGS,
  readSalesRates,
  readStockDrops,
  returnHistoryReady,
  soonestBySku,
  type Cover,
  type CoverState,
  type FlipkartSettings,
  type HealthRow,
  type PendingOrder,
  type PriceChange,
  type PriceInput,
  type PriceRow,
  type ReturnRate,
} from "@/lib/flipkart-analysis";
import { addDays, todayIST } from "@/lib/format";
import { logError } from "@/lib/redact";
import { SETTING_KEYS } from "@/lib/settings-keys";
import type { DeskData } from "@/lib/stock-analysis";
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
    if (row.key === "return_rate_percent") out.returnRatePercent = whole(row.value, d.returnRatePercent, 1);
  }
  return out;
}

// --- Pending orders ------------------------------------------------------------------------------------------

type PendingRow = {
  order_item_id: string;
  order_id: string;
  sku: string | null;
  quantity: number;
  warehouse_id: string | null;
  item_status: string | null;
  hold: boolean;
  dispatch_by: string | null;
};

export async function loadPendingOrders(supabase: Supabase): Promise<PendingOrder[]> {
  try {
    const rows = await fetchAll<PendingRow>((from, to) =>
      supabase
        .from("fk_order_items")
        .select("order_item_id, order_id, sku, quantity, warehouse_id, item_status, hold, dispatch_by")
        .eq("platform", "flipkart")
        .eq("stage", "pending")
        .order("order_item_id")
        .range(from, to),
    );
    return rows.map((r) => ({
      orderItemId: r.order_item_id,
      orderId: r.order_id,
      sku: r.sku,
      quantity: r.quantity,
      warehouseId: r.warehouse_id,
      status: r.item_status,
      hold: r.hold,
      dispatchBy: r.dispatch_by,
    }));
  } catch (error) {
    return fail("pending orders", error);
  }
}

// --- Sync runs -------------------------------------------------------------------------------------------------------

export async function loadOrderSyncState(supabase: Supabase, canSeeError: boolean): Promise<OrderSyncState> {
  const [latest, pending, daily, backfill] = await Promise.all([
    supabase.from("order_runs").select(RUN_COLUMNS).neq("kind", "backfill").order("created_at", { ascending: false }).limit(1),
    supabase.from("order_runs").select(RUN_COLUMNS).eq("kind", "pending").eq("status", "done").order("finished_at", { ascending: false }).limit(1),
    supabase.from("order_runs").select(RUN_COLUMNS).eq("kind", "daily").eq("status", "done").order("finished_at", { ascending: false }).limit(1),
    supabase.from("order_runs").select(RUN_COLUMNS).eq("kind", "backfill").order("created_at", { ascending: false }).limit(1),
  ]);
  const err = latest.error ?? pending.error ?? daily.error ?? backfill.error;
  if (err) fail("order sync state", err);
  const one = (r: { data: RunRowRaw[] | null }) => (r.data?.[0] ? toRun(r.data[0], canSeeError) : null);
  return { latest: one(latest), lastPending: one(pending), lastDaily: one(daily), backfill: one(backfill) };
}

// --- Cancellations -----------------------------------------------------------------------------------------------------

export type CancelRow = {
  orderItemId: string;
  orderId: string;
  sku: string | null;
  quantity: number;
  warehouseId: string | null;
  type: "seller" | "buyer";
  cancelledAt: string | null;
  reason: string | null;
  subReason: string | null;
};

export async function loadCancellations(supabase: Supabase, today: string): Promise<CancelRow[]> {
  const since = `${addDays(today, -29)}T00:00:00+05:30`;
  try {
    const rows = await fetchAll<{
      order_item_id: string;
      order_id: string;
      sku: string | null;
      quantity: number;
      warehouse_id: string | null;
      cancel_type: "seller" | "buyer" | null;
      cancelled_at: string | null;
      cancel_reason: string | null;
      cancel_sub_reason: string | null;
    }>((from, to) =>
      supabase
        .from("fk_order_items")
        .select("order_item_id, order_id, sku, quantity, warehouse_id, cancel_type, cancelled_at, cancel_reason, cancel_sub_reason")
        .eq("platform", "flipkart")
        .eq("stage", "cancelled")
        .gte("cancelled_at", since)
        .order("order_item_id")
        .range(from, to),
    );
    return rows
      .filter((r): r is typeof r & { cancel_type: "seller" | "buyer" } => r.cancel_type !== null)
      .map((r) => ({
        orderItemId: r.order_item_id,
        orderId: r.order_id,
        sku: r.sku,
        quantity: r.quantity,
        warehouseId: r.warehouse_id,
        type: r.cancel_type,
        cancelledAt: r.cancelled_at,
        reason: r.cancel_reason,
        subReason: r.cancel_sub_reason,
      }))
      .sort((a, b) => (b.cancelledAt ?? "").localeCompare(a.cancelledAt ?? ""));
  } catch (error) {
    return fail("cancellations", error);
  }
}

// --- Returns -----------------------------------------------------------------------------------------------------------------

export type ReturnListRow = {
  returnId: string;
  orderItemId: string;
  orderId: string | null;
  sku: string | null;
  quantity: number;
  warehouseId: string | null;
  source: "courier_return" | "customer_return";
  status: string | null;
  reason: string | null;
  subReason: string | null;
  createdDate: string | null;
};

export async function loadReturns(supabase: Supabase, today: string): Promise<ReturnListRow[]> {
  const since = addDays(today, -29);
  try {
    const rows = await fetchAll<{
      return_id: string;
      order_item_id: string;
      order_id: string | null;
      sku: string | null;
      quantity: number;
      warehouse_id: string | null;
      source: "courier_return" | "customer_return";
      return_status: string | null;
      reason: string | null;
      sub_reason: string | null;
      created_date: string | null;
    }>((from, to) =>
      supabase
        .from("fk_returns")
        .select("return_id, order_item_id, order_id, sku, quantity, warehouse_id, source, return_status, reason, sub_reason, created_date")
        .eq("platform", "flipkart")
        .gte("created_date", since)
        .order("return_id")
        .order("order_item_id")
        .range(from, to),
    );
    return rows
      .map((r) => ({
        returnId: r.return_id,
        orderItemId: r.order_item_id,
        orderId: r.order_id,
        sku: r.sku,
        quantity: r.quantity,
        warehouseId: r.warehouse_id,
        source: r.source,
        status: r.return_status,
        reason: r.reason,
        subReason: r.sub_reason,
        createdDate: r.created_date,
      }))
      .sort((a, b) => (b.createdDate ?? "").localeCompare(a.createdDate ?? ""));
  } catch (error) {
    return fail("returns", error);
  }
}

export async function loadReturnRates(supabase: Supabase, settings: FlipkartSettings, today: string): Promise<{ rates: ReturnRate[]; historyReady: boolean; coverageFrom: string | null }> {
  const [rates, sales] = await Promise.all([supabase.rpc("flipkart_return_rates", { p_days: 30 }), supabase.rpc("flipkart_sales_rates")]);
  if (rates.error || sales.error) fail("return rates", rates.error ?? sales.error);
  const coverageFrom = readSalesRates(sales.data).coverageFrom;
  const historyReady = returnHistoryReady(coverageFrom, today);
  return { rates: buildReturnRates(rates.data, settings, historyReady), historyReady, coverageFrom };
}

// --- Days of cover ---------------------------------------------------------------------------------------------------------------

export type CoverData = { covers: Cover[]; state: CoverState; soonest: Record<string, Cover> };

export async function loadCover(supabase: Supabase, data: DeskData): Promise<CoverData> {
  const [sales, drops] = await Promise.all([supabase.rpc("flipkart_sales_rates"), supabase.rpc("flipkart_stock_drops")]);
  if (sales.error || drops.error) fail("days of cover", sales.error ?? drops.error);
  const { covers, state } = computeCover({
    listings: data.listings,
    warehouses: data.warehouses,
    sales: readSalesRates(sales.data),
    drops: readStockDrops(drops.data),
    today: data.today,
  });
  return { covers, state, soonest: soonestBySku(covers) };
}

// --- Prices and listing health (owner, manager, listing only: the database enforces it for prices) ---------------------------

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
    const rows = buildHealthRows(
      listings.map((l) => ({ sku: l.sku, title: l.title, status: l.status, packages: l.packages, fulfillment: l.fulfillment, hsn: l.hsn, taxCode: l.tax_code, taxRead: l.tax_read })),
      settings,
    );
    return { rows, total: listings.length, taxUnread: listings.filter((l) => !l.tax_read).length };
  } catch (error) {
    return fail("listing health", error);
  }
}

// --- Who sees what -----------------------------------------------------------------------------------------------------------------

export const canSeePrices = (user: Pick<SessionUser, "role">) => user.role !== "warehouse";
export const canSyncOrders = (user: Pick<SessionUser, "role">) => user.role === "owner" || user.role === "manager";

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
