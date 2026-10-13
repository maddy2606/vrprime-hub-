// What the Orders tab asks the server for, and what comes back. Plain values (no "use client", no server-only), so the
// server page, the server actions and the browser all use the same types and the same checks.
//
// The browser never gets every order line. It gets the counts per warehouse, then one page at a time of whichever
// list is on screen (50 rows), and a SKU's own orders only when that SKU is opened.

import { z } from "zod";

export const PAGE_SIZE = 50;

export const ORDER_VIEWS = ["sku", "list", "pick", "upcoming", "cancelled"] as const;
export type OrderView = (typeof ORDER_VIEWS)[number];

/**
 * Seller Hub's tabs. To Accept, To Pack and To Dispatch together are Active (dispatch-after reached);
 * Upcoming is dispatch-after still in the future; Under Processing is Flipkart working on the order
 * (PACKING_IN_PROGRESS), whose delays Seller Hub says do not count against account health.
 */
export type Bucket = "to_accept" | "to_pack" | "to_dispatch" | "upcoming" | "processing";
export const BUCKETS: Bucket[] = ["to_accept", "to_pack", "to_dispatch", "upcoming", "processing"];
export const ACTIVE_BUCKETS: Bucket[] = ["to_accept", "to_pack", "to_dispatch"];

export const BUCKET_LABEL: Record<Bucket, string> = {
  to_accept: "To Accept",
  to_pack: "To Pack",
  to_dispatch: "To Dispatch",
  upcoming: "Upcoming",
  processing: "Under Processing",
};

export type StatusFilter = Bucket | "active";
export const STATUS_FILTERS: StatusFilter[] = ["active", ...BUCKETS];
export const isActiveBucket = (b: string | null): boolean => b === "to_accept" || b === "to_pack" || b === "to_dispatch";

export type PickDue = "today" | "all";
export type CancelType = "all" | "seller" | "buyer";

export const ordersQuerySchema = z.object({
  view: z.enum(ORDER_VIEWS),
  status: z.enum(["active", "to_accept", "to_pack", "to_dispatch", "upcoming", "processing"]),
  wh: z.union([z.literal(""), z.string().uuid()]),
  q: z.string().max(100),
  sort: z.string().max(20),
  dir: z.enum(["asc", "desc"]),
  offset: z.number().int().min(0).max(100_000),
  pickDue: z.enum(["today", "all"]),
  shortOnly: z.boolean(),
  cancelType: z.enum(["all", "seller", "buyer"]),
});
export type OrdersQuery = z.infer<typeof ordersQuerySchema>;

/** How each list is sorted when it is first opened. */
export const DEFAULT_SORT: Record<OrderView, { sort: string; dir: "asc" | "desc" }> = {
  sku: { sort: "due", dir: "asc" },
  list: { sort: "due", dir: "asc" },
  pick: { sort: "units", dir: "desc" },
  upcoming: { sort: "short", dir: "desc" },
  cancelled: { sort: "date", dir: "desc" },
};

export function defaultQuery(view: OrderView = "sku", over: Partial<OrdersQuery> = {}): OrdersQuery {
  return { view, status: "active", wh: "", q: "", ...DEFAULT_SORT[view], offset: 0, pickDue: "today", shortOnly: false, cancelType: "all", ...over };
}

// --- Rows ---------------------------------------------------------------------------------------------------------

export type SkuRow = {
  sku: string;
  title: string | null;
  /** Shipments, as Seller Hub counts them. */
  orders: number;
  units: number;
  /** Earliest dispatch-by, orders on hold left out. */
  due: string | null;
  /** The same among Active orders only: the one that can be late (red). */
  active_due: string | null;
  to_accept: number;
  to_pack: number;
  to_dispatch: number;
  upcoming: number;
  processing: number;
  /** Units per warehouse ID. */
  by_wh: Record<string, number>;
};

export type OrderLine = {
  order_item_id: string;
  order_id: string;
  sku: string | null;
  quantity: number;
  warehouse_id: string | null;
  bucket: Bucket;
  hold: boolean;
  dispatch_by: string | null;
  dispatch_after: string | null;
};

export type PickRow = {
  sku: string;
  title: string | null;
  /** Units still to pack: To Accept plus To Pack. */
  units: number;
  to_accept: number;
  to_pack: number;
  orders: number;
  due: string | null;
  stock: number | null;
};

export type UpcomingRow = {
  sku: string;
  title: string | null;
  warehouse_id: string;
  upcoming: number;
  orders: number;
  /** When the first of them becomes Active. */
  first_active: string | null;
  /** Units in Active orders at the same warehouse, for context. */
  active: number;
  stock: number | null;
  short: number;
};

export type CancelLine = {
  order_item_id: string;
  order_id: string;
  sku: string | null;
  quantity: number;
  warehouse_id: string | null;
  cancel_type: "seller" | "buyer";
  cancelled_at: string | null;
  cancel_reason: string | null;
  cancel_sub_reason: string | null;
};

export type CancelSummary = { seller_total: number; buyer_total: number; days: { day: string; seller: number; buyer: number }[] };

export type OrdersViewResult =
  | { view: "sku"; total: number; orders: number; units: number; rows: SkuRow[] }
  | { view: "list"; total: number; rows: OrderLine[] }
  | { view: "pick"; warehouseId: string; total: number; units: number; rows: PickRow[] }
  | { view: "upcoming"; total: number; shortCount: number; rows: UpcomingRow[] }
  | { view: "cancelled"; total: number; summary: CancelSummary; rows: CancelLine[] };

/** What one opened SKU shows: its orders (first 100) and the stock at each warehouse. */
export type SkuDetail = { total: number; lines: OrderLine[]; stock: Record<string, number> };

// --- Reading what the database sends -----------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function numOrNull(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

const str = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const rowsOf = (value: unknown): Record<string, unknown>[] => (isObject(value) && Array.isArray(value.rows) ? value.rows.filter(isObject) : []);
const BUCKET_SET = new Set<string>(BUCKETS);

export function readSkuRows(value: unknown): Extract<OrdersViewResult, { view: "sku" }> {
  const o = isObject(value) ? value : {};
  return {
    view: "sku",
    total: num(o.total),
    orders: num(o.orders),
    units: num(o.units),
    rows: rowsOf(value).map((r) => ({
      sku: String(r.sku ?? ""),
      title: str(r.title),
      orders: num(r.orders),
      units: num(r.units),
      due: str(r.due),
      active_due: str(r.active_due),
      to_accept: num(r.to_accept),
      to_pack: num(r.to_pack),
      to_dispatch: num(r.to_dispatch),
      upcoming: num(r.upcoming),
      processing: num(r.processing),
      by_wh: isObject(r.by_wh) ? Object.fromEntries(Object.entries(r.by_wh).map(([k, v]) => [k, num(v)])) : {},
    })),
  };
}

export function readOrderLines(value: unknown): { total: number; rows: OrderLine[] } {
  const o = isObject(value) ? value : {};
  return {
    total: num(o.total),
    rows: rowsOf(value)
      .filter((r) => BUCKET_SET.has(String(r.bucket)))
      .map((r) => ({
        order_item_id: String(r.order_item_id ?? ""),
        order_id: String(r.order_id ?? ""),
        sku: str(r.sku),
        quantity: num(r.quantity, 1),
        warehouse_id: str(r.warehouse_id),
        bucket: r.bucket as Bucket,
        hold: r.hold === true,
        dispatch_by: str(r.dispatch_by),
        dispatch_after: str(r.dispatch_after),
      })),
  };
}

export function readPickRows(value: unknown): { total: number; units: number; rows: PickRow[] } {
  const o = isObject(value) ? value : {};
  return {
    total: num(o.total),
    units: num(o.units),
    rows: rowsOf(value).map((r) => ({
      sku: String(r.sku ?? ""),
      title: str(r.title),
      units: num(r.units),
      to_accept: num(r.to_accept),
      to_pack: num(r.to_pack),
      orders: num(r.orders),
      due: str(r.due),
      stock: numOrNull(r.stock),
    })),
  };
}

export function readUpcomingRows(value: unknown): { total: number; shortCount: number; rows: UpcomingRow[] } {
  const o = isObject(value) ? value : {};
  return {
    total: num(o.total),
    shortCount: num(o.short_count),
    rows: rowsOf(value).map((r) => ({
      sku: String(r.sku ?? ""),
      title: str(r.title),
      warehouse_id: String(r.warehouse_id ?? ""),
      upcoming: num(r.upcoming),
      orders: num(r.orders),
      first_active: str(r.first_active),
      active: num(r.active),
      stock: numOrNull(r.stock),
      short: num(r.short),
    })),
  };
}

export function readCancelLines(value: unknown): { total: number; rows: CancelLine[] } {
  const o = isObject(value) ? value : {};
  return {
    total: num(o.total),
    rows: rowsOf(value)
      .filter((r) => r.cancel_type === "seller" || r.cancel_type === "buyer")
      .map((r) => ({
        order_item_id: String(r.order_item_id ?? ""),
        order_id: String(r.order_id ?? ""),
        sku: str(r.sku),
        quantity: num(r.quantity, 1),
        warehouse_id: str(r.warehouse_id),
        cancel_type: r.cancel_type as "seller" | "buyer",
        cancelled_at: str(r.cancelled_at),
        cancel_reason: str(r.cancel_reason),
        cancel_sub_reason: str(r.cancel_sub_reason),
      })),
  };
}

export function readCancelSummary(value: unknown): CancelSummary {
  const o = isObject(value) ? value : {};
  const days = Array.isArray(o.days) ? o.days.filter(isObject) : [];
  return {
    seller_total: num(o.seller_total),
    buyer_total: num(o.buyer_total),
    days: days.map((d) => ({ day: String(d.day ?? "").slice(0, 10), seller: num(d.seller), buyer: num(d.buyer) })),
  };
}

export function readStockMap(value: unknown): Record<string, number> {
  return isObject(value) ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, num(v)])) : {};
}

/** How many units a warehouse is short: pending units there minus its stock, or 0. Unknown stock is never "short". */
export function shortBy(units: number, stock: number | null | undefined): number {
  return stock === null || stock === undefined ? 0 : Math.max(0, units - stock);
}

// --- The cards (counts per warehouse) --------------------------------------------------------------------------------

export type WarehouseOrders = Record<Bucket, number> & {
  warehouseId: string | null;
  name: string;
  /** To Accept + To Pack + To Dispatch. */
  active: number;
  /** Shipped, not yet delivered (count only). */
  inTransit: number;
  /** Active orders on hold: shown, never counted as late. */
  held: number;
  late: number;
  today: number;
  tomorrow: number;
  /** The earliest deadline among Active orders that are not on hold. */
  nextDue: string | null;
};

/** The cards from flipkart_order_counts: one per warehouse, plus "Unknown warehouse" when orders have none. */
export function readCards(value: unknown, warehouses: { id: string; name: string }[], inTransit: Record<string, number> = {}): WarehouseOrders[] {
  const rows = Array.isArray(value) ? value.filter(isObject) : [];
  const byId = new Map<string, Record<string, unknown>>();
  let unknown: Record<string, unknown> | null = null;
  for (const r of rows) {
    const id = str(r.warehouse_id);
    if (id) byId.set(id, r);
    else unknown = r;
  }
  const make = (id: string | null, name: string, r: Record<string, unknown> | undefined): WarehouseOrders => ({
    warehouseId: id,
    name,
    to_accept: num(r?.to_accept),
    to_pack: num(r?.to_pack),
    to_dispatch: num(r?.to_dispatch),
    upcoming: num(r?.upcoming),
    processing: num(r?.processing),
    active: num(r?.active),
    inTransit: id ? inTransit[id] ?? 0 : 0,
    held: num(r?.held),
    late: num(r?.late),
    today: num(r?.today),
    tomorrow: num(r?.tomorrow),
    nextDue: str(r?.next_due),
  });
  const cards = warehouses.map((w) => make(w.id, w.name, byId.get(w.id)));
  if (unknown) {
    const card = make(null, "Unknown warehouse", unknown);
    if (card.active + card.upcoming + card.processing > 0) cards.push(card);
  }
  return cards;
}
