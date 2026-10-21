import { canManage, getActiveUser } from "@/lib/auth";
import { syncReviews } from "@/server/review-sync";

export const maxDuration = 90;

/** The Review tracker's Sync now button. Owner and admin, and only from this site's own pages. */
export async function POST(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return Response.json({ ok: false, text: "Not allowed." }, { status: 403 });
  const user = await getActiveUser();
  if (!user) return Response.json({ ok: false, text: "Sign in again." }, { status: 401 });
  if (!canManage(user)) return Response.json({ ok: false, text: "Only the owner or an admin can sync reviews." }, { status: 403 });
  const result = await syncReviews(Date.now() + (maxDuration - 8) * 1000, "Sync now");
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
