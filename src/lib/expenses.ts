// Expenses from the WhatsApp group, as plain functions (relative imports only, so `node --test` can load them).
//
// The rule, as the owner set it: only a "payment done" screenshot is an expense. A QR code someone posts to be paid (a
// "scanner") is never one, and chat is never one; a message only ever gives the reason next to a screenshot. Whether a
// screenshot is a payment is read from its text (Paid, Successful, UPI transaction ID, and an amount).

export const EXPENSE_CATEGORIES = [
  "Packing material",
  "Transport and courier",
  "Travel",
  "Fuel",
  "Staff and labour",
  "Food and tea",
  "Rent and utilities",
  "Repairs and maintenance",
  "Equipment and furniture",
  "Cleaning",
  "Office and stationery",
  "Stock purchase",
  "Other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

// English, Hindi and Hinglish words the group uses (and payee names on screenshots). The first type that matches wins.
const WORDS: [ExpenseCategory, RegExp][] = [
  ["Packing material", /\b(tape|tapes|box|boxes|carton|cartons|crtn|ctn|bubble|wrap|poly|polybag|pouch|pouches|label|labels|sticker|stickers|packing|packaging|thermocol|stretch|gum|corrugated|dabba)\b/],
  ["Fuel", /\b(petrol|diesel|fuel|cng|indian oil|bharat petroleum|hpcl|iocl)\b/],
  ["Travel", /\b(ticket|tickets|train|flight|bus|irctc|redbus|hotel|stay)\b/],
  ["Transport and courier", /\b(tempo|auto|rickshaw|courier|porter|transport|delivery|freight|truck|cab|uber|ola|rapido|toll|parking|loading|unloading|hamali|bhada|bhaada|shipping|delhivery|bluedart|dtdc|ekart|shiprocket|xpressbees|shadowfax|gaadi)\b/],
  ["Staff and labour", /\b(salary|salaries|labour|labor|laber|lebour|wage|wages|advance|helper|overtime|ot|bonus|majduri|mazdoori|pagar)\b/],
  ["Food and tea", /\b(tea|chai|snack|snacks|lunch|dinner|breakfast|food|water|paani|pani|coffee|biscuit|biscuits|nashta|khana|samosa|swiggy|zomato)\b/],
  ["Rent and utilities", /\b(rent|kiraya|electric|electricity|light bill|lightbill|bijli|internet|wifi|wi-fi|recharge|broadband|phone bill|water bill)\b/],
  ["Repairs and maintenance", /\b(repair|repairs|plumber|electrician|carpenter|maintenance|mistri|fixing|welding|wheel|wheels)\b/],
  ["Equipment and furniture", /\b(inverter|battery|trolley|gadda|mattress|table|chair|rack|racks|fan|cooler|machine|weighing|scale|printer|cctv|camera)\b/],
  ["Cleaning", /\b(clean|cleaning|broom|jhadu|phenyl|mop|dustbin|garbage|sweeper|housekeeping)\b/],
  ["Office and stationery", /\b(pen|pens|paper|stationery|xerox|print|printing|ink|cartridge|register|marker|stapler)\b/],
  ["Stock purchase", /\b(purchase|purchased|material|raw material|bottle|bottles|cap|caps|refill|stock)\b/],
];

/** The type of expense a note (or a payee name) sounds like, or "Other". */
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
 * 9,99,999 that is not part of a date, a time or a phone number. "12k" is 12,000. "Tape 2 rolls 340" is 340.
 */
export function noteAmount(text: string | null | undefined): number | null {
  const t = (text ?? "")
    .replace(/₹/g, " ₹ ")
    .replace(/(\d+(?:\.\d+)?)\s*k\b/gi, (_, n: string) => String(Math.round(Number(n) * 1000)));
  const marked = /(?:₹|\brs\.?|\binr\b|\brupees?\b)\s*([\d,]+(?:\.\d{1,2})?)|([\d,]+(?:\.\d{1,2})?)\s*(?:₹|\/-|\brs\b|\brupees?\b)/i.exec(t);
  if (marked) return toNumber(marked[1] ?? marked[2]);
  const cleaned = t
    .replace(/@\d{6,}/g, " ")
    .replace(/\b\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b/g, " ")
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " ")
    .replace(/\+?\b\d{10,}\b/g, " ");
  const plain = [...cleaned.matchAll(/(?<![\d.])(\d{1,3}(?:,\d{2,3})+|\d{2,6})(?:\.\d{1,2})?(?![\d])/g)]
    .map((m) => toNumber(m[0]))
    .filter((n): n is number => n !== null && n >= 10 && n <= 999_999);
  return plain.length ? Math.max(...plain) : null;
}

/** A running tally ("560 650 Total 3490 Available Balance ~ 18114"): never a reason, it repeats payments already counted. */
export function isTally(text: string | null | undefined): boolean {
  return /available\s*bal|\bbalance\b|\btotal\b/i.test(text ?? "");
}

/** A note as a reason: without @mentions, WhatsApp bold stars and extra spaces. */
export function cleanNote(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/@\d{6,}/g, " ")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type Receipt = { amount: number | null; paidTo: string | null; reference: string | null; payment: boolean };

/**
 * What a screenshot says, from its recognised text (Google Pay, PhonePe, Paytm, BHIM, a bank app), and whether it is a
 * payment that went through: an amount plus words like Paid, Successful, Completed, Sent, Debited or a UPI/UTR reference.
 * A QR code to scan ("Scan to pay") is not a payment. Recognition often reads ₹ as another sign, so an amount is taken from
 * a ₹/Rs mark first, then from a line that is only a number.
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
    for (const l of lines.slice(0, 14)) {
      const m = /^[^\w\d]{0,2}\s*([\d]{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?|\d{2,6}(?:\.\d{1,2})?)$/.exec(l);
      if (m) {
        amount = toNumber(m[1]);
        if (amount !== null) break;
      }
    }
  }
  const to = /(?:paid to|sent to|payment to|paying|to\s*:)\s*\n?\s*([A-Za-z][A-Za-z0-9 .&'@-]{1,48})/i.exec(t);
  const ref = /(?:upi\s*(?:transaction|txn|ref(?:erence)?)?\s*(?:id|no\.?|number)|utr(?:\s*no\.?)?|transaction\s*id|txn\s*id|ref(?:erence)?\s*no\.?)\s*[:\-]?\s*\n?\s*([A-Z0-9]{8,30})/i.exec(t);
  const done = /\b(paid|payment successful|successful|success|completed|complete|sent|debited|money sent|transfer(?:red)? successful|upi transaction id|transaction id|utr|ref(?:erence)? no)\b/i.test(t);
  const scanOnly = /\bscan\b/i.test(t) && !/\b(paid|successful|completed|debited|sent)\b/i.test(t);
  return {
    amount,
    paidTo: to ? to[1].trim().replace(/\s+/g, " ") : null,
    reference: ref ? ref[1] : null,
    payment: amount !== null && done && !scanOnly,
  };
}

/** A message read from the group. `isQr` is true for an image that is a QR code, null while not checked yet. */
export type GroupMessage = {
  id: string;
  sentAt: string;
  sender: string | null;
  /** Who sent it, for pairing a screenshot with its note ('me' for the linked phone). Falls back to `sender`. */
  senderId?: string | null;
  kind: "text" | "image" | "document";
  body: string | null;
  deleted?: boolean;
  isQr?: boolean | null;
};

/** A screenshot that may be a payment, with its reason, before any correction by the owner. */
export type DerivedExpense = {
  key: string;
  imageMessageId: string;
  textMessageId: string | null;
  spentAt: string;
  sender: string | null;
  reason: string | null;
  textAmount: number | null;
  category: ExpenseCategory;
};

/** Notes this close to a screenshot, from the same person, are its reason. */
export const NEAR_MINUTES = 3;
/** Further than that, the nearest single note from the same person still is, up to this far. */
export const PAIR_MINUTES = 15;
/** A payment made from a QR someone posted takes that QR's reason when it has none of its own, up to this long after. */
export const QR_HOURS = 3;

/**
 * One candidate expense per screenshot that is not a QR code (and per PDF), with its reason: the caption and the notes
 * the same person sent within 3 minutes, else the nearest note from them within 15 minutes, else (when it was paid from a
 * QR someone posted shortly before) that QR's caption and notes. Tallies are never reasons. Text on its own, QR codes and
 * deleted messages are never expenses.
 */
export function buildExpenses(messages: GroupMessage[]): DerivedExpense[] {
  const list = messages.filter((m) => !m.deleted).sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt) || a.id.localeCompare(b.id));
  const who = (m: GroupMessage) => m.senderId ?? m.sender ?? "";
  const gap = (a: GroupMessage, b: GroupMessage) => Math.abs(Date.parse(a.sentAt) - Date.parse(b.sentAt));
  const note = (m: GroupMessage) => m.kind === "text" && !isTally(m.body) && cleanNote(m.body) !== "";
  const used = new Set<string>();

  // The caption plus the same person's notes within 3 minutes, in the order they were sent.
  const reasonOf = (img: GroupMessage): { text: string | null; firstNote: string | null } => {
    const parts: string[] = [];
    const caption = cleanNote(img.body);
    if (caption && !isTally(caption)) parts.push(caption);
    let firstNote: string | null = null;
    for (const x of list) {
      if (x.id === img.id || !note(x) || used.has(x.id) || who(x) !== who(img) || gap(x, img) > NEAR_MINUTES * 60_000) continue;
      // A note between this screenshot and the person's next screenshot belongs to the nearer one.
      const otherImage = list.find((y) => y.kind !== "text" && y.id !== img.id && who(y) === who(img) && gap(y, x) < gap(img, x));
      if (otherImage) continue;
      used.add(x.id);
      firstNote ??= x.id;
      parts.push(cleanNote(x.body));
    }
    if (!parts.length) {
      const near = list
        .filter((x) => note(x) && !used.has(x.id) && who(x) === who(img) && gap(x, img) <= PAIR_MINUTES * 60_000)
        .sort((a, b) => gap(a, img) - gap(b, img) || Date.parse(b.sentAt) - Date.parse(a.sentAt))[0];
      if (near) {
        used.add(near.id);
        firstNote = near.id;
        parts.push(cleanNote(near.body));
      }
    }
    return { text: parts.length ? [...new Set(parts)].join(" · ") : null, firstNote };
  };

  const qrReasons = new Map<string, { text: string; at: number; taken: boolean }>();
  const out: DerivedExpense[] = [];
  for (const m of list) {
    if (m.kind === "text") continue;
    const r = reasonOf(m);
    if (m.isQr) {
      if (r.text) qrReasons.set(m.id, { text: r.text, at: Date.parse(m.sentAt), taken: false });
      continue;
    }
    let reason = r.text;
    if (!reason) {
      // Paid from a QR someone posted: the newest one not taken yet, within 3 hours before.
      const t = Date.parse(m.sentAt);
      const qr = [...qrReasons.values()].filter((q) => !q.taken && q.at <= t && t - q.at <= QR_HOURS * 3_600_000).sort((a, b) => b.at - a.at)[0];
      if (qr) {
        qr.taken = true;
        reason = qr.text;
      }
    }
    out.push({ key: m.id, imageMessageId: m.id, textMessageId: r.firstNote, spentAt: m.sentAt, sender: m.sender, reason, textAmount: noteAmount(reason), category: categoryFor(reason) });
  }
  return out;
}

/** "2026-10": the month of a moment, in India. */
export function monthOf(iso: string): string {
  return new Date(Date.parse(iso) + 5.5 * 3_600_000).toISOString().slice(0, 7);
}

export type ExpenseLike = { amount: number | null; category: string; status: "new" | "checked" | "ignored" };

/** A month added up (only what counts): the total, how many, how many still to check, and each type's share, biggest first. */
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

/** Whether an expense counts in the totals: a payment screenshot (or one the owner said counts), not set aside. */
export function counts(e: { status: string; verdict: string }): boolean {
  return e.status !== "ignored" && e.verdict === "payment";
}

/** The amount to use: typed by the owner, else read from the screenshot, else from the note. */
export function pickAmount(e: { typed?: number | null; read: number | null; text: number | null }): { amount: number | null; from: "typed" | "screenshot" | "note" | null } {
  if (e.typed != null) return { amount: e.typed, from: "typed" };
  if (e.read != null) return { amount: e.read, from: "screenshot" };
  if (e.text != null) return { amount: e.text, from: "note" };
  return { amount: null, from: null };
}
