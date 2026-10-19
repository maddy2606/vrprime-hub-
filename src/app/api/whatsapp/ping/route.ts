// A health check anyone can call: it only says whether the WhatsApp and image libraries load on this server.
// It reads nothing and shows nothing about the linked account.
export async function GET() {
  try {
    await import("@whiskeysockets/baileys");
    await import("sharp");
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
