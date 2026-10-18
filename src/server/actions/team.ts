"use server";

import { revalidatePath } from "next/cache";
import { getActiveUser } from "@/lib/auth";
import type { AttendanceStatus } from "@/lib/capacity";
import { todayIST } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult, SessionUser } from "@/lib/types";
import { dbError, NOT_SIGNED_IN } from "@/server/action-helpers";

// The Team page: staff, attendance and the planning numbers. The database checks every rule again (row level security):
// owner and admin mark attendance, only the owner changes people, salaries and settings.

type Loose = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES: readonly string[] = ["present", "half", "absent", "leave"];

async function staffUser(): Promise<SessionUser | ActionResult<never>> {
  const user = await getActiveUser();
  if (!user) return NOT_SIGNED_IN;
  if (user.role !== "owner" && user.role !== "admin") return { ok: false, message: "Only the owner or an admin can use the Team page." };
  return user;
}
async function ownerUser(): Promise<SessionUser | ActionResult<never>> {
  const user = await getActiveUser();
  if (!user) return NOT_SIGNED_IN;
  if (user.role !== "owner") return { ok: false, message: "Only the owner can do that." };
  return user;
}
const isResult = (v: SessionUser | ActionResult<never>): v is ActionResult<never> => "ok" in v;

/** A day that can be marked: not in the future, not older than about three months. */
function markableDay(day: unknown): string | null {
  if (typeof day !== "string" || !DAY.test(day)) return null;
  const today = todayIST();
  const oldest = new Date(Date.parse(`${today}T00:00:00Z`) - 92 * 86_400_000).toISOString().slice(0, 10);
  return day <= today && day >= oldest ? day : null;
}

/** One person's mark for a day. A null status removes the mark. */
export async function markAttendance(staffId: unknown, day: unknown, status: unknown): Promise<ActionResult> {
  const user = await staffUser();
  if (isResult(user)) return user;
  const d = markableDay(day);
  if (typeof staffId !== "string" || !UUID.test(staffId) || !d) return { ok: false, message: "That day or person was not understood." };
  if (status !== null && !(typeof status === "string" && STATUSES.includes(status))) return { ok: false, message: "That mark was not understood." };

  const db = (await createClient()) as unknown as Loose;
  const { error } =
    status === null
      ? await db.from("attendance").delete().eq("staff_id", staffId).eq("day", d)
      : await db.from("attendance").upsert({ staff_id: staffId, day: d, status, marked_by: user.id, updated_at: new Date().toISOString() }, { onConflict: "staff_id,day" });
  if (error) return dbError(error, "save the attendance");
  revalidatePath("/team");
  return { ok: true, message: status === null ? "Mark cleared" : "Saved" };
}

/** "Mark everyone present" for a warehouse: only people with no mark yet on that day are filled in. */
export async function markWarehousePresent(warehouseId: unknown, day: unknown): Promise<ActionResult> {
  const user = await staffUser();
  if (isResult(user)) return user;
  const d = markableDay(day);
  if (typeof warehouseId !== "string" || !UUID.test(warehouseId) || !d) return { ok: false, message: "That day or warehouse was not understood." };

  const db = (await createClient()) as unknown as Loose;
  const people = await db.from("staff").select("id").eq("warehouse_id", warehouseId).eq("active", true);
  if (people.error) return dbError(people.error, "read the team");
  const done = await db.from("attendance").select("staff_id").eq("day", d);
  if (done.error) return dbError(done.error, "read the attendance");
  const marked = new Set(((done.data ?? []) as { staff_id: string }[]).map((r) => r.staff_id));
  const rows = ((people.data ?? []) as { id: string }[])
    .filter((p) => !marked.has(p.id))
    .map((p) => ({ staff_id: p.id, day: d, status: "present", marked_by: user.id, updated_at: new Date().toISOString() }));
  if (rows.length === 0) return { ok: true, message: "Everyone already has a mark" };
  const { error } = await db.from("attendance").insert(rows);
  if (error) return dbError(error, "save the attendance");
  revalidatePath("/team");
  return { ok: true, message: `${rows.length} marked present` };
}

export type ImportPerson = { name: string; warehouseId: string; salary: number | null };
export type ImportMark = { name: string; warehouseId: string; day: string; status: AttendanceStatus };

/**
 * The owner's staff sheet, already read in the browser and matched to warehouses: adds people (or finds the ones that are
 * there), sets salaries, and records any attendance marks. Nothing is removed. Owner only.
 */
export async function importTeamSheet(people: unknown, marks: unknown): Promise<ActionResult<{ people: number; marks: number }>> {
  const user = await ownerUser();
  if (isResult(user)) return user;
  if (!Array.isArray(people) || people.length === 0 || people.length > 300) return { ok: false, message: "The sheet has no people, or far too many." };
  if (!Array.isArray(marks) || marks.length > 30000) return { ok: false, message: "The sheet has too many attendance marks." };

  const clean: ImportPerson[] = [];
  const seen = new Set<string>();
  for (const p of people as Partial<ImportPerson>[]) {
    const name = typeof p?.name === "string" ? p.name.trim() : "";
    if (!name || name.length > 100) return { ok: false, message: "Nothing was changed: a name is empty or too long." };
    if (typeof p?.warehouseId !== "string" || !UUID.test(p.warehouseId)) return { ok: false, message: "Nothing was changed: a warehouse was not understood." };
    const salary = p.salary === null || p.salary === undefined ? null : p.salary;
    if (salary !== null && (!Number.isInteger(salary) || salary < 0 || salary > 10_000_000)) return { ok: false, message: "Nothing was changed: a salary was not understood." };
    // The same person twice in one warehouse would make the save fail; the later row wins.
    const key = `${p.warehouseId}|${name}`;
    if (seen.has(key)) clean.splice(clean.findIndex((c) => `${c.warehouseId}|${c.name}` === key), 1);
    seen.add(key);
    clean.push({ name, warehouseId: p.warehouseId, salary });
  }
  const cleanMarks: ImportMark[] = [];
  for (const m of marks as Partial<ImportMark>[]) {
    if (typeof m?.name !== "string" || typeof m?.warehouseId !== "string" || !UUID.test(m.warehouseId)) return { ok: false, message: "Nothing was changed: an attendance mark was not understood." };
    if (typeof m?.day !== "string" || !DAY.test(m.day) || typeof m?.status !== "string" || !STATUSES.includes(m.status)) return { ok: false, message: "Nothing was changed: an attendance mark was not understood." };
    cleanMarks.push({ name: m.name.trim(), warehouseId: m.warehouseId, day: m.day, status: m.status });
  }

  const db = (await createClient()) as unknown as Loose;
  const upserted = await db
    .from("staff")
    .upsert(clean.map((p) => ({ name: p.name, warehouse_id: p.warehouseId, active: true })), { onConflict: "warehouse_id,name" })
    .select("id, name, warehouse_id");
  if (upserted.error) return dbError(upserted.error, "save the team");
  const ids = new Map(((upserted.data ?? []) as { id: string; name: string; warehouse_id: string }[]).map((s) => [`${s.warehouse_id}|${s.name}`, s.id]));

  const pay = clean
    .filter((p) => p.salary !== null)
    .map((p) => ({ staff_id: ids.get(`${p.warehouseId}|${p.name}`), monthly_salary: p.salary, updated_at: new Date().toISOString() }))
    .filter((r) => r.staff_id);
  if (pay.length) {
    const r = await db.from("staff_pay").upsert(pay, { onConflict: "staff_id" });
    if (r.error) return dbError(r.error, "save the salaries");
  }

  const rows = cleanMarks
    .map((m) => ({ staff_id: ids.get(`${m.warehouseId}|${m.name}`), day: m.day, status: m.status, marked_by: user.id, updated_at: new Date().toISOString() }))
    .filter((r) => r.staff_id);
  for (let i = 0; i < rows.length; i += 1000) {
    const r = await db.from("attendance").upsert(rows.slice(i, i + 1000), { onConflict: "staff_id,day" });
    if (r.error) return dbError(r.error, "save the attendance");
  }

  revalidatePath("/team");
  return { ok: true, message: `${ids.size} people saved${rows.length ? `, ${rows.length} attendance marks` : ""}`, data: { people: ids.size, marks: rows.length } };
}

/** Owner: orders per person (comfortable and at most) and the days it takes to find someone. */
export async function saveTeamSettings(low: unknown, high: unknown, leadDays: unknown): Promise<ActionResult> {
  const user = await ownerUser();
  if (isResult(user)) return user;
  const ok = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
  if (!ok(low, 50, 5000) || !ok(high, 50, 5000)) return { ok: false, message: "Orders per person must be whole numbers between 50 and 5,000." };
  if (high < low) return { ok: false, message: "The most a person can pack cannot be less than the comfortable number." };
  if (!ok(leadDays, 0, 90)) return { ok: false, message: "Days to find a new person must be between 0 and 90." };

  const db = (await createClient()) as unknown as Loose;
  const rows: [string, number][] = [["team_orders_per_person_low", low], ["team_orders_per_person_high", high], ["team_hire_lead_days", leadDays]];
  for (const [key, value] of rows) {
    const { data, error } = await db
      .from("app_settings")
      .update({ value, updated_at: new Date().toISOString(), updated_by: user.id })
      .eq("key", key)
      .select("key");
    if (error) return dbError(error, "save the settings");
    if (!data?.length) return { ok: false, message: "These settings are not switched on in the database yet. Ask the developer." };
  }
  revalidatePath("/team");
  return { ok: true, message: "Planning numbers saved" };
}

/** Owner: a person who has left (or come back). Their past attendance is kept. */
export async function setStaffActive(staffId: unknown, active: unknown): Promise<ActionResult> {
  const user = await ownerUser();
  if (isResult(user)) return user;
  if (typeof staffId !== "string" || !UUID.test(staffId) || typeof active !== "boolean") return { ok: false, message: "That was not understood." };
  const db = (await createClient()) as unknown as Loose;
  const { error } = await db.from("staff").update({ active }).eq("id", staffId);
  if (error) return dbError(error, "update the team");
  revalidatePath("/team");
  return { ok: true, message: active ? "Back on the team" : "Removed from the plan" };
}
