import "server-only";
import {
  PAGE_SIZE,
  readCancelLines,
  readCancelSummary,
  readCards,
  readOrderLines,
  readPickRows,
  readSkuRows,
  readStockMap,
  readUpcomingRows,
  type OrdersQuery,
  type OrdersViewResult,
  type SkuDetail,
  type StatusFilter,
  type WarehouseOrders,
} from "@/lib/orders-view";
import { logError } from "@/lib/redact";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

function fail(where: string, error: unknown): never {
  logError(where, error);
  throw new Error("Could not load the orders");
}

const orNull = (s: string) => (s === "" ? null : s);

/** Counts per warehouse in Seller Hub's tabs, one small answer from the database. */
export async function loadOrderCounts(supabase: Supabase): Promise<unknown> {
  const { data, error } = await supabase.rpc("flipkart_order_counts");
  if (error) fail("order counts", error);
  return data;
}

/** The cards: the counts shaped for the screen. */
export async function loadOrderCards(supabase: Supabase, warehouses: { id: string; name: string }[], inTransit: Record<string, number>): Promise<WarehouseOrders[]> {
  return readCards(await loadOrderCounts(supabase), warehouses, inTransit);
}

/** The warehouse the pick list opens on: the one chosen, else the first with orders to pack, else the first. */
export function pickWarehouseOf(wh: string, cards: WarehouseOrders[], warehouses: { id: string }[]): string {
  return wh || cards.find((c) => c.warehouseId && c.to_accept + c.to_pack > 0)?.warehouseId || warehouses[0]?.id || "";
}

/** One page (or, for the CSV, one chunk) of the list on screen. Only the rows asked for leave the database. */
export async function loadOrdersView(
  supabase: Supabase,
  q: OrdersQuery,
  pickWarehouse: string,
  limit: number = PAGE_SIZE,
): Promise<OrdersViewResult> {
  const page = { p_limit: limit, p_offset: q.offset };
  switch (q.view) {
    case "sku": {
      const { data, error } = await supabase.rpc("flipkart_order_skus", { p_wh: orNull(q.wh), p_status: q.status, p_q: orNull(q.q), p_sort: q.sort, p_dir: q.dir, ...page });
      if (error) fail("orders by SKU", error);
      return readSkuRows(data);
    }
    case "list": {
      const { data, error } = await supabase.rpc("flipkart_order_lines", { p_wh: orNull(q.wh), p_status: q.status, p_q: orNull(q.q), p_sort: q.sort, p_dir: q.dir, ...page });
      if (error) fail("order list", error);
      return { view: "list", ...readOrderLines(data) };
    }
    case "pick": {
      if (!pickWarehouse) return { view: "pick", warehouseId: "", total: 0, units: 0, rows: [] };
      const { data, error } = await supabase.rpc("flipkart_pick_list", { p_wh: pickWarehouse, p_today_only: q.pickDue === "today", p_q: orNull(q.q), p_sort: q.sort, p_dir: q.dir, ...page });
      if (error) fail("pick list", error);
      return { view: "pick", warehouseId: pickWarehouse, ...readPickRows(data) };
    }
    case "upcoming": {
      const { data, error } = await supabase.rpc("flipkart_upcoming_vs_stock", { p_wh: orNull(q.wh), p_short_only: q.shortOnly, p_q: orNull(q.q), p_sort: q.sort, p_dir: q.dir, ...page });
      if (error) fail("upcoming vs stock", error);
      return { view: "upcoming", ...readUpcomingRows(data) };
    }
    case "cancelled": {
      const [lines, summary] = await Promise.all([
        supabase.rpc("flipkart_cancel_lines", { p_wh: orNull(q.wh), p_type: q.cancelType === "all" ? null : q.cancelType, p_q: orNull(q.q), p_sort: q.sort, p_dir: q.dir, ...page }),
        // The per-day table is only needed with the first page.
        q.offset === 0 ? supabase.rpc("flipkart_cancel_summary", { p_wh: orNull(q.wh) }) : Promise.resolve({ data: null, error: null }),
      ]);
      if (lines.error || summary.error) fail("cancellations", lines.error ?? summary.error);
      return { view: "cancelled", ...readCancelLines(lines.data), summary: readCancelSummary(summary.data) };
    }
  }
}

/** A SKU's own orders (first 100) and its stock at each warehouse: loaded only when the SKU is opened. */
export async function loadSkuDetail(supabase: Supabase, sku: string, wh: string, status: StatusFilter): Promise<SkuDetail> {
  const [lines, stock] = await Promise.all([
    supabase.rpc("flipkart_order_lines", { p_wh: orNull(wh), p_status: status, p_sku: sku, p_sort: "due", p_dir: "asc", p_limit: 100, p_offset: 0 }),
    supabase.rpc("flipkart_sku_stock", { p_sku: sku }),
  ]);
  if (lines.error || stock.error) fail("SKU orders", lines.error ?? stock.error);
  const parsed = readOrderLines(lines.data);
  return { total: parsed.total, lines: parsed.rows, stock: readStockMap(stock.data) };
}
