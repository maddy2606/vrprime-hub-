// Edge Function `notify`: sends push notifications and builds the daily digests.
//
// Called only by the database (pg_net), never by a browser:
//   { "job": "push",  "notification_id": "<uuid>" }  send one notification to the person's devices
//   { "job": "daily" }                               overdue + ticket follow-up digests (9:30 AM IST)
//   { "job": "daily", "dry_run": true }              say what the daily job would do, change nothing
//
// Every request must carry the header `x-internal-secret`. The secret lives in the
// database (private.internal_config); this function asks the database whether it matches,
// so there is nothing to copy into Supabase secrets. verify_jwt is off for that reason.
//
// Secrets to set for push (Edge Functions > Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
// and optionally VAPID_SUBJECT (a mailto: address or https URL).

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const SITE_URL = "https://vrprime-ops.vercel.app";
const APP_URL = (Deno.env.get("APP_URL")?.trim() || SITE_URL).replace(/\/+$/, "");
const OPEN_STATUSES = ["open", "in_progress", "waiting"];
const OPEN_TICKET_STATUSES = ["open", "waiting_marketplace"];

// ---------------------------------------------------------------------------
// Keep keys and tokens out of logs and responses (same rules as the app's redactSecrets).
// ---------------------------------------------------------------------------

function redact(input: unknown): string {
  let text = String(input ?? "");
  const vapid = Deno.env.get("VAPID_PRIVATE_KEY")?.trim();
  if (vapid && vapid.length >= 8) text = text.split(vapid).join("[redacted]");
  for (const name of ["RESEND_API_KEY", "GMAIL_APP_PASSWORD"]) {
    const secret = (Deno.env.get(name) ?? "").replace(/\s+/g, "");
    if (secret.length >= 8) text = text.split(secret).join("[redacted]");
  }
  return text
    .replace(/(["'`])[^"'`\n]*(?:sb_secret_|sb_publishable_|eyJ[\w-]{5,}|Bearer\s)[^"'`\n]*\1/gi, "[redacted]")
    .replace(/Bearer\s+[^\s"'`,;)]+/gi, "[redacted]")
    .replace(/sb_(?:secret|publishable)_[^\s"'`,;)]*/gi, "[redacted]")
    .replace(/eyJ[\w-]{5,}(?:\.[\w-]+){0,2}/g, "[redacted]");
}

function errorText(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) return redact((error as { message: unknown }).message);
  return redact(error);
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function secretKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    if (typeof keys.default === "string" && keys.default) return keys.default;
  } catch {
    // Fall back to the legacy key below.
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

function adminClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL") ?? "", secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** True when VAPID keys are set and accepted. Checked on every call so new secrets work at once. */
function configurePush(): boolean {
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY")?.trim();
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY")?.trim();
  if (!publicKey || !privateKey) return false;
  try {
    webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT")?.trim() || SITE_URL, publicKey, privateKey);
    return true;
  } catch (error) {
    console.error("VAPID keys were rejected:", errorText(error));
    return false;
  }
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

type Payload = { title: string; body: string; url: string; tag: string };
type PushResult = { sent: number; removed: number; failed: number; devices: number };

type NotificationRow = {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string | null;
  post_id: string | null;
  ticket_id: string | null;
};

function urlFor(n: NotificationRow): string {
  if (n.post_id) return `/posts/${n.post_id}`;
  if (n.ticket_id) return `/tickets/${n.ticket_id}`;
  if (n.kind === "follow_up") return "/tickets?tab=due";
  if (n.kind === "overdue") return "/";
  if (n.kind === "dispatch_risk") return "/flipkart?tab=orders";
  if (n.kind === "stock_alert") return "/flipkart?tab=forecast";
  if (n.kind === "capacity_alert") return "/team";
  if (n.kind === "money_reminder") return "/money?tab=uploads";
  return "/notifications";
}

function payloadFor(n: NotificationRow): Payload {
  return { title: n.title, body: n.body ?? "", url: urlFor(n), tag: `${n.kind}:${n.post_id ?? n.ticket_id ?? n.id}` };
}

async function pushToUser(db: SupabaseClient, userId: string, payload: Payload): Promise<PushResult> {
  const result: PushResult = { sent: 0, removed: 0, failed: 0, devices: 0 };
  const { data: subs, error } = await db
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);
  if (error) {
    console.error("Could not read push subscriptions:", errorText(error));
    return result;
  }
  result.devices = subs.length;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
          { TTL: 60 * 60 * 24, urgency: "normal" },
        );
        result.sent += 1;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // The device unsubscribed or the app was removed: forget it.
          await db.from("push_subscriptions").delete().eq("id", sub.id);
          result.removed += 1;
        } else {
          result.failed += 1;
          console.error("Push failed", status ?? "no status", errorText(error));
        }
      }
    }),
  );
  return result;
}

async function pushJob(db: SupabaseClient, notificationId: string): Promise<Record<string, unknown>> {
  const { data: n, error } = await db
    .from("notifications")
    .select("id, user_id, kind, title, body, post_id, ticket_id")
    .eq("id", notificationId)
    .maybeSingle();
  if (error) throw error;
  if (!n) return { ok: false, error: "notification not found" };
  // Email goes out whether or not push is set up; each is skipped quietly when its keys are missing.
  const email = await emailUser(db, n);
  if (!configurePush()) return { ok: true, pushed: false, email, reason: "push is not configured (VAPID keys missing)" };
  return { ok: true, pushed: true, email, ...(await pushToUser(db, n.user_id, payloadFor(n))) };
}

// ---------------------------------------------------------------------------
// Email (Resend). Only the alerts that need a quick look are emailed, not every comment or assignment.
// Secrets: RESEND_API_KEY. Optional: EMAIL_FROM (default Resend's test sender), APP_URL (the site's address).
// ---------------------------------------------------------------------------

const EMAIL_KINDS = new Set(["dispatch_risk", "stock_alert", "capacity_alert", "sync_alert", "money_reminder"]);

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Your own Gmail (GMAIL_USER + GMAIL_APP_PASSWORD) when set: mail from yourself does not go to Spam. Otherwise Resend. */
async function emailViaGmail(to: string, n: NotificationRow, link: string): Promise<string> {
  const user = Deno.env.get("GMAIL_USER")?.trim() ?? "";
  const pass = (Deno.env.get("GMAIL_APP_PASSWORD") ?? "").replace(/\s+/g, "");
  const client = new SMTPClient({
    connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: user, password: pass } },
  });
  try {
    await client.send({
      from: `VR Prime Alerts <${user}>`,
      to,
      subject: n.title,
      content: `${n.title}\n\n${n.body ?? ""}\n\n${link}`,
      html: `<div style="font-family:system-ui,sans-serif;font-size:15px"><p><b>${escapeHtml(n.title)}</b></p><p>${escapeHtml(n.body ?? "")}</p><p><a href="${link}">Open in VR Prime</a></p></div>`,
    });
    return "sent (gmail)";
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function emailUser(db: SupabaseClient, n: NotificationRow): Promise<string> {
  const key = Deno.env.get("RESEND_API_KEY")?.trim();
  const gmail = Boolean(Deno.env.get("GMAIL_USER")?.trim() && Deno.env.get("GMAIL_APP_PASSWORD")?.trim());
  if (!key && !gmail) return "not configured";
  if (!EMAIL_KINDS.has(n.kind)) return "not an email alert";
  try {
    const { data, error } = await db.auth.admin.getUserById(n.user_id);
    const to = data?.user?.email;
    if (error || !to) return "no email address";
    const link = `${APP_URL}${urlFor(n)}`;
    if (gmail) return await emailViaGmail(to, n, link);
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: Deno.env.get("EMAIL_FROM")?.trim() || "VR Prime Alerts <onboarding@resend.dev>",
        to: [to],
        subject: n.title,
        html: `<div style="font-family:system-ui,sans-serif;font-size:15px"><p><b>${escapeHtml(n.title)}</b></p><p>${escapeHtml(n.body ?? "")}</p><p><a href="${link}">Open in VR Prime</a></p></div>`,
        text: `${n.title}\n\n${n.body ?? ""}\n\n${link}`,
      }),
    });
    if (!res.ok) {
      console.error("Email failed", res.status, redact(await res.text().catch(() => "")));
      return `failed (HTTP ${res.status})`;
    }
    return "sent";
  } catch (error) {
    console.error("Email failed:", errorText(error));
    return "failed";
  }
}

// ---------------------------------------------------------------------------
// Daily digests
// ---------------------------------------------------------------------------

const istDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" });

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function listText(items: string[], max = 3): string {
  const shown = items.slice(0, max).join(" · ");
  return items.length > max ? `${shown} · +${items.length - max} more` : shown;
}

function groupBy<T>(rows: T[], key: (row: T) => string | null): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    if (!k) continue;
    out.set(k, [...(out.get(k) ?? []), row]);
  }
  return out;
}

type Digest = {
  user_id: string;
  kind: "overdue" | "follow_up";
  title: string;
  body: string;
  post_id: string | null;
  ticket_id: string | null;
};

async function dailyJob(db: SupabaseClient, dryRun: boolean): Promise<Record<string, unknown>> {
  const today = istDay.format(new Date());
  const dayStart = `${today}T00:00:00+05:30`;

  const [{ data: active, error: activeError }, { data: already, error: alreadyError }] = await Promise.all([
    db.from("profiles").select("id").eq("active", true),
    db.from("notifications").select("user_id, kind").in("kind", ["overdue", "follow_up"]).gte("created_at", dayStart),
  ]);
  if (activeError) throw activeError;
  if (alreadyError) throw alreadyError;
  const activeIds = new Set(active.map((p) => p.id as string));
  const done = new Set(already.map((n) => `${n.kind}:${n.user_id}`));

  const digests: Digest[] = [];

  // Overdue: open work assigned to someone, due before today (IST).
  const { data: overdue, error: overdueError } = await db
    .from("posts")
    .select("id, number, title, assignee_id, due_date")
    .in("status", OPEN_STATUSES)
    .lt("due_date", today)
    .not("assignee_id", "is", null)
    .order("due_date")
    .limit(2000);
  if (overdueError) throw overdueError;
  for (const [userId, posts] of groupBy(overdue, (p) => p.assignee_id)) {
    const n = posts.length;
    digests.push({
      user_id: userId,
      kind: "overdue",
      title: n === 1 ? "1 overdue item" : `${n} overdue items`,
      body: listText(posts.map((p) => `VR-${p.number} ${truncate(p.title, 40)}`)),
      post_id: n === 1 ? posts[0].id : null,
      ticket_id: null,
    });
  }

  // Ticket follow-ups due today or earlier. Told: whoever raised the ticket and the assignee of its post.
  const { data: tickets, error: ticketError } = await db
    .from("tickets")
    .select("id, number, ticket_id, created_by, post_id")
    .in("status", OPEN_TICKET_STATUSES)
    .lte("next_follow_up", today)
    .order("next_follow_up")
    .limit(2000);
  if (ticketError) throw ticketError;
  const postIds = [...new Set(tickets.map((t) => t.post_id).filter((id): id is string => Boolean(id)))];
  const assigneeByPost = new Map<string, string | null>();
  if (postIds.length) {
    const { data: posts, error } = await db.from("posts").select("id, assignee_id").in("id", postIds);
    if (error) throw error;
    for (const p of posts) assigneeByPost.set(p.id, p.assignee_id);
  }
  const perUser = new Map<string, typeof tickets>();
  for (const t of tickets) {
    const people = new Set([t.created_by, t.post_id ? assigneeByPost.get(t.post_id) : null]);
    for (const userId of people) {
      if (userId) perUser.set(userId, [...(perUser.get(userId) ?? []), t]);
    }
  }
  for (const [userId, list] of perUser) {
    const n = list.length;
    digests.push({
      user_id: userId,
      kind: "follow_up",
      title: n === 1 ? "1 ticket follow-up due" : `${n} ticket follow-ups due`,
      body: listText(list.map((t) => `VR-T-${t.number} (${truncate(t.ticket_id, 24)})`)),
      post_id: null,
      ticket_id: n === 1 ? list[0].id : null,
    });
  }

  // Only active people, and only once a day each, even if the job is run twice.
  const todo = digests.filter((d) => activeIds.has(d.user_id) && !done.has(`${d.kind}:${d.user_id}`));
  const summary = {
    ok: true,
    today,
    dry_run: dryRun,
    overdue_people: digests.filter((d) => d.kind === "overdue").length,
    follow_up_people: digests.filter((d) => d.kind === "follow_up").length,
    to_notify: todo.length,
    already_sent_today: digests.length - todo.length,
    push_configured: configurePush(),
  };
  if (dryRun || todo.length === 0) return summary;

  const { data: created, error: insertError } = await db
    .from("notifications")
    .insert(todo)
    .select("id, user_id, kind, title, body, post_id, ticket_id");
  if (insertError) throw insertError;

  let sent = 0;
  let failed = 0;
  if (summary.push_configured) {
    for (const n of created) {
      const r = await pushToUser(db, n.user_id, payloadFor(n));
      sent += r.sent;
      failed += r.failed;
    }
  }
  return { ...summary, notifications_created: created.length, pushes_sent: sent, pushes_failed: failed };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  try {
    const db = adminClient();
    const { data: allowed, error: authError } = await db.rpc("check_internal_secret", {
      candidate: req.headers.get("x-internal-secret") ?? "",
    });
    if (authError) {
      console.error("Secret check failed:", errorText(authError));
      return json({ ok: false, error: "could not verify the request" }, 500);
    }
    if (allowed !== true) return json({ ok: false, error: "unauthorized" }, 401);

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (body?.job === "push" && typeof body.notification_id === "string") {
      return json(await pushJob(db, body.notification_id));
    }
    if (body?.job === "daily") {
      const result = await dailyJob(db, body.dry_run === true);
      console.log("daily job", JSON.stringify(result));
      return json(result);
    }
    return json({ ok: false, error: "unknown job" }, 400);
  } catch (error) {
    console.error("notify failed:", errorText(error));
    return json({ ok: false, error: errorText(error) }, 500);
  }
});
