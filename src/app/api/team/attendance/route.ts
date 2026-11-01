import { timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { todayIST } from "@/lib/format";
import { serverDb } from "@/server/service-db";

/**
 * Attendance from the office WhatsApp bot (it runs on the owner's Mac, not signed in to this site).
 *
 * POST, header "Authorization: Bearer <TEAM_BOT_SECRET>", body {"name": "Jigar", "status": "absent"} and optionally
 * "date" (YYYY-MM-DD, today in India if left out) and "warehouse" (only needed when two people share a name).
 *
 * Safety rules:
 *  - Off until TEAM_BOT_SECRET is set in Vercel (at least 24 characters). A wrong or missing secret gets 401.
 *  - Only today or the last 7 days, and only active people on the Team page.
 *  - Never overwrites a mark someone already made on the Team page, unless the body says "overwrite": true.
 */
const STATUSES = ["present", "half", "absent", "leave"] as const;
type Status = (typeof STATUSES)[number];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const noStore = { "Cache-Control": "no-store" };
const reply = (ok: boolean, text: string, status = 200, extra: Record<string, unknown> = {}) =>
  Response.json({ ok, text, ...extra }, { status, headers: noStore });

function secretOk(header: string | null): boolean {
  const secret = process.env.TEAM_BOT_SECRET?.trim();
  if (!secret || secret.length < 24 || !header?.startsWith("Bearer ")) return false;
  const want = Buffer.from(secret, "utf8");
  const got = Buffer.from(header.slice(7).trim(), "utf8");
  return want.length === got.length && timingSafeEqual(want, got);
}

export async function POST(request: Request) {
  if (!process.env.TEAM_BOT_SECRET?.trim()) return reply(false, "The bot connection is off: TEAM_BOT_SECRET is not set.", 503);
  if (!secretOk(request.headers.get("authorization"))) return reply(false, "Not allowed.", 401);

  const body = (await request.json().catch(() => null)) as
    | { name?: unknown; status?: unknown; date?: unknown; warehouse?: unknown; overwrite?: unknown }
    | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const status = typeof body?.status === "string" ? (body.status.trim().toLowerCase() as Status) : null;
  if (!name || name.length > 100) return reply(false, "No name was sent.", 400);
  if (!status || !STATUSES.includes(status)) return reply(false, "Status must be present, half, absent or leave.", 400);

  const today = todayIST();
  const day = typeof body?.date === "string" && body.date ? body.date.trim() : today;
  const oldest = new Date(Date.parse(`${today}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
  if (!DAY.test(day) || day > today || day < oldest) return reply(false, "Only today or the last 7 days can be marked.", 400);

  const db = serverDb();
  if (!db) return reply(false, "The site is missing its database key.", 500);

  const people = await db.from("staff").select("id, name, warehouse_id, warehouses(name)").eq("active", true).ilike("name", name);
  if (people.error) return reply(false, "Could not read the team.", 500);
  let matches = (people.data ?? []) as { id: string; name: string; warehouse_id: string; warehouses: { name: string } | { name: string }[] | null }[];
  if (matches.length > 1 && typeof body?.warehouse === "string") {
    const w = body.warehouse.trim().toLowerCase();
    matches = matches.filter((m) => {
      const wh = Array.isArray(m.warehouses) ? m.warehouses[0] : m.warehouses;
      return wh?.name?.toLowerCase().includes(w);
    });
  }
  if (matches.length === 0) return reply(false, `Nobody called "${name}" is on the Team page.`, 404);
  if (matches.length > 1) return reply(false, `More than one "${name}" on the Team page. Send the warehouse too.`, 409);
  const person = matches[0];

  const existing = await db.from("attendance").select("status").eq("staff_id", person.id).eq("day", day).maybeSingle();
  if (existing.error) return reply(false, "Could not read the attendance.", 500);
  const before = (existing.data as { status: Status } | null)?.status ?? null;
  if (before && before !== status && body?.overwrite !== true) {
    return reply(true, `Kept "${before}": ${person.name} was already marked on the Team page.`, 200, { kept: before });
  }

  const saved = await db
    .from("attendance")
    .upsert({ staff_id: person.id, day, status, marked_by: null, updated_at: new Date().toISOString() }, { onConflict: "staff_id,day" });
  if (saved.error) return reply(false, "Could not save the attendance.", 500);
  revalidatePath("/team");
  return reply(true, `${person.name} marked ${status} for ${day}.`, 200, { name: person.name, day, status });
}
