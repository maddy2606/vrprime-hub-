import { linkWhatsApp, type LinkEvent } from "@/server/whatsapp";
import { ownerOnly } from "@/server/whatsapp-route";

// Showing the QR, waiting for the scan, and reading the group's recent history takes a minute or two.
export const maxDuration = 120;

/** Links WhatsApp. The answer is a stream of lines (JSON): QR codes as they change, progress, and the result. */
export async function POST(request: Request) {
  const refused = await ownerOnly(request);
  if (refused) return refused;
  const deadline = Date.now() + (maxDuration - 6) * 1000;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: LinkEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        } catch {
          // The page was closed; carry on so the link still finishes and is saved.
        }
      };
      await linkWhatsApp(emit, deadline);
      try {
        controller.close();
      } catch {
        // already closed
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
