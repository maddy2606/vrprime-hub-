import { after } from "next/server";
import { syncReviews } from "@/server/review-sync";
import { serverDb } from "@/server/service-db";

export const maxDuration = 90;

/**
 * The automatic review sync the database starts every 5 days (private.start_review_auto_sync): the same as pressing
 * Sync now. The caller must bring the one-time token the database made for this run; anything else is refused. It
 * answers at once and syncs after, so the database is not kept waiting.
 */
export async function POST(request: Request) {
  const token = request.headers.get("x-auto-token") ?? "";
  const db = serverDb();
  if (!db || !/^[0-9a-f]{64}$/.test(token)) return Response.json({ ok: false }, { status: 403 });
  const { data, error } = await db.rpc("claim_review_auto_token", { p_token: token });
  if (error || data !== true) return Response.json({ ok: false }, { status: 403 });
  const deadline = Date.now() + (maxDuration - 8) * 1000;
  after(() => syncReviews(deadline, "Automatic sync"));
  return Response.json({ ok: true, text: "Syncing" }, { status: 202, headers: { "Cache-Control": "no-store" } });
}
