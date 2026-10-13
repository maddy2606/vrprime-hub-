import { getActiveUser } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { todayIST } from "@/lib/format";
import { returnsQuerySchema, type ReturnLine } from "@/lib/returns-view";
import { createClient } from "@/lib/supabase/server";
import { warehousesFor } from "@/server/flipkart-data";
import { loadReturnsPage } from "@/server/returns-view";

// The whole returns list behind Download CSV, built a chunk at a time.
const CHUNK = 200;
const MAX_ROWS = 20_000;

export async function GET(request: Request) {
  const user = await getActiveUser();
  if (!user) return new Response("Not signed in", { status: 401 });
  const p = new URL(request.url).searchParams;
  const parsed = returnsQuerySchema.safeParse({
    source: p.get("source") ?? "all",
    wh: p.get("wh") ?? "",
    q: (p.get("q") ?? "").slice(0, 100),
    sort: p.get("sort") ?? "date",
    dir: p.get("dir") ?? "desc",
    offset: 0,
  });
  if (!parsed.success) return new Response("That request was not understood", { status: 400 });

  const supabase = await createClient();
  const warehouses = await warehousesFor(user);
  const nameOf = (id: string | null) => warehouses.find((w) => w.id === id)?.name ?? "Unknown";
  const rows: ReturnLine[] = [];
  let total = 0;
  for (let offset = 0; offset < MAX_ROWS; offset += CHUNK) {
    const page = await loadReturnsPage(supabase, { ...parsed.data, offset }, CHUNK);
    total = page.total;
    rows.push(...page.rows);
    if (page.rows.length < CHUNK || rows.length >= total) break;
  }
  const label = { courier_return: "Courier return", customer_return: "Customer return" } as const;
  const csv = toCsv(
    ["Created", "SKU", "Type", "Reason", "Sub-reason", "Qty", "Warehouse", "Status", "Order ID"],
    rows.map((r) => [r.created_date, r.sku, label[r.source], r.reason, r.sub_reason, r.quantity, nameOf(r.warehouse_id), r.return_status, r.order_id]),
  );
  return new Response(`﻿${csv}`, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="vrprime-returns-${todayIST()}.csv"`, "Cache-Control": "no-store" },
  });
}
