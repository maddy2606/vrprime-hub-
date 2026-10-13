// Everything the Stock page works out from a snapshot. Pure functions: no database, no React.
//
// Words used here:
//  - "scope": the warehouses being looked at. All the ones this person can see, or just the one
//    they tapped. Totals, low and empty are always about the scope.
//  - "listed": a warehouse where Flipkart reports this SKU. "Not listed" shows as a dash.
//  - empty = 0 units; low = 1 up to (but not including) the low-stock setting; ok = at or above it.

export type Dims = { l: number; b: number; h: number; kg: number };

export type DeskListing = {
  sku: string;
  title: string | null;
  /** The listing's status in the snapshot: ACTIVE or INACTIVE. */
  status: string;
  listingId: string | null;
  /** The day it was first seen inactive (YYYY-MM-DD). */
  inactiveSince: string | null;
  /** Already inactive when tracking began, so not "new". */
  beforeTracking: boolean;
  dims: Dims | null;
  /** Units per warehouse, in the order of DeskData.warehouses. null = not listed there. */
  now: (number | null)[];
  /** The same for the snapshot before. All null when there is none. */
  prev: (number | null)[];
  /** The listing's status in the snapshot before; null when it was not in it. */
  prevStatus: string | null;
};

export type StockSettings = { low: number; weightLimit: number; newInactiveDays: number };

export type DeskData = {
  warehouses: { id: string; name: string }[];
  listings: DeskListing[];
  settings: StockSettings;
  /** Today in IST (YYYY-MM-DD). */
  today: string;
  snapshotDate: string;
  previousDate: string | null;
  /** True when this person can see every warehouse in the system. */
  fullAccess: boolean;
};

export type Row = DeskListing & {
  total: number;
  /** Units in the snapshot before, or null when there is no earlier snapshot. */
  prevTotal: number | null;
  listed: number[];
  empty: number[];
  low: number[];
  ok: number[];
};

export function isActive(status: string): boolean {
  return status === "ACTIVE";
}

export function isInactive(status: string): boolean {
  return status === "INACTIVE";
}

// --- Size and weight --------------------------------------------------------------------------

function positive(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function weightMetric(d: Dims): { volume: number; grams: number; total: number } {
  const volume = d.l * d.b * d.h;
  const grams = d.kg * 1000;
  return { volume, grams, total: volume + grams };
}

/**
 * The package to judge a listing by, from Flipkart's `packages` (cm and kg). A package with a missing
 * length, breadth or height is ignored; with several good ones the heaviest by the alert formula wins.
 * A missing weight counts as 0. Returns null when no package has all three sizes.
 */
export function pickDims(packages: unknown): Dims | null {
  if (!Array.isArray(packages)) return null;
  let best: Dims | null = null;
  for (const p of packages) {
    if (typeof p !== "object" || p === null) continue;
    const d = (p as { dimensions?: unknown }).dimensions;
    if (typeof d !== "object" || d === null) continue;
    const l = positive((d as Record<string, unknown>).length);
    const b = positive((d as Record<string, unknown>).breadth);
    const h = positive((d as Record<string, unknown>).height);
    if (l === null || b === null || h === null) continue;
    const w = (p as { weight?: unknown }).weight;
    const candidate: Dims = { l, b, h, kg: typeof w === "number" && Number.isFinite(w) && w > 0 ? w : 0 };
    if (!best || weightMetric(candidate).total > weightMetric(best).total) best = candidate;
  }
  return best;
}

// --- Dates --------------------------------------------------------------------------------------

/** Whole days from one calendar day (YYYY-MM-DD) to another. */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

/** Went inactive within the last `days` days, and not already inactive when tracking began. */
export function isNewInactive(row: Pick<DeskListing, "status" | "inactiveSince" | "beforeTracking">, today: string, days: number): boolean {
  if (!isInactive(row.status) || !row.inactiveSince || row.beforeTracking) return false;
  return daysBetween(row.inactiveSince, today) <= days;
}

// --- Rows -----------------------------------------------------------------------------------------

function sum(values: (number | null)[], indices: number[]): number {
  let total = 0;
  for (const i of indices) total += values[i] ?? 0;
  return total;
}

/**
 * One row per SKU for the warehouses in `scope` (indices into data.warehouses).
 * With everything in scope every SKU appears, even one listed nowhere (that is out of stock).
 * With fewer warehouses in scope, only SKUs listed at one of them appear.
 */
export function buildRows(data: DeskData, scope: number[]): Row[] {
  const everything = data.fullAccess && scope.length === data.warehouses.length;
  const rows: Row[] = [];
  for (const listing of data.listings) {
    const listed = scope.filter((i) => listing.now[i] !== null && listing.now[i] !== undefined);
    if (!everything && listed.length === 0) continue;
    const empty = listed.filter((i) => listing.now[i] === 0);
    const low = listed.filter((i) => (listing.now[i] as number) > 0 && (listing.now[i] as number) < data.settings.low);
    const ok = listed.filter((i) => (listing.now[i] as number) >= data.settings.low);
    rows.push({
      ...listing,
      total: sum(listing.now, listed),
      prevTotal: data.previousDate ? sum(listing.prev, scope) : null,
      listed,
      empty,
      low,
      ok,
    });
  }
  return rows;
}

export type Analysis = {
  rows: Row[];
  /** Still has stock somewhere, but is empty or low at one of the warehouses. */
  low: Row[];
  /** No units in any warehouse in scope. */
  out: Row[];
  weight: (Row & { metric: { volume: number; grams: number; total: number }; overBy: number })[];
  newInactive: Row[];
  allInactive: Row[];
  tiles: {
    /** Units in stock across ACTIVE listings. */
    units: number;
    /** Compared with the snapshot before; null when there is none. */
    unitsChange: number | null;
    low: number;
    out: number;
    weight: number;
    newInactive: number;
  };
};

export function analyze(data: DeskData, scope: number[], hideInactive: boolean): Analysis {
  const rows = buildRows(data, scope);
  const visible = hideInactive ? rows.filter((r) => !isInactive(r.status)) : rows;
  const { weightLimit, newInactiveDays } = data.settings;

  const low = visible.filter((r) => r.total > 0 && r.empty.length + r.low.length > 0);
  const out = visible.filter((r) => r.total === 0);
  const weight = visible
    .filter((r) => r.dims !== null)
    .map((r) => {
      const metric = weightMetric(r.dims as Dims);
      return { ...r, metric, overBy: metric.total - weightLimit };
    })
    .filter((r) => r.overBy > 0);
  const allInactive = rows.filter((r) => isInactive(r.status));
  const newInactive = allInactive.filter((r) => isNewInactive(r, data.today, newInactiveDays));

  const units = rows.filter((r) => isActive(r.status)).reduce((n, r) => n + r.total, 0);
  let unitsChange: number | null = null;
  if (data.previousDate) {
    // Active listings in the snapshot before, judged by their status then.
    const before = rows
      .filter((r) => (r.prevStatus ?? r.status) === "ACTIVE")
      .reduce((n, r) => n + (r.prevTotal ?? 0), 0);
    unitsChange = units - before;
  }

  return {
    rows,
    low,
    out,
    weight,
    newInactive,
    allInactive,
    tiles: { units, unitsChange, low: low.length, out: out.length, weight: weight.length, newInactive: newInactive.length },
  };
}

export type WarehouseCard = {
  id: string;
  name: string;
  index: number;
  units: number;
  share: number;
  /** SKUs listed here with 0 units. */
  empty: number;
  /** SKUs listed here with 1 up to the low-stock setting. */
  low: number;
};

/** One card per warehouse, always over every warehouse this person can see. */
export function warehouseCards(data: DeskData, hideInactive: boolean): WarehouseCard[] {
  const cards = data.warehouses.map((w, index) => ({ id: w.id, name: w.name, index, units: 0, share: 0, empty: 0, low: 0 }));
  for (const listing of data.listings) {
    const active = isActive(listing.status);
    const counted = !(hideInactive && isInactive(listing.status));
    for (const card of cards) {
      const n = listing.now[card.index];
      if (n === null || n === undefined) continue;
      if (active) card.units += n;
      if (!counted) continue;
      if (n === 0) card.empty += 1;
      else if (n < data.settings.low) card.low += 1;
    }
  }
  const total = cards.reduce((n, c) => n + c.units, 0);
  for (const card of cards) card.share = total > 0 ? card.units / total : 0;
  return cards;
}

/** The warehouse a "Create restock post" should point at: where this SKU is emptiest. */
export function restockWarehouse(row: Row, data: Pick<DeskData, "warehouses">, scope: number[]): string | null {
  const candidates = scope.filter((i) => row.now[i] !== null && row.now[i] !== undefined);
  if (candidates.length === 0) return scope.length === 1 ? data.warehouses[scope[0]].id : null;
  const emptiest = candidates.reduce((best, i) => ((row.now[i] as number) < (row.now[best] as number) ? i : best), candidates[0]);
  return data.warehouses[emptiest].id;
}

/** The address of a new restock post for this SKU and warehouse. */
export function restockHref(sku: string, warehouseId: string | null): string {
  const params = new URLSearchParams({ type: "restock", sku });
  if (warehouseId) params.set("warehouse", warehouseId);
  return `/posts/new?${params.toString()}`;
}

// --- Sorting ------------------------------------------------------------------------------------------

export type SortValue = number | string | null;

/** Sorts a copy. Empty values go last whichever way it is sorted; ties are ordered by SKU. */
export function sortRows<T extends { sku: string }>(rows: T[], value: (row: T) => SortValue, dir: "asc" | "desc"): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x === null && y === null) return a.sku.localeCompare(b.sku);
    if (x === null) return 1;
    if (y === null) return -1;
    const diff = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "en", { numeric: true, sensitivity: "base" });
    return diff === 0 ? a.sku.localeCompare(b.sku) : diff * sign;
  });
}

/** Rows matching a search for part of a SKU or title. */
export function searchRows<T extends { sku: string; title: string | null }>(rows: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => r.sku.toLowerCase().includes(q) || (r.title ?? "").toLowerCase().includes(q));
}
