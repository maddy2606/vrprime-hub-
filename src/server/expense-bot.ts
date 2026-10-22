import "server-only";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { warehouseFor } from "@/lib/budget";
import { actionId, amountReply, BOT_CATEGORIES, botKey, botPrefix, headline, HELP, parseAction, parseSenders, signatureOk, spentAt, summary } from "@/lib/expense-bot";
import { categoryFor, cleanNote, noteAmount, type ExpenseCategory } from "@/lib/expenses";
import { logError } from "@/lib/redact";
import { readReceiptImage } from "@/server/receipt-ai";
import { serverDb } from "@/server/service-db";

// The expenses bot on its own WhatsApp Business number (Meta's official Cloud API). Meta calls /api/whatsapp/bot with
// each message; this reads payment screenshots, asks which warehouse and which type with tap buttons, and saves the
// expense as checked. Only numbers in WHATSAPP_BOT_SENDERS are answered. Replies within 24 hours of a team member's
// message are free on WhatsApp's pricing, and the bot only ever replies.

type Db = SupabaseClient;
type Warehouse = { id: string; name: string };
type Expense = {
  id: string;
  key: string;
  amount: number | null;
  paid_to: string | null;
  reason: string | null;
  category: string;
  warehouse_id: string | null;
  verdict: string;
  status: string;
};
const COLUMNS = "id, key, amount, paid_to, reason, category, warehouse_id, verdict, status";

type Config = { token: string; phoneId: string; senders: Map<string, string> };

function config(): Config | null {
  const token = process.env.WHATSAPP_BOT_TOKEN?.trim();
  const phoneId = process.env.WHATSAPP_BOT_PHONE_ID?.trim();
  if (!token || !phoneId) return null;
  return { token, phoneId, senders: parseSenders(process.env.WHATSAPP_BOT_SENDERS) };
}

/** Whether a webhook call really comes from Meta (signed with the app secret). */
export const signedByMeta = (raw: string, header: string | null) => signatureOk(raw, header, process.env.WHATSAPP_BOT_APP_SECRET?.trim());

// ---- Talking to WhatsApp ---------------------------------------------------------------------------------------------

const graph = () => `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION?.trim() || "v23.0"}`;

async function send(cfg: Config, to: string, message: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${graph()}/${cfg.phoneId}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, ...message }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) logError("expense bot send", new Error(`WhatsApp answered ${res.status}: ${(await res.text()).slice(0, 300)}`));
}

const say = (cfg: Config, to: string, body: string) => send(cfg, to, { type: "text", text: { body, preview_url: false } });

/** Up to 3 buttons (titles up to 20 characters). */
const buttons = (cfg: Config, to: string, body: string, list: { id: string; title: string }[]) =>
  send(cfg, to, { type: "interactive", interactive: { type: "button", body: { text: body }, action: { buttons: list.map((b) => ({ type: "reply", reply: { id: b.id, title: b.title.slice(0, 20) } })) } } });

/** A list to pick from: up to 10 rows (titles up to 24 characters), opened with `label`. */
const choose = (cfg: Config, to: string, body: string, label: string, rows: { id: string; title: string }[]) =>
  send(cfg, to, {
    type: "interactive",
    interactive: { type: "list", body: { text: body }, action: { button: label.slice(0, 20), sections: [{ title: label.slice(0, 24), rows: rows.slice(0, 10).map((r) => ({ id: r.id, title: r.title.slice(0, 24) })) }] } },
  });

/** A screenshot or PDF the team member sent: its address first, then the file (both need the token). */
async function download(cfg: Config, mediaId: string): Promise<{ file: Buffer; mime: string }> {
  const auth = { authorization: `Bearer ${cfg.token}` };
  const meta = await fetch(`${graph()}/${encodeURIComponent(mediaId)}`, { headers: auth, signal: AbortSignal.timeout(15_000) });
  if (!meta.ok) throw new Error(`WhatsApp media lookup answered ${meta.status}`);
  const { url, mime_type } = (await meta.json()) as { url?: string; mime_type?: string };
  if (!url) throw new Error("WhatsApp gave no media address");
  const res = await fetch(url, { headers: auth, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`WhatsApp media download answered ${res.status}`);
  return { file: Buffer.from(await res.arrayBuffer()), mime: mime_type ?? res.headers.get("content-type") ?? "" };
}

// ---- The steps ---------------------------------------------------------------------------------------------------------

const whName = (warehouses: Warehouse[], id: string | null) => (id ? (warehouses.find((w) => w.id === id)?.name ?? "General") : "General");

function askWarehouse(cfg: Config, to: string, e: Expense, warehouses: Warehouse[], askType: boolean) {
  const rows = [...warehouses.slice(0, 9).map((w) => ({ id: actionId({ kind: "warehouse", expenseId: e.id, warehouseId: w.id, askType }), title: w.name })), { id: actionId({ kind: "warehouse", expenseId: e.id, warehouseId: null, askType }), title: "General (no warehouse)" }];
  return choose(cfg, to, `${headline(e)}\nWhich warehouse was it for?`, "Pick warehouse", rows);
}

function askType(cfg: Config, to: string, e: Expense) {
  return choose(cfg, to, `${headline(e)}\nWhat was it for?`, "Pick type", BOT_CATEGORIES.map((c) => ({ id: actionId({ kind: "type", expenseId: e.id, category: c }), title: c })));
}

/** What to ask next for an expense, given whether its warehouse is already known (from the note, or the payee's last one). */
async function next(cfg: Config, to: string, e: Expense, warehouses: Warehouse[], warehouseKnown: boolean): Promise<void> {
  if (e.verdict !== "payment") {
    return buttons(cfg, to, "This does not look like a payment done screenshot (a QR code, a bill, or a payment that failed?), so it is not counted.", [
      { id: actionId({ kind: "payment", expenseId: e.id }), title: "It is a payment" },
      { id: actionId({ kind: "skip", expenseId: e.id }), title: "Right, skip it" },
    ]);
  }
  if (e.amount === null) return say(cfg, to, "I could not read the amount on this one. Reply with just the amount, like 1250.");
  if (!warehouseKnown) return askWarehouse(cfg, to, e, warehouses, e.category === "Other");
  if (e.category === "Other") return askType(cfg, to, e);
  return buttons(cfg, to, `${summary(e, whName(warehouses, e.warehouse_id))}\nSave it?`, [
    { id: actionId({ kind: "save", expenseId: e.id }), title: "Save" },
    { id: actionId({ kind: "change", expenseId: e.id }), title: "Change" },
  ]);
}

async function update(db: Db, id: string, fields: Record<string, unknown>): Promise<Expense> {
  const { data, error } = await db.from("expenses").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id).select(COLUMNS).single();
  if (error || !data) throw new Error(`Could not save the expense: ${error?.message ?? "not found"}`);
  return data as Expense;
}

async function save(cfg: Config, db: Db, to: string, e: Expense, warehouses: Warehouse[]) {
  const done = await update(db, e.id, { status: "checked" });
  await say(cfg, to, `Saved ✓\n${summary(done, whName(warehouses, done.warehouse_id))}`);
}

/** The warehouse and type this payee's last checked payment had, as a guess for this one. */
async function lastFor(db: Db, paidTo: string): Promise<{ warehouse_id: string | null; category: string } | null> {
  const { data } = await db
    .from("expenses")
    .select("warehouse_id, category")
    .ilike("paid_to", paidTo.replace(/[%_\\]/g, (c) => `\\${c}`))
    .eq("status", "checked")
    .eq("verdict", "payment")
    .order("spent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { warehouse_id: string | null; category: string } | null) ?? null;
}

// ---- One message --------------------------------------------------------------------------------------------------------

type Incoming = {
  from: string;
  id: string;
  timestamp?: string;
  type: string;
  image?: { id: string; mime_type?: string; caption?: string };
  document?: { id: string; mime_type?: string; caption?: string; filename?: string };
  text?: { body?: string };
  interactive?: { button_reply?: { id?: string }; list_reply?: { id?: string } };
};

async function screenshot(cfg: Config, db: Db, m: Incoming, sender: string, warehouses: Warehouse[]) {
  const key = botKey(m.from, m.id);
  const { data: seen } = await db.from("expenses").select("id").eq("key", key).maybeSingle();
  if (seen) return; // WhatsApp sent the same message again
  const media = (m.image ?? m.document)!;
  const { file, mime } = await download(cfg, media.id);
  const pdf = mime === "application/pdf";
  if (!pdf && !mime.startsWith("image/")) return say(cfg, m.from, "Send the payment as a screenshot or a PDF, please.");
  // A webp at most 1280 wide, for the model and for the Expenses page (a PDF as it is).
  const full = pdf ? file : await sharp(file).rotate().resize({ width: 1280, withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
  const read = await readReceiptImage(full, pdf ? mime : "image/webp");
  const note = cleanNote(media.caption) || null;
  const sentAt = new Date(Number(m.timestamp ?? 0) * 1000 || Date.now()).toISOString();

  if (read?.reference) {
    const { data: same } = await db.from("expenses").select("amount, paid_to, spent_at").eq("reference", read.reference).neq("status", "ignored").limit(1).maybeSingle();
    if (same) {
      const day = new Date(same.spent_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
      return say(cfg, m.from, `Already saved: ${headline(same)} on ${day} (same UPI reference). Not added again.`);
    }
  }

  const name = m.id.replace(/[^A-Za-z0-9_.-]/g, "_");
  const path = `bot/${name}.${pdf ? "pdf" : "webp"}`;
  const up = await db.storage.from("expenses").upload(path, full, { contentType: pdf ? "application/pdf" : "image/webp", upsert: true });
  if (up.error) throw up.error;
  let thumb: string | null = null;
  if (!pdf) {
    thumb = `bot/${name}-t.webp`;
    const small = await sharp(file).rotate().resize({ width: 360, withoutEnlargement: true }).webp({ quality: 62 }).toBuffer();
    const t = await db.storage.from("expenses").upload(thumb, small, { contentType: "image/webp", upsert: true });
    if (t.error) thumb = null;
  }

  // The warehouse and type: from the note first, else what this payee's last payment was.
  const memory = read?.paidTo ? await lastFor(db, read.paidTo) : null;
  const named = warehouseFor(note, warehouses);
  let category: ExpenseCategory | string = categoryFor(note);
  if (category === "Other") category = memory?.category ?? categoryFor(read?.paidTo);
  const textAmount = noteAmount(note);
  const amount = read?.amount ?? textAmount;
  const { data, error } = await db
    .from("expenses")
    .insert({
      key,
      image_message_id: m.id,
      spent_at: read ? spentAt(read, sentAt) : sentAt,
      sender,
      reason: note,
      category,
      warehouse_id: named ?? memory?.warehouse_id ?? null,
      text_amount: textAmount,
      read_amount: read?.amount ?? null,
      amount,
      amount_from: read?.amount != null ? "screenshot" : textAmount != null ? "note" : null,
      paid_to: read?.paidTo ?? null,
      reference: read?.reference ?? null,
      image_path: path,
      thumb_path: thumb,
      read_text: read ? JSON.stringify(read) : null,
      read_done: true,
      status: "new",
      // Without the model the sender's word is taken: they sent it to the expenses bot as a payment.
      verdict: read === null || read.payment ? "payment" : "not_payment",
      // Never touched by the group fetch.
      edited: true,
    })
    .select(COLUMNS)
    .single();
  if (error || !data) throw new Error(`Could not save the expense: ${error?.message}`);
  await next(cfg, m.from, data as Expense, warehouses, named !== null || memory !== null);
}

async function tapped(cfg: Config, db: Db, m: Incoming, warehouses: Warehouse[]) {
  const a = parseAction(m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id);
  if (!a) return;
  const { data } = await db.from("expenses").select(COLUMNS).eq("id", a.expenseId).maybeSingle();
  const e = data as Expense | null;
  // Only the person who sent the screenshot can answer for it.
  if (!e || !e.key.startsWith(botPrefix(m.from))) return;
  if (a.kind === "warehouse") {
    const moved = await update(db, e.id, { warehouse_id: a.warehouseId && warehouses.some((w) => w.id === a.warehouseId) ? a.warehouseId : null });
    return a.askType ? askType(cfg, m.from, moved) : save(cfg, db, m.from, moved, warehouses);
  }
  if (a.kind === "type") return save(cfg, db, m.from, await update(db, e.id, { category: a.category }), warehouses);
  if (a.kind === "save") return save(cfg, db, m.from, e, warehouses);
  if (a.kind === "change") return askWarehouse(cfg, m.from, e, warehouses, true);
  if (a.kind === "payment") return next(cfg, m.from, await update(db, e.id, { verdict: "payment", status: "new" }), warehouses, false);
  await update(db, e.id, { status: "ignored" });
  return say(cfg, m.from, "Set aside: it is not counted.");
}

async function texted(cfg: Config, db: Db, m: Incoming, warehouses: Warehouse[]) {
  const body = m.text?.body ?? "";
  // The sender's latest screenshot from the last 30 minutes is the one a reply is about.
  const { data } = await db
    .from("expenses")
    .select(COLUMNS)
    .like("key", `${botPrefix(m.from).replace(/[%_\\]/g, (c) => `\\${c}`)}%`)
    .gte("created_at", new Date(Date.now() - 30 * 60_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const e = data as Expense | null;
  if (!e || e.status === "ignored") return say(cfg, m.from, HELP);
  const n = amountReply(body);
  if (n !== null && e.amount === null) {
    const priced = await update(db, e.id, { amount: n, text_amount: n, amount_from: "typed" });
    return next(cfg, m.from, priced, warehouses, priced.warehouse_id !== null);
  }
  const note = cleanNote(body);
  if (!note) return;
  const fields: Record<string, unknown> = { reason: [e.reason, note].filter(Boolean).join(" · ").slice(0, 2000) };
  const named = e.warehouse_id === null ? warehouseFor(note, warehouses) : null;
  if (named) fields.warehouse_id = named;
  if (e.category === "Other" && categoryFor(note) !== "Other") fields.category = categoryFor(note);
  const noted = await update(db, e.id, fields);
  if (e.status === "checked") return say(cfg, m.from, `Note added.\n${summary(noted, whName(warehouses, noted.warehouse_id))}`);
  if (e.amount !== null && e.verdict === "payment") return next(cfg, m.from, noted, warehouses, noted.warehouse_id !== null);
}

/** Everything in one webhook call from Meta. Delivery and read receipts are skipped. */
export async function handleWebhook(payload: unknown): Promise<void> {
  const cfg = config();
  const db = serverDb();
  if (!cfg || !db) return;
  const p = payload as { entry?: { changes?: { value?: { messages?: Incoming[] } }[] }[] };
  const messages = (p.entry ?? []).flatMap((e) => (e.changes ?? []).flatMap((c) => c.value?.messages ?? []));
  if (!messages.length) return;
  const { data: whs } = await db.from("warehouses").select("id, name").order("sort_order");
  const warehouses = (whs ?? []) as Warehouse[];
  for (const m of messages) {
    const sender = cfg.senders.get(m.from);
    if (!sender) continue; // not on the team list: never answered
    try {
      if (m.type === "image" || m.type === "document") await screenshot(cfg, db, m, sender, warehouses);
      else if (m.type === "interactive") await tapped(cfg, db, m, warehouses);
      else if (m.type === "text") await texted(cfg, db, m, warehouses);
      else await say(cfg, m.from, HELP);
    } catch (e) {
      logError("expense bot", e);
      await say(cfg, m.from, "Something went wrong saving that. Send it again in a minute.").catch(() => undefined);
    }
  }
}
