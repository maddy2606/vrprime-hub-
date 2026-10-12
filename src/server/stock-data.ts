import "server-only";
import { getLookups } from "@/lib/data";
import { todayIST } from "@/lib/format";
import { pickDims, type DeskData, type DeskListing, type StockSettings } from "@/lib/stock-analysis";
import { SYNC_COLUMNS, toSummary, type SyncSummary } from "@/lib/stock-sync";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/redact";
import type { SessionUser } from "@/lib/types";

export const DEFAULT_SETTINGS: StockSettings = { low: 100, weightLimit: 2000, newInactiveDays: 2 };

const PAGE = 1000;

type SnapshotEntry = { s: string; w: Record<string, number> };

function readSnapshot(value: unknown): Map<string, SnapshotEntry> {
  const out = new Map<string, SnapshotEntry>();
  if (typeof value !== "object" || value === null || Array.isArray(value)) return out;
  for (const [sku, raw] of Object.entries(value)) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as { s?: unknown; w?: unknown };
    const w: Record<string, number> = {};
    if (typeof entry.w === "object" && entry.w !== null) {
      for (const [id, n] of Object.entries(entry.w)) if (typeof n === "number") w[id] = n;
    }
    out.set(sku, { s: typeof entry.s === "string" ? entry.s : "UNKNOWN", w });
  }
  return out;
}

function whole(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export type StockPage =
  | { kind: "empty"; latest: SyncSummary | null }
  | {
      kind: "ready";
      data: DeskData;
      lastDone: SyncSummary;
      latest: SyncSummary | null;
    };

/** Everything the Stock page needs, as this person is allowed to see it (RLS decides the units). */
export async function loadStockPage(user: SessionUser, canSync: boolean): Promise<StockPage> {
  const supabase = await createClient();

  const [lookups, settingsResult, doneResult, latestResult] = await Promise.all([
    getLookups(),
    supabase.from("app_settings").select("key, value").in("key", ["low_stock_threshold", "weight_alert_limit", "new_inactive_days"]),
    supabase.from("stock_runs").select(SYNC_COLUMNS).eq("status", "done").order("finished_at", { ascending: false }).limit(1),
    supabase.from("stock_runs").select(SYNC_COLUMNS).order("created_at", { ascending: false }).limit(1),
  ]);
  if (doneResult.error || latestResult.error) {
    logError("stock page runs", doneResult.error ?? latestResult.error);
    throw new Error("Could not load the stock page");
  }
  const latest = latestResult.data[0] ? toSummary(latestResult.data[0], canSync) : null;
  const lastDoneRow = doneResult.data[0];
  if (!lastDoneRow?.snapshot_date) return { kind: "empty", latest };
  const snapshotDate = lastDoneRow.snapshot_date;

  const settings: StockSettings = { ...DEFAULT_SETTINGS };
  for (const row of settingsResult.data ?? []) {
    if (row.key === "low_stock_threshold") settings.low = Math.max(1, whole(row.value, DEFAULT_SETTINGS.low));
    if (row.key === "weight_alert_limit") settings.weightLimit = whole(row.value, DEFAULT_SETTINGS.weightLimit);
    if (row.key === "new_inactive_days") settings.newInactiveDays = whole(row.value, DEFAULT_SETTINGS.newInactiveDays);
  }

  // Owner, manager and listing see every warehouse; a warehouse user, only theirs.
  const fullAccess = user.role !== "warehouse";
  const warehouses = lookups.warehouses
    .filter((w) => fullAccess || user.warehouseIds.includes(w.id))
    .map((w) => ({ id: w.id, name: w.name }));

  const previousResult = await supabase
    .from("stock_runs")
    .select("snapshot_date")
    .eq("status", "done")
    .lt("snapshot_date", snapshotDate)
    .order("snapshot_date", { ascending: false })
    .limit(1);
  const previousDate = previousResult.data?.[0]?.snapshot_date ?? null;

  const [current, previous, listings] = await Promise.all([
    supabase.rpc("stock_snapshot", { p_date: snapshotDate }),
    previousDate ? supabase.rpc("stock_snapshot", { p_date: previousDate }) : Promise.resolve({ data: null, error: null }),
    fetchListings(supabase),
  ]);
  if (current.error || previous.error || listings.error) {
    logError("stock page snapshot", current.error ?? previous.error ?? listings.error);
    throw new Error("Could not load the stock page");
  }

  const now = readSnapshot(current.data);
  const before = readSnapshot(previous.data);
  const meta = new Map(listings.rows.map((l) => [l.sku, l]));

  const rows: DeskListing[] = [...now.entries()]
    .map(([sku, entry]): DeskListing => {
      const m = meta.get(sku);
      const prior = before.get(sku);
      return {
        sku,
        title: m?.title ?? null,
        status: entry.s,
        listingId: m?.listing_id ?? null,
        inactiveSince: m?.inactive_since ?? null,
        beforeTracking: m?.inactive_before_tracking ?? false,
        dims: pickDims(m?.packages),
        now: warehouses.map((w) => entry.w[w.id] ?? null),
        prev: warehouses.map((w) => prior?.w[w.id] ?? null),
        prevStatus: prior?.s ?? null,
      };
    })
    .sort((a, b) => a.sku.localeCompare(b.sku));

  return {
    kind: "ready",
    data: { warehouses, listings: rows, settings, today: todayIST(), snapshotDate, previousDate, fullAccess },
    lastDone: toSummary(lastDoneRow, canSync),
    latest,
  };
}

type ListingMeta = {
  sku: string;
  title: string | null;
  listing_id: string | null;
  inactive_since: string | null;
  inactive_before_tracking: boolean;
  packages: unknown;
};

async function fetchListings(supabase: Awaited<ReturnType<typeof createClient>>) {
  const rows: ListingMeta[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("stock_listings")
      .select("sku, title, listing_id, inactive_since, inactive_before_tracking, packages")
      .eq("platform", "flipkart")
      .order("sku")
      .range(from, from + PAGE - 1);
    if (error) return { rows, error };
    rows.push(...data);
    if (data.length < PAGE) return { rows, error: null };
  }
}
