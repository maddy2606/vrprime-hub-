import "server-only";
import { cleanRead, type ReceiptRead } from "@/lib/expense-bot";
import { logError } from "@/lib/redact";

// Reads a payment screenshot with Google's Gemini (free tier): whether it is a completed payment, the amount, the payee,
// the UPI reference and when. Without GEMINI_API_KEY, or when the model fails, it returns null and the bot asks the
// sender for the amount instead.

const PROMPT = `This image (or PDF) was sent by a warehouse team in India as proof of a payment they made, usually a screenshot
from Google Pay, PhonePe, Paytm, BHIM or a bank app. Answer in JSON:
- payment: true only if it shows a completed, successful payment. False for a QR code to scan, a bill, a quotation,
  a chat, a photo, or a failed or pending payment.
- amount: the rupees paid, as a number (5000 for "₹5,000"). Null if not shown.
- paid_to: the payee's name exactly as shown. Null if not shown.
- reference: the UPI transaction ID, UTR or reference number. Null if not shown.
- paid_at: the date and time of the payment as ISO 8601 with the +05:30 offset. Null if not shown.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    payment: { type: "BOOLEAN" },
    amount: { type: "NUMBER", nullable: true },
    paid_to: { type: "STRING", nullable: true },
    reference: { type: "STRING", nullable: true },
    paid_at: { type: "STRING", nullable: true },
  },
  required: ["payment", "amount", "paid_to", "reference", "paid_at"],
};

/** Whether screenshots can be read: the Gemini key is set. */
export const canReadReceipts = () => Boolean(process.env.GEMINI_API_KEY?.trim());

export async function readReceiptImage(file: Buffer, mimeType: string): Promise<ReceiptRead | null> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return null;
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-flash-latest";
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType, data: file.toString("base64") } }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0 },
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) {
      logError("receipt ai", new Error(`Gemini answered ${res.status}: ${(await res.text()).slice(0, 300)}`));
      return null;
    }
    const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const out = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    return cleanRead(JSON.parse(out));
  } catch (e) {
    logError("receipt ai", e);
    return null;
  }
}
