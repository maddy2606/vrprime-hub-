// Expenses from the WhatsApp group, as plain functions (relative imports only, so `node --test` can load them): pairing a
// payment screenshot with its note, reading an amount from a note or from a screenshot's text, guessing the type of
// expense, and adding up a month.

export const EXPENSE_CATEGORIES = [
  "Packing material",
  "Transport and courier",
  "Fuel",
  "Staff and labour",
  "Food and tea",
  "Rent and utilities",
  "Repairs and maintenance",
  "Cleaning",
  "Office and stationery",
  "Stock purchase",
  "Other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

// English, Hindi and Hinglish words a note might use. The first type whose words appear wins.
const WORDS: [ExpenseCategory, RegExp][] = [
  ["Packing material", /\b(tape|tapes|box|boxes|carton|cartons|bubble|wrap|poly|polybag|pouch|pouches|label|labels|sticker|stickers|packing|packaging|thermocol|stretch|gum|corrugated|dabba)\b/],
  ["Fuel", /\b(petrol|diesel|fuel|cng)\b/],
  ["Transport and courier", /\b(tempo|auto|rickshaw|courier|porter|transport|delivery|freight|truck|cab|uber|ola|rapido|toll|parking|loading|unloading|hamali|bhada|bhaada|kiraya bhada|shipping|dispatch charges?)\b/],
  ["Staff and labour", /\b(salary|salaries|labour|labor|wage|wages|advance|helper|overtime|ot|bonus|majduri|mazdoori|pagar)\b/],
  ["Food and tea", /\b(tea|chai|snack|snacks|lunch|dinner|breakfast|food|water|coffee|biscuit|biscuits|nashta|khana|samosa|pani)\b/],
  ["Rent and utilities", /\b(rent|kiraya|electric|electricity|light bill|lightbill|bijli|internet|wifi|wi-fi|recharge|broadband|phone bill|water bill)\b/],
  ["Repairs and maintenance", /\b(repair|repairs|plumber|electrician|carpenter|maintenance|mistri|fixing|welding)\b/],
  ["Cleaning", /\b(clean|cleaning|broom|jhadu|phenyl|mop|dustbin|garbage|sweeper|housekeeping)\b/],
  ["Office and stationery", /\b(pen|pens|paper|stationery|xerox|print|printing|ink|cartridge|register|marker|stapler)\b/],
  ["Stock purchase", /\b(purchase|purchased|material|raw material|bottle|bottles|cap|caps|refill|stock)\b/],
];

/** The type of expense a note sounds like, or "Other". */
export function categoryFor(text: string | null | undefined): ExpenseCategory {
  const t = (text ?? "").toLowerCase();
  for (const [category, re] of WORDS) if (re.test(t)) return category;
  return "Other";
}

const toNumber = (s: string): number | null => {
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};

/**
 * The amount a note gives, if any: one marked with ₹, Rs, INR, rupees or /-, else the biggest plain number from 10 to
 * 9,99,999 that is not part of a date, a time or a phone number. "Tape 2 rolls 340" is 340.
 */
export function noteAmount(text: string | null | undefined): number | null {
  const t = (text ?? "").replace(/₹/g, " ₹ ");
  const marked = /(?:₹|\brs\.?|\binr\b|\brupees?\b)\s*([\d,]+(?:\.\d{1,2})?)|([\d,]+(?:\.\d{1,2})?)\s*(?:₹|\/-|\brs\b|\brupees?\b)/i.exec(t);
  if (marked) return toNumber(marked[1] ?? marked[2]);
  const cleaned = t
    .replace(/\b\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b/g, " ")
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " ")
    .replace(/\+?\b\d{10,}\b/g, " ");
  const plain = [...cleaned.matchAll(/(?<![\d.])(\d{1,3}(?:,\d{2,3})+|\d{2,6})(?:\.\d{1,2})?(?![\d])/g)]
    .map((m) => toNumber(m[0]))
    .filter((n): n is number => n !== null && n >= 10 && n <= 999_999);
  return plain.length ? Math.max(...plain) : null;
}

export type Receipt = { amount: number | null; paidTo: string | null; reference: string | null };

/**
 * What a payment screenshot says, from its recognised text (Google Pay, PhonePe, Paytm, a bank app). Text recognition
 * often reads ₹ as another sign, so an amount is taken from a ₹/Rs mark first, then from a line that is only a number.
 */
export function readReceipt(text: string | null | undefined): Receipt {
  const t = (text ?? "").replace(/\r/g, "");
  const lines = t
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  let amount: number | null = null;
  const marked = /(?:₹|\brs\.?|\binr)\s*([\d,]+(?:\.\d{1,2})?)/i.exec(t);
  if (marked) amount = toNumber(marked[1]);
  if (amount === null) {
    // A line that is just an amount, like "1,250" or "500.00", near the top where the apps print it big.
    for (const l of lines.slice(0, 12)) {
      const m = /^[^\w\d]{0,2}\s*([\d]{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?|\d{2,6}(?:\.\d{1,2})?)$/.exec(l);
      if (m) {
        amount = toNumber(m[1]);
        if (amount !== null) break;
      }
    }
  }
  const to = /(?:paid to|sent to|payment to|paying|to\s*:)\s*\n?\s*([A-Za-z][A-Za-z0-9 .&'@-]{1,48})/i.exec(t);
  const ref = /(?:upi\s*(?:transaction|txn|ref(?:erence)?)?\s*(?:id|no\.?|number)|utr(?:\s*no\.?)?|transaction\s*id|txn\s*id|ref(?:erence)?\s*no\.?)\s*[:\-]?\s*\n?\s*([A-Z0-9]{8,30})/i.exec(t);
  return { amount, paidTo: to ? to[1].trim().replace(/\s+/g, " ") : null, reference: ref ? ref[1] : null };
}

/** A message read from the group. */
export type GroupMessage = { id: string; sentAt: string; sender: string | null; kind: "text" | "image" | "document"; body: string | null; deleted?: boolean };

/** An expense as the group shows it, before any correction by the owner. */
export type DerivedExpense = {
  key: string;
  imageMessageId: string | null;
  textMessageId: string | null;
  spentAt: string;
  sender: string | null;
  reason: string | null;
  textAmount: number | null;
  category: ExpenseCategory;
};

/** How far apart a screenshot and its note can be, from the same person. */
export const PAIR_MINUTES = 15;

/**
 * One expense per screenshot (or PDF), with its note: the caption, else the nearest note the same person sent within
 * 15 minutes (the one after first, as people usually send the screenshot and then say what it was). A note with an amount
 * and no screenshot near it is an expense of its own (paid in cash, say). Other chat is left out, and so are deleted
 * messages.
 */
export function buildExpenses(messages: GroupMessage[]): DerivedExpense[] {
  const list = messages.filter((m) => !m.deleted).sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt) || a.id.localeCompare(b.id));
  const used = new Set<string>();
  const near = (a: GroupMessage, b: GroupMessage) => a.sender === b.sender && Math.abs(Date.parse(a.sentAt) - Date.parse(b.sentAt)) <= PAIR_MINUTES * 60_000;
  const out: DerivedExpense[] = [];
  list.forEach((m, i) => {
    if (m.kind === "text") return;
    let reason = m.body?.trim() || null;
    let textMessageId: string | null = null;
    if (!reason) {
      const after = list.slice(i + 1).find((x) => x.kind === "text" && !used.has(x.id) && near(x, m) && x.body?.trim());
      const before = [...list.slice(0, i)].reverse().find((x) => x.kind === "text" && !used.has(x.id) && near(x, m) && x.body?.trim());
      const note = after ?? before;
      if (note) {
        used.add(note.id);
        reason = note.body!.trim();
        textMessageId = note.id;
      }
    }
    out.push({ key: m.id, imageMessageId: m.id, textMessageId, spentAt: m.sentAt, sender: m.sender, reason, textAmount: noteAmount(reason), category: categoryFor(reason) });
  });
  for (const m of list) {
    if (m.kind !== "text" || used.has(m.id) || !m.body?.trim()) continue;
    // A note right next to a screenshot belongs to it even when the screenshot already had a caption.
    if (list.some((x) => x.kind !== "text" && near(x, m))) continue;
    const amount = noteAmount(m.body);
    if (amount === null) continue;
    out.push({ key: m.id, imageMessageId: null, textMessageId: m.id, spentAt: m.sentAt, sender: m.sender, reason: m.body.trim(), textAmount: amount, category: categoryFor(m.body) });
  }
  return out.sort((a, b) => Date.parse(a.spentAt) - Date.parse(b.spentAt));
}

/** "2026-10": the month of a moment, in India. */
export function monthOf(iso: string): string {
  return new Date(Date.parse(iso) + 5.5 * 3_600_000).toISOString().slice(0, 7);
}

export type ExpenseLike = { amount: number | null; category: string; status: "new" | "checked" | "ignored"; amount_from?: string | null };

/** A month added up: the total, how many, how many still to check, and each type's share, biggest first. */
export function monthSummary(rows: ExpenseLike[]): { total: number; count: number; toCheck: number; noAmount: number; byCategory: { category: string; total: number; count: number }[] } {
  const live = rows.filter((r) => r.status !== "ignored");
  const by = new Map<string, { total: number; count: number }>();
  for (const r of live) {
    const c = by.get(r.category) ?? { total: 0, count: 0 };
    c.total += r.amount ?? 0;
    c.count += 1;
    by.set(r.category, c);
  }
  return {
    total: Math.round(live.reduce((n, r) => n + (r.amount ?? 0), 0) * 100) / 100,
    count: live.length,
    toCheck: live.filter((r) => r.status === "new").length,
    noAmount: live.filter((r) => r.amount === null).length,
    byCategory: [...by.entries()].map(([category, v]) => ({ category, ...v })).sort((a, b) => b.total - a.total || a.category.localeCompare(b.category)),
  };
}

/** The amount to use: typed by the owner, else read from the screenshot, else from the note. */
export function pickAmount(e: { typed?: number | null; read: number | null; text: number | null }): { amount: number | null; from: "typed" | "screenshot" | "note" | null } {
  if (e.typed != null) return { amount: e.typed, from: "typed" };
  if (e.read != null) return { amount: e.read, from: "screenshot" };
  if (e.text != null) return { amount: e.text, from: "note" };
  return { amount: null, from: null };
}
