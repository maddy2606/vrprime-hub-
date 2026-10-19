import "server-only";
import {
  BufferJSON,
  DisconnectReason,
  downloadContentFromMessage,
  extractMessageContent,
  fetchLatestBaileysVersion,
  initAuthCreds,
  makeWASocket,
  proto,
  type AuthenticationCreds,
  type SignalDataSet,
  type SignalDataTypeMap,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import pino from "pino";
import jsQR from "jsqr";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildExpenses, categoryFor, pickAmount, readReceipt, type GroupMessage } from "@/lib/expenses";
import { logError, redactSecrets } from "@/lib/redact";
import { serverDb } from "@/server/service-db";

// The "Fetch from WhatsApp" button. The owner links their WhatsApp once (a QR code, like WhatsApp Web); after that each
// fetch connects for a few seconds, reads what arrived in the expenses group since last time, saves the messages and the
// payment screenshots, turns them into expenses, and disconnects. It only reads: nothing is ever sent, nothing is marked
// read, and it never shows as online.
//
// The linked session (keys and credentials) lives in public.whatsapp_link, which only the server key can read.

const GROUP_NAME = "Warehouse Expenses VRPRIME";
const BUCKET = "expenses";
const silent = pino({ level: "silent" });
// A version WhatsApp Web accepted recently, used when the live lookup fails.
const FALLBACK_VERSION: [number, number, number] = [2, 3000, 1043857760];

type Db = SupabaseClient;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const toJson = (v: unknown) => JSON.parse(JSON.stringify(v, BufferJSON.replacer)) as unknown;
const fromJson = <T>(v: unknown): T => JSON.parse(JSON.stringify(v), BufferJSON.reviver) as T;

// ---- The linked session, kept in the database --------------------------------------------------------------------------

type KeyStore = { creds: AuthenticationCreds; state: { creds: AuthenticationCreds; keys: { get: <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => Promise<{ [id: string]: SignalDataTypeMap[T] }>; set: (data: SignalDataSet) => Promise<void> } }; save: () => void; flush: () => Promise<void> };

async function loadSession(db: Db, fresh: boolean): Promise<KeyStore> {
  const cache = new Map<string, unknown>();
  if (!fresh) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from("whatsapp_link").select("key, value").range(from, from + 999);
      if (error) throw new Error(`Could not read the linked WhatsApp: ${error.message}`);
      for (const r of data ?? []) cache.set(r.key as string, fromJson(r.value));
      if (!data || data.length < 1000) break;
    }
  }
  const creds = (cache.get("creds") as AuthenticationCreds | undefined) ?? initAuthCreds();
  const dirty = new Map<string, unknown | null>();
  let chain = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const write = async () => {
    if (dirty.size === 0) return;
    const batch = [...dirty.entries()];
    dirty.clear();
    const upserts = batch.filter(([, v]) => v !== null).map(([key, value]) => ({ key, value: toJson(value), updated_at: new Date().toISOString() }));
    const deletes = batch.filter(([, v]) => v === null).map(([key]) => key);
    for (let i = 0; i < upserts.length; i += 200) {
      const { error } = await db.from("whatsapp_link").upsert(upserts.slice(i, i + 200));
      if (error) logError("whatsapp session save", error);
    }
    for (let i = 0; i < deletes.length; i += 200) {
      const { error } = await db.from("whatsapp_link").delete().in("key", deletes.slice(i, i + 200));
      if (error) logError("whatsapp session delete", error);
    }
  };
  // Saved within a second of any change, so a cut-off request still keeps the session in step with WhatsApp.
  const soon = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      chain = chain.then(write);
    }, 800);
  };

  return {
    creds,
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const out: Record<string, unknown> = {};
          for (const id of ids) {
            let v = cache.get(`${type}-${id}`);
            if (type === "app-state-sync-key" && v) v = proto.Message.AppStateSyncKeyData.fromObject(v as object);
            out[id] = v;
          }
          return out as never;
        },
        set: async (data) => {
          for (const type of Object.keys(data) as (keyof SignalDataSet)[]) {
            for (const [id, value] of Object.entries(data[type] ?? {})) {
              const k = `${type}-${id}`;
              if (value) cache.set(k, value);
              else cache.delete(k);
              dirty.set(k, value ?? null);
            }
          }
          soon();
        },
      },
    },
    save: () => {
      dirty.set("creds", creds);
      soon();
    },
    flush: async () => {
      if (timer) clearTimeout(timer);
      timer = null;
      chain = chain.then(write);
      await chain;
    },
  };
}

async function waVersion(): Promise<[number, number, number]> {
  try {
    const { version } = await Promise.race([fetchLatestBaileysVersion(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("slow")), 4000))]);
    return version as [number, number, number];
  } catch {
    return FALLBACK_VERSION;
  }
}

function open(session: KeyStore, version: [number, number, number]): WASocket {
  const sock = makeWASocket({
    version,
    auth: session.state,
    logger: silent,
    browser: ["VR Prime Ops", "Chrome", "120.0"],
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    shouldSyncHistoryMessage: () => true,
    getMessage: async () => undefined,
  });
  sock.ev.on("creds.update", () => session.save());
  return sock;
}

/** Waits for the socket to open, or says why it closed. */
function whenOpen(sock: WASocket, onQr?: (qr: string) => void): Promise<{ ok: true } | { ok: false; code: number | null; message: string }> {
  return new Promise((resolve) => {
    sock.ev.on("connection.update", (u) => {
      if (u.qr && onQr) onQr(u.qr);
      if (u.connection === "open") resolve({ ok: true });
      if (u.connection === "close") {
        const err = u.lastDisconnect?.error as { output?: { statusCode?: number }; message?: string } | undefined;
        resolve({ ok: false, code: err?.output?.statusCode ?? null, message: err?.message ?? "closed" });
      }
    });
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- Messages to rows ----------------------------------------------------------------------------------------------------

type MessageRow = { id: string; group_id: string; sent_at: string; sender: string | null; sender_id: string; kind: "text" | "image" | "document"; body: string | null; media: unknown };
type Change = { kind: "deleted"; id: string } | { kind: "edited"; id: string; body: string };

function readMessage(m: WAMessage, groupId: string, me: string | null): { row?: MessageRow; change?: Change } {
  if (m.key.remoteJid !== groupId || !m.key.id || !m.message) return {};
  const c = extractMessageContent(m.message);
  if (!c) return {};
  const p = c.protocolMessage;
  if (p?.key?.id) {
    if (p.type === proto.Message.ProtocolMessage.Type.REVOKE) return { change: { kind: "deleted", id: p.key.id } };
    const edited = p.editedMessage ? extractMessageContent(p.editedMessage) : null;
    const text = edited?.conversation ?? edited?.extendedTextMessage?.text ?? edited?.imageMessage?.caption ?? null;
    if (text) return { change: { kind: "edited", id: p.key.id, body: text } };
    return {};
  }
  const ts = Number(m.messageTimestamp ?? 0) * 1000 || Date.now();
  // In a group the sender is the participant; messages from history carry it on the message rather than its key.
  const participant = m.key.participant || m.participant || "";
  const senderId = m.key.fromMe ? "me" : participant || "member";
  const sender = m.key.fromMe ? (me ?? "You") : (m.pushName ?? null);
  const base = { id: m.key.id, group_id: groupId, sent_at: new Date(ts).toISOString(), sender, sender_id: senderId };
  if (c.imageMessage) {
    const i = c.imageMessage;
    return { row: { ...base, kind: "image", body: i.caption ?? null, media: toJson({ type: "image", mediaKey: i.mediaKey, directPath: i.directPath, url: i.url, mimetype: i.mimetype }) } };
  }
  if (c.documentMessage) {
    const d = c.documentMessage;
    const isImage = (d.mimetype ?? "").startsWith("image/");
    if (!isImage && d.mimetype !== "application/pdf") return {};
    return { row: { ...base, kind: "document", body: d.caption ?? d.title ?? null, media: toJson({ type: "document", mediaKey: d.mediaKey, directPath: d.directPath, url: d.url, mimetype: d.mimetype }) } };
  }
  const text = c.conversation ?? c.extendedTextMessage?.text ?? null;
  if (text) return { row: { ...base, kind: "text", body: text, media: null } };
  return {};
}

// ---- Saving --------------------------------------------------------------------------------------------------------------

async function saveMessages(db: Db, rows: MessageRow[], changes: Change[]): Promise<number> {
  let added = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const { data, error } = await db.from("expense_messages").upsert(rows.slice(i, i + 200), { onConflict: "id", ignoreDuplicates: true }).select("id");
    if (error) throw new Error(`Could not save the messages: ${error.message}`);
    added += data?.length ?? 0;
  }
  for (const ch of changes) {
    if (ch.kind === "deleted") await db.from("expense_messages").update({ deleted: true }).eq("id", ch.id);
    else await db.from("expense_messages").update({ body: ch.body }).eq("id", ch.id);
  }
  return added;
}

/** Whether an image is a QR code (a "scanner" posted to be paid): never an expense. */
async function isQrImage(file: Buffer): Promise<boolean> {
  try {
    const { data, info } = await sharp(file).resize({ width: 900, height: 900, fit: "inside", withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), info.width, info.height, { inversionAttempts: "attemptBoth" }) !== null;
  } catch {
    return false;
  }
}

/** Downloads the screenshots not saved yet (newest first), checks each for a QR code, and stores a small and a full-size copy. */
async function saveScreenshots(db: Db, until: number): Promise<{ saved: number; left: number; failed: number }> {
  const { data, error } = await db.from("expense_messages").select("id, kind, media").not("media", "is", null).is("image_path", null).eq("deleted", false).eq("media_expired", false).order("sent_at", { ascending: false }).limit(200);
  if (error) throw new Error(`Could not list the screenshots: ${error.message}`);
  let saved = 0;
  let failed = 0;
  for (const r of data ?? []) {
    if (Date.now() > until) break;
    try {
      const media = fromJson<{ type: "image" | "document"; mediaKey: Uint8Array; directPath: string; url: string; mimetype?: string }>(r.media);
      const stream = await downloadContentFromMessage({ mediaKey: media.mediaKey, directPath: media.directPath, url: media.url }, media.type);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      const file = Buffer.concat(chunks);
      let path: string;
      let thumb: string | null = null;
      let qr = false;
      if (media.mimetype === "application/pdf") {
        path = `wa/${r.id}.pdf`;
        const up = await db.storage.from(BUCKET).upload(path, file, { contentType: "application/pdf", upsert: true });
        if (up.error) throw up.error;
      } else {
        qr = await isQrImage(file);
        path = `wa/${r.id}.webp`;
        thumb = `wa/${r.id}-t.webp`;
        const full = await sharp(file).rotate().resize({ width: 1280, withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
        const small = await sharp(file).rotate().resize({ width: 360, withoutEnlargement: true }).webp({ quality: 62 }).toBuffer();
        const a = await db.storage.from(BUCKET).upload(path, full, { contentType: "image/webp", upsert: true });
        if (a.error) throw a.error;
        const b = await db.storage.from(BUCKET).upload(thumb, small, { contentType: "image/webp", upsert: true });
        if (b.error) throw b.error;
      }
      await db.from("expense_messages").update({ image_path: path, media: null, is_qr: qr }).eq("id", r.id);
      await db.from("expenses").update({ image_path: path, thumb_path: thumb }).eq("image_message_id", r.id);
      saved++;
    } catch (e) {
      failed++;
      // WhatsApp no longer has it on its servers (older than about a month): it cannot be downloaded any more.
      const msg = String((e as Error)?.message ?? e);
      if (/status code 4(03|04|10)|forbidden|expired/i.test(msg)) await db.from("expense_messages").update({ media: null, media_expired: true }).eq("id", r.id);
      else logError("whatsapp screenshot", e);
    }
  }
  const { count } = await db.from("expense_messages").select("id", { count: "exact", head: true }).not("media", "is", null).is("image_path", null).eq("deleted", false);
  return { saved, left: count ?? 0, failed };
}

/** Checks screenshots saved before QR checking existed (or left unchecked) for a QR code, from the saved copy. */
async function checkSavedForQr(db: Db, until: number): Promise<void> {
  const { data } = await db.from("expense_messages").select("id, image_path").not("image_path", "is", null).is("is_qr", null).like("image_path", "%.webp").limit(200);
  for (const r of data ?? []) {
    if (Date.now() > until) break;
    const { data: blob } = await db.storage.from(BUCKET).download(r.image_path);
    if (!blob) continue;
    const qr = await isQrImage(Buffer.from(await blob.arrayBuffer()));
    await db.from("expense_messages").update({ is_qr: qr }).eq("id", r.id);
  }
}

/** How far back the group's messages are sorted into expenses again on every fetch, so better rules reach old ones too. */
const RESORT_DAYS = 400;

/**
 * Sorts the group's messages into expenses: one per payment screenshot (never a QR code, never chat), with its reason.
 * New ones are added; ones the owner has not touched are brought up to date (a later note, an edit, better rules); one
 * that is no longer an expense (a QR code, chat, a deleted message) goes, unless the owner checked or corrected it.
 */
async function updateExpenses(db: Db, groupId: string): Promise<number> {
  const since = new Date(Date.now() - RESORT_DAYS * 86_400_000).toISOString();
  const msgs: Record<string, any>[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("expense_messages").select("id, sent_at, sender, sender_id, kind, body, deleted, image_path, is_qr, media_expired").eq("group_id", groupId).gte("sent_at", since).order("sent_at").range(from, from + 999);
    if (error) throw new Error(`Could not read the messages: ${error.message}`);
    msgs.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const list: GroupMessage[] = msgs.map((m) => ({ id: m.id, sentAt: m.sent_at, sender: m.sender, senderId: m.sender_id, kind: m.kind, body: m.body, deleted: m.deleted, isQr: m.is_qr }));
  const images = new Map(msgs.map((m) => [m.id as string, m.image_path as string | null]));
  const lost = new Set(msgs.filter((m) => m.media_expired && !m.image_path).map((m) => m.id as string));
  const derived = buildExpenses(list);
  const existing = new Map<string, { id: string; key: string; edited: boolean; read_amount: number | null; read_text: string | null; read_done: boolean; verdict: string; status: string }>();
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from("expenses").select("id, key, edited, read_amount, read_text, read_done, verdict, status").not("key", "is", null).gte("spent_at", since).range(from, from + 999);
    for (const e of data ?? []) existing.set(e.key, e);
    if (!data || data.length < 1000) break;
  }
  const now = new Date().toISOString();
  let added = 0;
  const inserts = [];
  for (const d of derived) {
    const e = existing.get(d.key);
    const image = images.get(d.imageMessageId) ?? null;
    const thumb = image && image.endsWith(".webp") ? image.replace(/\.webp$/, "-t.webp") : null;
    if (!e) {
      const { amount, from: source } = pickAmount({ read: null, text: d.textAmount });
      inserts.push({ key: d.key, image_message_id: d.imageMessageId, text_message_id: d.textMessageId, spent_at: d.spentAt, sender: d.sender, reason: d.reason, category: d.category, text_amount: d.textAmount, amount, amount_from: source, image_path: image, thumb_path: thumb, verdict: lost.has(d.imageMessageId) || (image && image.endsWith(".pdf")) ? "not_payment" : "pending" });
    } else if (!e.edited) {
      // A screenshot already read: decide from what was read, without reading it again.
      const r = e.read_done && e.read_text ? readReceipt(e.read_text) : null;
      const verdict = e.verdict !== "pending" ? e.verdict : r ? (r.payment ? "payment" : "not_payment") : lost.has(d.imageMessageId) ? "not_payment" : "pending";
      const { amount, from: source } = pickAmount({ read: r ? r.amount : e.read_amount, text: d.textAmount });
      const category = d.category === "Other" && r?.paidTo ? categoryFor(r.paidTo) : d.category;
      await db
        .from("expenses")
        .update({ text_message_id: d.textMessageId, reason: d.reason, category, text_amount: d.textAmount, read_amount: r ? r.amount : e.read_amount, paid_to: r?.paidTo ?? null, reference: r?.reference ?? null, amount, amount_from: source, verdict, image_path: image, thumb_path: thumb, updated_at: now })
        .eq("id", e.id);
    }
  }
  for (let i = 0; i < inserts.length; i += 200) {
    const { data, error: insErr } = await db.from("expenses").upsert(inserts.slice(i, i + 200), { onConflict: "key", ignoreDuplicates: true }).select("id");
    if (insErr) throw new Error(`Could not save the expenses: ${insErr.message}`);
    added += data?.length ?? 0;
  }
  const wanted = new Set(derived.map((d) => d.key));
  const gone = [...existing.values()].filter((e) => !wanted.has(e.key) && !e.edited && e.status !== "checked").map((e) => e.id);
  for (let i = 0; i < gone.length; i += 200) await db.from("expenses").delete().in("id", gone.slice(i, i + 200));
  return added;
}

// ---- The two actions -----------------------------------------------------------------------------------------------------

type State = { group_id: string | null; group_name: string | null; linked_as: string | null; busy_until: string | null };

async function readState(db: Db): Promise<State> {
  const { data } = await db.from("whatsapp_state").select("group_id, group_name, linked_as, busy_until").eq("id", true).maybeSingle();
  return (data as State | null) ?? { group_id: null, group_name: null, linked_as: null, busy_until: null };
}

/** One fetch or link at a time: two at once would put the linked session out of step with WhatsApp. */
async function claim(db: Db, seconds: number): Promise<boolean> {
  const now = new Date().toISOString();
  const { data } = await db
    .from("whatsapp_state")
    .update({ busy_until: new Date(Date.now() + seconds * 1000).toISOString() })
    .eq("id", true)
    .or(`busy_until.is.null,busy_until.lt."${now}"`)
    .select("id");
  return Boolean(data?.length);
}

async function release(db: Db, fields: Record<string, unknown>) {
  await db.from("whatsapp_state").update({ ...fields, busy_until: null, updated_at: new Date().toISOString() }).eq("id", true);
}

function pickGroup(groups: { id: string; subject: string }[]): { id: string; subject: string } | null {
  const want = norm(GROUP_NAME);
  return groups.find((g) => norm(g.subject) === want) ?? groups.find((g) => norm(g.subject).includes("warehouseexpense")) ?? null;
}

export type LinkEvent =
  | { type: "qr"; svg: string }
  | { type: "status"; text: string }
  | { type: "linked"; name: string }
  | { type: "done"; text: string }
  | { type: "error"; text: string };

/**
 * Links WhatsApp: shows QR codes until one is scanned (or about a minute passes), then finds the expenses group, keeps
 * the messages WhatsApp sends over for it (its recent history) and saves them.
 */
export async function linkWhatsApp(emit: (e: LinkEvent) => void, deadline: number): Promise<void> {
  const db = serverDb();
  if (!db) return emit({ type: "error", text: "The server is missing its Supabase secret key." });
  if (!(await claim(db, 150))) return emit({ type: "error", text: "A WhatsApp fetch is already running. Try again in a minute." });
  const QRCode = (await import("qrcode")).default;
  let session: KeyStore | null = null;
  let sock: WASocket | null = null;
  const held: WAMessage[] = [];
  try {
    await db.from("whatsapp_link").delete().neq("key", "");
    session = await loadSession(db, true);
    const version = await waVersion();
    let opened = false;
    // After the scan WhatsApp asks for a restart once; the second connection is the linked one.
    for (let attempt = 0; attempt < 3 && !opened && Date.now() < deadline; attempt++) {
      sock = open(session, version);
      sock.ev.on("messaging-history.set", ({ messages }) => held.push(...messages));
      sock.ev.on("messages.upsert", ({ messages }) => held.push(...messages));
      const result = await Promise.race([
        whenOpen(sock, (qr) => void QRCode.toString(qr, { type: "svg", margin: 1, width: 260 }).then((svg) => emit({ type: "qr", svg }))),
        wait(Math.max(0, deadline - Date.now() - 50_000)).then(() => ({ ok: false as const, code: -1, message: "timeout" })),
      ]);
      if (result.ok) opened = true;
      else if (result.code === DisconnectReason.restartRequired) emit({ type: "status", text: "Scanned. Finishing the link…" });
      else {
        sock.end(undefined);
        return emit({ type: "error", text: result.code === -1 ? "The QR code was not scanned in time. Press Link WhatsApp to try again." : "WhatsApp closed the link. Press Link WhatsApp to try again." });
      }
    }
    if (!opened || !sock) return emit({ type: "error", text: "The link did not finish. Press Link WhatsApp to try again." });
    const name = sock.user?.name || (sock.user?.id ?? "").split(":")[0].split("@")[0] || "your WhatsApp";
    emit({ type: "linked", name });

    const all = Object.values(await sock.groupFetchAllParticipating()).map((g) => ({ id: g.id, subject: g.subject ?? "" }));
    const group = pickGroup(all);
    await db.from("whatsapp_state").update({ linked_as: name, group_id: group?.id ?? null, group_name: group?.subject ?? null, groups: all.map((g) => ({ id: g.id, name: g.subject })).slice(0, 200) }).eq("id", true);
    if (!group) {
      emit({ type: "done", text: `Linked as ${name}, but no group called "${GROUP_NAME}" was found. Pick the expenses group on the page.` });
      return;
    }
    emit({ type: "status", text: `Found "${group.subject}". Reading its recent messages…` });
    // WhatsApp sends the recent history in parts; keep listening while it arrives.
    let last = held.length;
    let quiet = 0;
    while (Date.now() < deadline - 25_000 && quiet < 6) {
      await wait(1000);
      quiet = held.length === last ? quiet + 1 : 0;
      last = held.length;
    }
    sock.end(undefined);
    await session.flush();
    const result = await store(db, group.id, held, sock.user?.name ?? null, deadline);
    await release(db, { last_fetch_at: new Date().toISOString(), last_result: result, last_error: null });
    emit({ type: "done", text: `Linked as ${name}. ${result}` });
  } catch (e) {
    logError("whatsapp link", e);
    emit({ type: "error", text: redactSecrets(`The link failed: ${(e as Error)?.message ?? e}`) });
    await release(db, { last_error: "The link failed." });
  } finally {
    try {
      sock?.end(undefined);
    } catch {
      // already closed
    }
    await session?.flush().catch(() => undefined);
    await db.from("whatsapp_state").update({ busy_until: null }).eq("id", true);
  }
}

async function store(db: Db, groupId: string, held: WAMessage[], me: string | null, deadline: number): Promise<string> {
  const rows = new Map<string, MessageRow>();
  const changes: Change[] = [];
  for (const m of held) {
    const { row, change } = readMessage(m, groupId, me);
    if (row) rows.set(row.id, row);
    if (change) changes.push(change);
  }
  const added = await saveMessages(db, [...rows.values()], changes);
  // Screenshots first (each is checked for a QR code as it is saved), then everything is sorted into expenses again.
  const shots = await saveScreenshots(db, deadline - 9000);
  await checkSavedForQr(db, deadline - 7000);
  const expenses = await updateExpenses(db, groupId);
  const parts = [`${added} new ${added === 1 ? "message" : "messages"}, ${expenses} new ${expenses === 1 ? "payment" : "payments"} to read`];
  if (shots.saved) parts.push(`${shots.saved} ${shots.saved === 1 ? "screenshot" : "screenshots"} saved`);
  if (shots.left) parts.push(`${shots.left} still to download (press Fetch again)`);
  return `${parts.join(", ")}.`;
}

/** The Fetch button: connects with the saved link, reads what arrived for the group since last time, and saves it. */
export async function fetchWhatsApp(deadline: number): Promise<{ ok: boolean; text: string }> {
  const db = serverDb();
  if (!db) return { ok: false, text: "The server is missing its Supabase secret key." };
  const st = await readState(db);
  if (!st.linked_as) return { ok: false, text: "Link WhatsApp first." };
  if (!st.group_id) return { ok: false, text: "Pick the expenses group first." };
  if (!(await claim(db, 120))) return { ok: false, text: "A WhatsApp fetch is already running. Try again in a minute." };
  let session: KeyStore | null = null;
  let sock: WASocket | null = null;
  try {
    session = await loadSession(db, false);
    if (!session.creds.me) {
      await release(db, { linked_as: null, last_error: "WhatsApp is not linked." });
      return { ok: false, text: "WhatsApp is not linked any more. Link it again." };
    }
    const held: WAMessage[] = [];
    let pendingDone = false;
    sock = open(session, await waVersion());
    sock.ev.on("messaging-history.set", ({ messages }) => held.push(...messages));
    sock.ev.on("messages.upsert", ({ messages }) => held.push(...messages));
    sock.ev.on("connection.update", (u) => {
      if (u.receivedPendingNotifications) pendingDone = true;
    });
    const opened = await Promise.race([whenOpen(sock), wait(25_000).then(() => ({ ok: false as const, code: -1, message: "timeout" }))]);
    if (!opened.ok) {
      if (opened.code === DisconnectReason.loggedOut) {
        await db.from("whatsapp_link").delete().neq("key", "");
        await release(db, { linked_as: null, last_error: "WhatsApp logged this link out." });
        return { ok: false, text: "WhatsApp logged the site out (the link was removed on the phone, or not used for too long). Link it again." };
      }
      await release(db, { last_error: "Could not connect to WhatsApp." });
      return { ok: false, text: "Could not connect to WhatsApp just now. Try again in a minute." };
    }
    // Messages that arrived while the site was away come first; then wait until they stop.
    let last = -1;
    let quiet = 0;
    const listenUntil = Math.min(deadline - 20_000, Date.now() + 45_000);
    while (Date.now() < listenUntil && (quiet < 3 || !pendingDone) && quiet < 10) {
      await wait(1000);
      quiet = held.length === last ? quiet + 1 : 0;
      last = held.length;
    }
    sock.end(undefined);
    await session.flush();
    const text = await store(db, st.group_id, held, sock.user?.name ?? null, deadline);
    await release(db, { last_fetch_at: new Date().toISOString(), last_result: text, last_error: null });
    return { ok: true, text };
  } catch (e) {
    logError("whatsapp fetch", e);
    await release(db, { last_error: "The fetch failed." });
    return { ok: false, text: redactSecrets(`The fetch failed: ${(e as Error)?.message ?? e}`) };
  } finally {
    try {
      sock?.end(undefined);
    } catch {
      // already closed
    }
    await session?.flush().catch(() => undefined);
    await db.from("whatsapp_state").update({ busy_until: null }).eq("id", true);
  }
}

/** Removes the link: logs the site out of WhatsApp (it disappears from Linked devices) and forgets the session. */
export async function unlinkWhatsApp(): Promise<{ ok: boolean; text: string }> {
  const db = serverDb();
  if (!db) return { ok: false, text: "The server is missing its Supabase secret key." };
  try {
    const session = await loadSession(db, false);
    if (session.creds.me) {
      const sock = open(session, await waVersion());
      const opened = await Promise.race([whenOpen(sock), wait(15_000).then(() => ({ ok: false as const }))]);
      if (opened.ok) await sock.logout().catch(() => undefined);
      sock.end(undefined);
    }
  } catch (e) {
    logError("whatsapp unlink", e);
  }
  await db.from("whatsapp_link").delete().neq("key", "");
  await release(db, { linked_as: null, last_error: null });
  return { ok: true, text: "WhatsApp is unlinked. Expenses already saved stay here." };
}
