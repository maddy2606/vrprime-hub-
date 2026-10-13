import { getActiveUser } from "@/lib/auth";
import { toCsv, type CsvCell } from "@/lib/csv";
import { todayIST } from "@/lib/format";
import { BUCKET_LABEL, BUCKETS, ordersQuerySchema, type OrdersQuery, type OrdersViewResult } from "@/lib/orders-view";
import { createClient } from "@/lib/supabase/server";
import { warehousesFor } from "@/server/flipkart-data";
import { loadOrderCards, loadOrdersView, pickWarehouseOf } from "@/server/orders-view";

// The whole list behind the Download CSV button on the Orders tab, built here a chunk at a time, so the page itself
// never has to carry it.
const CHUNK = 200;
const MAX_ROWS = 20_000;

function readQuery(params: URLSearchParams): OrdersQuery | null {
  const parsed = ordersQuerySchema.safeParse({
    view: params.get("view") ?? "sku",
    status: params.get("status") ?? "active",
    wh: params.get("wh") ?? "",
    q: (params.get("q") ?? "").slice(0, 100),
    sort: params.get("sort") ?? "due",
    dir: params.get("dir") ?? "asc",
    offset: 0,
    pickDue: params.get("pickDue") ?? "today",
    shortOnly: params.get("shortOnly") === "1",
    cancelType: params.get("cancelType") ?? "all",
  });
  return parsed.success ? parsed.data : null;
}

export async function GET(request: Request) {
  const user = await getActiveUser();
  if (!user) return new Response("Not signed in", { status: 401 });
  const query = readQuery(new URL(request.url).searchParams);
  if (!query) return new Response("That request was not understood", { status: 400 });

  const supabase = await createClient();
  const warehouses = await warehousesFor(user);
  const nameOf = (id: string | null) => warehouses.find((w) => w.id === id)?.name ?? "Unknown";
  const pickWarehouse = query.view === "pick" ? pickWarehouseOf(query.wh, await loadOrderCards(supabase, warehouses, {}), warehouses) : "";

  const rows: (OrdersViewResult["rows"][number])[] = [];
  let total = 0;
  for (let offset = 0; offset < MAX_ROWS; offset += CHUNK) {
    const page = await loadOrdersView(supabase, { ...query, offset }, pickWarehouse, CHUNK);
    total = page.total;
    rows.push(...(page.rows as unknown as typeof rows));
    if (page.rows.length < CHUNK || rows.length >= total) break;
  }

  const day = todayIST();
  let headers: string[] = [];
  let body: CsvCell[][] = [];
  let name = `vrprime-orders-${day}.csv`;

  if (query.view === "sku") {
    const items = rows as unknown as Extract<OrdersViewResult, { view: "sku" }>["rows"];
    const whCols = warehouses.filter((w) => items.some((g) => g.by_wh[w.id]));
    headers = ["SKU", "Title", "Orders", "Units", ...whCols.map((w) => `Units ${w.name}`), "Earliest dispatch by", ...BUCKETS.map((b) => BUCKET_LABEL[b])];
    body = items.map((g) => [g.sku, g.title, g.orders, g.units, ...whCols.map((w) => g.by_wh[w.id] ?? 0), g.active_due ?? g.due, ...BUCKETS.map((b) => g[b])]);
    name = `vrprime-orders-by-sku-${day}.csv`;
  } else if (query.view === "list") {
    const items = rows as unknown as Extract<OrdersViewResult, { view: "list" }>["rows"];
    headers = ["Order ID", "SKU", "Qty", "Warehouse", "Status", "On hold", "Dispatch by", "Active from"];
    body = items.map((o) => [o.order_id, o.sku, o.quantity, nameOf(o.warehouse_id), BUCKET_LABEL[o.bucket], o.hold ? "yes" : "", o.dispatch_by, o.dispatch_after]);
    name = `vrprime-order-list-${day}.csv`;
  } else if (query.view === "pick") {
    const items = rows as unknown as Extract<OrdersViewResult, { view: "pick" }>["rows"];
    headers = ["SKU", "Title", "Units to pack", "Units To Accept", "Units To Pack", "Orders", "Dispatch by", "Stock", "Short by"];
    body = items.map((r) => [r.sku, r.title, r.units, r.to_accept, r.to_pack, r.orders, r.due, r.stock, r.stock !== null && r.stock < r.units ? r.units - r.stock : 0]);
    name = `vrprime-pick-list-${nameOf(pickWarehouse).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${day}.csv`;
  } else if (query.view === "upcoming") {
    const items = rows as unknown as Extract<OrdersViewResult, { view: "upcoming" }>["rows"];
    headers = ["SKU", "Title", "Warehouse", "Upcoming units", "Stock", "Short by", "First active", "Orders", "Active units"];
    body = items.map((r) => [r.sku, r.title, nameOf(r.warehouse_id), r.upcoming, r.stock, r.short, r.first_active, r.orders, r.active]);
    name = `vrprime-upcoming-vs-stock-${day}.csv`;
  } else {
    const items = rows as unknown as Extract<OrdersViewResult, { view: "cancelled" }>["rows"];
    headers = ["Cancelled", "By", "SKU", "Order ID", "Qty", "Warehouse", "Reason"];
    body = items.map((c) => [c.cancelled_at, c.cancel_type, c.sku, c.order_id, c.quantity, nameOf(c.warehouse_id), [c.cancel_reason, c.cancel_sub_reason].filter(Boolean).join(" / ")]);
    name = `vrprime-cancellations-${day}.csv`;
  }

  // The leading BOM makes Excel read the file as UTF-8.
  return new Response(`﻿${toCsv(headers, body)}`, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
  });
}
