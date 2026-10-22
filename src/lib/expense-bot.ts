// The expenses WhatsApp bot, as plain functions (relative imports only, so `node --test` can load them).
//
// The team sends each "payment done" screenshot to the bot's own number (Meta's official WhatsApp Cloud API) instead
// of the group. The bot reads it, asks which warehouse and which type with tap buttons, and saves it checked. Which step
// comes next is carried in the button ids, so the bot keeps no state of its own besides the expense row.

import { createHmac, timingSafeEqual } from "node:crypto";
import { EXPENSE_CATEGORIES, type ExpenseCategory } from "./expenses.ts";

/** Meta signs every webhook with the app secret: "sha256=<hex HMAC of the raw body>". Anything else is refused. */
export function signatureOk(raw: string, header: string | null | undefined, secret: string | null | undefined): boolean {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const want = Buffer.from(createHmac("sha256", secret).update(raw, "utf8").digest("hex"), "utf8");
  const got = Buffer.from(header.slice(7), "utf8");
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Expenses from the bot are keyed "bot:<phone>:<WhatsApp message id>", so a retried webhook never saves one twice. */
export const botKey = (phone: string, messageId: string) => `bot:${phone}:${messageId}`;
export const botPrefix = (phone: string) => `bot:${phone}:`;
export const isBotKey = (key: string | null | undefined) => typeof key === "string" && key.startsWith("bot:");

/**
 * Who may send expenses, from the WHATSAPP_BOT_SENDERS setting: "919876543210:Jigar, 918888888888:Aman". Numbers are
 * kept as digits with the country code (how WhatsApp sends them); a number with no name is named by its last 4 digits.
 */
export function parseSenders(raw: string | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (raw ?? "").split(/[,;\n]/)) {
    const [num, ...name] = part.split(":");
    const digits = (num ?? "").replace(/\D/g, "");
    if (digits.length < 10) continue;
    const phone = digits.length === 10 ? `91${digits}` : digits;
    out.set(phone, name.join(":").trim() || `…${phone.slice(-4)}`);
  }
  return out;
}

/** A reply that is only an amount: "1250", "₹1,250", "Rs 1250/-", "1.2k". Anything else is a note. */
export function amountReply(text: string | null | undefined): number | null {
  const m = /^\s*(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d{1,2})?)\s*(k)?\s*(?:\/-|rs\.?|rupees?)?\s*$/i.exec(text ?? "");
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1);
  return Number.isFinite(n) && n > 0 && n <= 10_000_000 ? Math.round(n * 100) / 100 : null;
}

// ---- Buttons ---------------------------------------------------------------------------------------------------------
// A tap comes back with the id it was sent with. Ids say what to do and to which expense.

export type BotAction =
  /** The warehouse it was for ("general" for none); then the type is asked when `askType`, else it is saved. */
  | { kind: "warehouse"; expenseId: string; warehouseId: string | null; askType: boolean }
  | { kind: "type"; expenseId: string; category: ExpenseCategory }
  | { kind: "save"; expenseId: string }
  | { kind: "change"; expenseId: string }
  /** "It is a payment" on a screenshot that did not look like one; "skip" sets it aside. */
  | { kind: "payment"; expenseId: string }
  | { kind: "skip"; expenseId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function actionId(a: BotAction): string {
  switch (a.kind) {
    case "warehouse":
      return `wh|${a.expenseId}|${a.warehouseId ?? "general"}|${a.askType ? 1 : 0}`;
    case "type":
      return `ty|${a.expenseId}|${EXPENSE_CATEGORIES.indexOf(a.category)}`;
    case "save":
      return `ok|${a.expenseId}`;
    case "change":
      return `ch|${a.expenseId}`;
    case "payment":
      return `pay|${a.expenseId}`;
    case "skip":
      return `skip|${a.expenseId}`;
  }
}

export function parseAction(id: string | null | undefined): BotAction | null {
  const [kind, expenseId, a, b] = (id ?? "").split("|");
  if (!expenseId || !UUID.test(expenseId)) return null;
  if (kind === "wh") {
    if (!a || (a !== "general" && !UUID.test(a))) return null;
    return { kind: "warehouse", expenseId, warehouseId: a === "general" ? null : a, askType: b === "1" };
  }
  if (kind === "ty") {
    const category = EXPENSE_CATEGORIES[Number(a)];
    return category && /^\d+$/.test(a ?? "") ? { kind: "type", expenseId, category } : null;
  }
  if (kind === "ok") return { kind: "save", expenseId };
  if (kind === "ch") return { kind: "change", expenseId };
  if (kind === "pay") return { kind: "payment", expenseId };
  if (kind === "skip") return { kind: "skip", expenseId };
  return null;
}

/** The types offered as buttons: WhatsApp lists hold 10 rows, so the 9 most used plus Other. */
export const BOT_CATEGORIES: ExpenseCategory[] = [
  "Transport and courier",
  "Staff and labour",
  "Packing material",
  "Food and tea",
  "Fuel",
  "Repairs and maintenance",
  "Equipment and furniture",
  "Rent and utilities",
  "Stock purchase",
  "Other",
];

// ---- What the AI read --------------------------------------------------------------------------------------------------

export type ReceiptRead = {
  /** A completed payment (not a QR code to scan, a bill, or a failed or pending payment). */
  payment: boolean;
  amount: number | null;
  paidTo: string | null;
  reference: string | null;
  /** When the payment was made, if the screenshot shows it. */
  paidAt: string | null;
};

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ").slice(0, max) : null);

/** What the model answered, made safe: numbers are numbers, text is short, a date is a real date. */
export function cleanRead(raw: unknown): ReceiptRead {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const n = typeof r.amount === "number" ? r.amount : typeof r.amount === "string" ? Number(r.amount.replace(/[₹,\s]/g, "")) : NaN;
  const at = typeof r.paid_at === "string" ? Date.parse(r.paid_at) : NaN;
  const ref = text(r.reference, 100);
  return {
    payment: r.payment === true,
    amount: Number.isFinite(n) && n > 0 && n <= 10_000_000 ? Math.round(n * 100) / 100 : null,
    paidTo: text(r.paid_to, 120),
    reference: ref && /^[A-Za-z0-9-]{6,}$/.test(ref) ? ref : null,
    paidAt: Number.isFinite(at) ? new Date(at).toISOString() : null,
  };
}

/** When to date it: the payment's own time when it is believable (up to 30 days before it was sent), else when it was sent. */
export function spentAt(read: ReceiptRead, sentAt: string): string {
  if (!read.paidAt) return sentAt;
  const gap = Date.parse(sentAt) - Date.parse(read.paidAt);
  return gap >= -3_600_000 && gap <= 30 * 86_400_000 ? read.paidAt : sentAt;
}

// ---- What the bot says ----------------------------------------------------------------------------------------------

const rupees = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** "₹5,000 to Sumit Kumar Singh" */
export function headline(e: { amount: number | null; paid_to: string | null }): string {
  return `${e.amount === null ? "Amount not read" : rupees(e.amount)}${e.paid_to ? ` to ${e.paid_to}` : ""}`;
}

/** The saved expense in two lines: what, and its type and warehouse. */
export function summary(e: { amount: number | null; paid_to: string | null; category: string }, warehouse: string): string {
  return `${headline(e)}\n${e.category} · ${warehouse}`;
}

export const HELP =
  "Send a payment done screenshot here (Google Pay, PhonePe, Paytm or the bank app). Add a note with it if you like, such as \"Delhi tempo\". I read the amount and ask which warehouse it was for.";
