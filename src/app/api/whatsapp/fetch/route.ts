import { fetchWhatsApp } from "@/server/whatsapp";
import { ownerOnly } from "@/server/whatsapp-route";

export const maxDuration = 90;

/** The Fetch from WhatsApp button: reads what arrived in the expenses group since last time. */
export async function POST(request: Request) {
  const refused = await ownerOnly(request);
  if (refused) return refused;
  const result = await fetchWhatsApp(Date.now() + (maxDuration - 6) * 1000);
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
