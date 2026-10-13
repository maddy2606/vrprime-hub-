// What the Stock tab asks the server for, and what comes back. Plain values (no "use client", no server-only).
//
// The server reads the whole snapshot, works out the tiles, the warehouse cards and the lists, and sends the browser
// only what is on screen: the counts, and one page (50 rows) of the list that is open, already searched and sorted.
// The browser asks again for the next page, a search, a sort or another list.

import { z } from "zod";
import type { CsvCell } from "./csv.ts";
import {
  analyze,
  searchRows,
  sortRows,
  warehouseCards,
  weightMetric,
  type Analysis,
  type DeskData,
  type Row,
  type SortValue,
  type WarehouseCard,
} from "./stock-analysis.ts";
import { VIEW_KEYS, type ViewKey } from "./stock-views.ts";

export const STOCK_PAGE_SIZE = 50;

/** The first page sent with the page itself is smaller, so the page loads fast; "Show more" brings 50 at a time. */
export const STOCK_INITIAL_PAGE_SIZE = 30;

export const stockQuerySchema = z.object({
  view: z.enum(VIEW_KEYS),
  wh: z.union([z.literal(""), z.string().uuid()]),
  hide: z.boolean(),
  q: z.string().max(100),
  sort: z.string().max(20),
  dir: z.enum(["asc", "desc"]),
  offset: z.number().int().min(0).max(100_000),
});
export type StockQuery = z.infer<typeof stockQuerySchema>;

/** How each list is sorted when it is first opened. */
export const DEFAULT_STOCK_SORT: Record<ViewKey, { sort: string; dir: "asc" | "desc" }> = {
  low: { sort: "empty", dir: "desc" },
  location: { sort: "sku", dir: "asc" },
  out: { sort: "ranout", dir: "desc" },
  weight: { sort: "total", dir: "desc" },
  new: { sort: "since", dir: "desc" },
  inactive: { sort: "since", dir: "desc" },
};

export function defaultStockQuery(view: ViewKey = "low", over: Partial<StockQuery> = {}): StockQuery {
  return { view, wh: "", hide: false, q: "", ...DEFAULT_STOCK_SORT[view], offset: 0, ...over };
}

/** What the screen needs to label things, without the whole snapshot. */
export type StockMeta = {
  warehouses: { id: string; name: string }[];
  settings: DeskData["settings"];
  today: string;
  snapshotDate: string;
  previousDate: string | null;
  fullAccess: boolean;
};

export type StockViewData = {
  tiles: Analysis["tiles"];
  cards: WarehouseCard[];
  /** How many rows each list has with the current warehouse and "hide inactive" choice. */
  counts: Record<ViewKey, number>;
  /** How many rows the open list has after the search. */
  total: number;
  rows: StockRow[];
};

export type CoverLike = { days: number };

/** The soonest-to-run-out warehouse for a SKU. */
export type CoverFull = CoverLike & { warehouseId: string; units: number; rate: number; source: "orders" | "stock" };

/** A row of the list, with its days of cover when there are any. */
export type StockRow = Row & { cover: CoverFull | null };

export function stockMeta(data: DeskData): StockMeta {
  return {
    warehouses: data.warehouses,
    settings: data.settings,
    today: data.today,
    snapshotDate: data.snapshotDate,
    previousDate: data.previousDate,
    fullAccess: data.fullAccess,
  };
}

/** The value a column sorts by. Shared by the server (which sorts) and nothing else: the browser never sorts. */
export function stockSortValue(view: ViewKey, key: string, r: Row, weightLimit: number, soonest: Record<string, CoverLike> | null): SortValue {
  switch (key) {
    case "sku":
      return r.sku;
    case "empty":
      return r.empty.length;
    case "lowAt":
      return r.low.length;
    case "ok":
      return r.ok.length;
    case "total":
      return view === "weight" ? (r.dims ? weightMetric(r.dims).total : null) : r.total;
    case "change":
      return r.prevTotal === null ? null : r.total - r.prevTotal;
    case "status":
      return r.status;
    case "listed":
      return r.listed.length;
    case "yesterday":
      return r.prevTotal;
    case "ranout":
      return r.prevTotal !== null && r.prevTotal > 0 ? 1 : 0;
    case "size":
      return r.dims ? weightMetric(r.dims).volume : null;
    case "grams":
      return r.dims ? weightMetric(r.dims).grams : null;
    case "over":
      return r.dims ? weightMetric(r.dims).total - weightLimit : null;
    case "listing":
      return r.listingId;
    case "since":
      return r.inactiveSince;
    case "cover":
      return soonest?.[r.sku]?.days ?? null;
    default: {
      if (/^wh\d+$/.test(key)) return r.now[Number(key.slice(2))] ?? null;
      return r.sku;
    }
  }
}

/** The tiles, cards and counts for the current warehouse choice, and the sorted, searched list as a whole. */
function analyse(data: DeskData, q: StockQuery, soonest: Record<string, CoverLike> | null) {
  const picked = q.wh ? data.warehouses.findIndex((w) => w.id === q.wh) : -1;
  const scope = picked >= 0 ? [picked] : data.warehouses.map((_, i) => i);
  const analysis = analyze(data, scope, q.hide);
  const visible = q.hide ? analysis.rows.filter((r) => r.status !== "INACTIVE") : analysis.rows;
  const byView: Record<ViewKey, Row[]> = {
    low: analysis.low,
    location: visible,
    out: analysis.out,
    weight: analysis.weight,
    new: analysis.newInactive,
    inactive: analysis.allInactive,
  };
  const counts = Object.fromEntries(VIEW_KEYS.map((k) => [k, byView[k].length])) as Record<ViewKey, number>;
  const found = searchRows(byView[q.view], q.q);
  const sorted = sortRows(found, (r) => stockSortValue(q.view, q.sort, r, data.settings.weightLimit, soonest), q.dir);
  return { analysis, counts, sorted };
}

export function buildStockView(data: DeskData, q: StockQuery, soonest: Record<string, CoverFull> | null, limit = STOCK_PAGE_SIZE): StockViewData {
  const { analysis, counts, sorted } = analyse(data, q, soonest);
  return {
    tiles: analysis.tiles,
    cards: warehouseCards(data, q.hide),
    counts,
    total: sorted.length,
    rows: sorted.slice(q.offset, q.offset + limit).map((r) => ({ ...r, cover: soonest?.[r.sku] ?? null })),
  };
}

// --- CSV: the whole list, built on the server -------------------------------------------------------------------------

const names = (meta: StockMeta, idx: number[]) => idx.map((i) => meta.warehouses[i].name);

/** Headers and rows for the Download CSV button: every row of the list, not just the page on screen. */
export function stockCsv(data: DeskData, q: StockQuery, soonest: Record<string, CoverLike & { warehouseId: string }> | null): { headers: string[]; body: CsvCell[][] } {
  const { sorted } = analyse(data, { ...q, offset: 0 }, soonest);
  const meta = stockMeta(data);
  const wn = (i: number) => meta.warehouses[i].name;
  const days = (r: Row): CsvCell => (soonest?.[r.sku] ? Math.round(soonest[r.sku].days * 10) / 10 : null);
  const withCover = soonest !== null;
  const scope = q.wh ? [Math.max(0, meta.warehouses.findIndex((w) => w.id === q.wh))] : meta.warehouses.map((_, i) => i);

  switch (q.view) {
    case "low":
      return {
        headers: ["SKU", "Title", "Empty at", "Low at", "In stock at", "Total", ...(withCover ? ["Days left"] : [])],
        body: sorted.map((r) => [r.sku, r.title, names(meta, r.empty).join("; "), r.low.map((i) => `${wn(i)} ${r.now[i]}`).join("; "), r.ok.map((i) => `${wn(i)} ${r.now[i]}`).join("; "), r.total, ...(withCover ? [days(r)] : [])]),
      };
    case "location":
      return {
        headers: ["SKU", "Title", ...scope.map(wn), "Total", ...(meta.previousDate ? ["Change"] : []), ...(withCover ? ["Days left"] : [])],
        body: sorted.map((r) => [r.sku, r.title, ...scope.map((i) => r.now[i]), r.total, ...(meta.previousDate ? [r.prevTotal === null ? null : r.total - r.prevTotal] : []), ...(withCover ? [days(r)] : [])]),
      };
    case "out":
      return {
        headers: ["SKU", "Title", "Status", "Listed at", "Units before", "Ran out today"],
        body: sorted.map((r) => [r.sku, r.title, r.status, names(meta, r.listed).join("; "), r.prevTotal, r.prevTotal !== null && r.prevTotal > 0 ? "yes" : ""]),
      };
    case "weight":
      return {
        headers: ["SKU", "Title", "L x B x H (cm)", "Weight (g)", "Total", "Over by"],
        body: sorted.map((r) => {
          const m = r.dims ? weightMetric(r.dims) : null;
          return [r.sku, r.title, r.dims ? `${r.dims.l} x ${r.dims.b} x ${r.dims.h}` : null, m ? Math.round(m.grams) : null, m ? Math.round(m.total) : null, m ? Math.round(m.total - meta.settings.weightLimit) : null];
        }),
      };
    default:
      return {
        headers: ["SKU", "Title", "Listing ID", "Inactive since", "Units"],
        body: sorted.map((r) => [r.sku, r.title, r.listingId, r.beforeTracking ? "before tracking" : r.inactiveSince, r.total]),
      };
  }
}
