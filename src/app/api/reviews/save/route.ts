import { canManage, getActiveUser } from "@/lib/auth";
import { saveCounts } from "@/server/review-sync";
import { serverDb } from "@/server/service-db";

/**
 * Saves written-review counts read in the owner's own browser (where Flipkart and Shopsy answer, unlike the site's
 * server) as today's check. Body: {"counts": {"<row_no>": <reviews or null>}, "note": "..."}. Owner and admin, and only
 * from this site's own pages; links not in the tracker are ignored, and a link without a count keeps today's earlier one.
 */
export async function POST(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return Response.json({ ok: false, text: "Not allowed." }, { status: 403 });
  const user = await getActiveUser();
  if (!user) return Response.json({ ok: false, text: "Sign in again." }, { status: 401 });
  if (!canManage(user)) return Response.json({ ok: false, text: "Only the owner or an admin can save review counts." }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { counts?: Record<string, unknown>; note?: unknown } | null;
  if (!body?.counts || typeof body.counts !== "object") return Response.json({ ok: false, text: "No counts were sent." }, { status: 400 });
  const db = serverDb();
  if (!db) return Response.json({ ok: false, text: "The site is missing its database key." }, { status: 500 });
  const { data } = await db.from("review_links").select("row_no").eq("active", true);
  const rowNos = ((data ?? []) as { row_no: number }[]).map((r) => r.row_no);
  const counts = new Map<number, number | null>();
  for (const r of rowNos) {
    const v = body.counts[String(r)];
    counts.set(r, typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1_000_000 ? v : null);
  }
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 120) : "Counted in Chrome";
  const result = await saveCounts(rowNos, counts, note);
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
