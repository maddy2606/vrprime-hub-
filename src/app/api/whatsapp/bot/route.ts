import { after } from "next/server";
import { handleWebhook, signedByMeta } from "@/server/expense-bot";

export const maxDuration = 60;

/**
 * The expenses bot's webhook, called by Meta (WhatsApp Cloud API). GET is Meta checking the address once, with the
 * verify token set in WHATSAPP_BOT_VERIFY_TOKEN. POST is each message, signed with the app secret; it answers at once
 * and handles the message after, as Meta wants a quick 200.
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const want = process.env.WHATSAPP_BOT_VERIFY_TOKEN?.trim();
  const challenge = q.get("hub.challenge");
  if (q.get("hub.mode") === "subscribe" && want && q.get("hub.verify_token") === want && challenge) return new Response(challenge, { headers: { "content-type": "text/plain" } });
  return new Response("Forbidden", { status: 403 });
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (!signedByMeta(raw, request.headers.get("x-hub-signature-256"))) return new Response("Forbidden", { status: 403 });
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  after(() => handleWebhook(payload));
  return Response.json({ ok: true });
}
