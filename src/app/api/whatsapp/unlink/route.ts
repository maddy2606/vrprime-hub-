import { unlinkWhatsApp } from "@/server/whatsapp";
import { ownerOnly } from "@/server/whatsapp-route";

export const maxDuration = 30;

/** Unlinks WhatsApp: the site leaves Linked devices on the phone and forgets the session. */
export async function POST(request: Request) {
  const refused = await ownerOnly(request);
  if (refused) return refused;
  return Response.json(await unlinkWhatsApp(), { headers: { "Cache-Control": "no-store" } });
}
