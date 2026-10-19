import { after } from "next/server";
import { fetchWhatsApp } from "@/server/whatsapp";
import { serverDb } from "@/server/service-db";

export const maxDuration = 90;

/**
 * The automatic fetch the database starts every 12 hours (9 am and 9 pm): the same as pressing Fetch from WhatsApp.
 * The caller must bring the one-time token the database made for this run (private.start_whatsapp_auto_fetch);
 * anything else is refused. It answers at once and fetches after, so the database is not kept waiting.
 */
export async function POST(request: Request) {
  const token = request.headers.get("x-auto-token") ?? "";
  const db = serverDb();
  if (!db || !/^[0-9a-f]{64}$/.test(token)) return Response.json({ ok: false }, { status: 403 });
  const { data, error } = await db.rpc("claim_whatsapp_auto_token", { p_token: token });
  if (error || data !== true) return Response.json({ ok: false }, { status: 403 });
  const deadline = Date.now() + (maxDuration - 6) * 1000;
  after(() => fetchWhatsApp(deadline, true));
  return Response.json({ ok: true, text: "Fetching" }, { status: 202, headers: { "Cache-Control": "no-store" } });
}
