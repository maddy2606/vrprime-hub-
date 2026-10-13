import { getActiveUser } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { stockCsv, stockQuerySchema } from "@/lib/stock-view";
import { loadStockDesk } from "@/server/stock-view";

// The whole list behind Download CSV on the Stock tab, worked out on the server.
export async function GET(request: Request) {
  const user = await getActiveUser();
  if (!user) return new Response("Not signed in", { status: 401 });
  const p = new URL(request.url).searchParams;
  const parsed = stockQuerySchema.safeParse({
    view: p.get("view") ?? "low",
    wh: p.get("wh") ?? "",
    hide: p.get("hide") === "1",
    q: (p.get("q") ?? "").slice(0, 100),
    sort: p.get("sort") ?? "sku",
    dir: p.get("dir") ?? "asc",
    offset: 0,
  });
  if (!parsed.success) return new Response("That request was not understood", { status: 400 });

  const desk = await loadStockDesk(user, parsed.data);
  if (desk.kind !== "ready") return new Response("There is no stock yet", { status: 404 });
  const { headers, body } = stockCsv(desk.page.data, parsed.data, desk.cover.soonest);
  const name = `vrprime-stock-${parsed.data.view}-${desk.meta.snapshotDate}.csv`;
  return new Response(`\uFEFF${toCsv(headers, body)}`, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
  });
}
