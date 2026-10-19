import "server-only";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import {
  attendanceRate,
  capacityHeadline,
  combinePlans,
  DEFAULT_CAPACITY_SETTINGS,
  forecastOrders,
  planWarehouse,
  shiftDay,
  teamCapacity,
  type AttendanceStatus,
  type CapacitySettings,
  type Headline,
  type WarehousePlan,
} from "@/lib/capacity";
import { formatDate, todayIST } from "@/lib/format";
import { logError } from "@/lib/redact";
import { createClient } from "@/lib/supabase/server";
import { warehouseColor } from "@/lib/theme";
import type { SessionUser } from "@/lib/types";

// Owner and admin only: everyone else gets "not found". Salaries are owner only, and the database enforces that on its
// own (staff_pay has a row level policy for the owner alone), so an admin's query returns no pay even if this code asked.

export type Loose = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

export async function requireTeamPage(): Promise<{ user: SessionUser; db: Loose }> {
  const user = await requireUser();
  if (user.role !== "owner" && user.role !== "admin") notFound();
  return { user, db: (await createClient()) as unknown as Loose };
}

function fail(where: string, error: unknown): never {
  logError(`team ${where}`, error);
  throw new Error("Could not load the Team page");
}

const SETTING_KEYS = ["team_orders_per_person_low", "team_orders_per_person_high", "team_hire_lead_days"] as const;
const whole = (v: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

export type PersonView = {
  id: string;
  name: string;
  warehouseId: string;
  active: boolean;
  /** The mark on the chosen day, if any. */
  status: AttendanceStatus | null;
  /** This month's marks, counted. */
  month: { present: number; half: number; absent: number; leave: number };
  /** Monthly salary. Only ever filled in for the owner. */
  salary: number | null;
};

export type WarehouseView = {
  id: string;
  name: string;
  color: string;
  plan: WarehousePlan;
  /** Active people on the books, and how many of them have a mark of present or half on the chosen day. */
  staff: number;
  inToday: number;
  marked: number;
  /** Orders placed yesterday and the average of the last 7 full days. */
  yesterday: number | null;
  average: number | null;
};

export type TeamData = {
  today: string;
  day: string;
  settings: CapacitySettings;
  isOwner: boolean;
  headline: Headline;
  total: { plan: WarehousePlan; staff: number };
  warehouses: WarehouseView[];
  people: PersonView[];
  /** Orders placed per day, all warehouses, the last 14 full days, for the chart. */
  past: { day: string; orders: number }[];
  /** True when there is no order history at all yet. */
  noOrders: boolean;
  monthLabel: string;
};

function readSettings(rows: { key: string; value: unknown }[]): CapacitySettings {
  const settings = { ...DEFAULT_CAPACITY_SETTINGS };
  for (const s of rows) {
    if (s.key === "team_orders_per_person_low") settings.low = whole(s.value, settings.low, 50, 5000);
    if (s.key === "team_orders_per_person_high") settings.high = whole(s.value, settings.high, 50, 5000);
    if (s.key === "team_hire_lead_days") settings.leadDays = whole(s.value, settings.leadDays, 0, 90);
  }
  if (settings.high < settings.low) settings.high = settings.low;
  return settings;
}

/**
 * What the whole team packs comfortably in a day, the same sum the Team page makes: per warehouse, people x recent
 * attendance x orders a person. Null when nobody is set up, or for a reader who cannot see the team (warehouse users).
 */
export async function loadTeamCapacity(db: Loose, today: string): Promise<{ staff: number; comfortable: number } | null> {
  const [staffRes, markRes, setRes] = await Promise.all([
    db.from("staff").select("id, warehouse_id").eq("active", true),
    db.from("attendance").select("staff_id, status").gte("day", shiftDay(today, -14)).lte("day", today),
    db.from("app_settings").select("key, value").in("key", [...SETTING_KEYS]),
  ]);
  if (staffRes.error || markRes.error || setRes.error) {
    logError("team capacity", staffRes.error ?? markRes.error ?? setRes.error);
    return null;
  }
  const staff = (staffRes.data ?? []) as { id: string; warehouse_id: string }[];
  if (staff.length === 0) return null;
  const marks = (markRes.data ?? []) as { staff_id: string; status: AttendanceStatus }[];
  const settings = readSettings((setRes.data ?? []) as { key: string; value: unknown }[]);
  let comfortable = 0;
  for (const wh of new Set(staff.map((s) => s.warehouse_id))) {
    const ids = new Set(staff.filter((s) => s.warehouse_id === wh).map((s) => s.id));
    comfortable += teamCapacity(ids.size, attendanceRate(marks.filter((m) => ids.has(m.staff_id))), settings).comfortable;
  }
  return { staff: staff.length, comfortable };
}

const monthStart = (day: string) => `${day.slice(0, 8)}01`;
const monthEnd = (day: string) => {
  const d = new Date(`${monthStart(day)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
};

type OrderRow = { kind: "placed" | "due"; day: string; warehouse_id: string | null; orders: number };

export async function loadTeam(user: SessionUser, db: Loose, requestedDay: string | null): Promise<TeamData> {
  const today = todayIST();
  const day = requestedDay && /^\d{4}-\d{2}-\d{2}$/.test(requestedDay) && requestedDay <= today && requestedDay >= shiftDay(today, -92) ? requestedDay : today;
  const isOwner = user.role === "owner";
  const from = [monthStart(day), shiftDay(today, -14)].sort()[0];
  const to = [monthEnd(day), today].sort().reverse()[0];

  const [whRes, staffRes, payRes, markRes, setRes, loadRes] = await Promise.all([
    db.from("warehouses").select("id, name, sort_order").order("sort_order"),
    db.from("staff").select("id, name, warehouse_id, active").order("name"),
    isOwner ? db.from("staff_pay").select("staff_id, monthly_salary") : Promise.resolve({ data: [], error: null }),
    db.from("attendance").select("staff_id, day, status").gte("day", from).lte("day", to),
    db.from("app_settings").select("key, value").in("key", [...SETTING_KEYS]),
    db.rpc("team_order_load", { p_days: 35 }),
  ]);
  for (const [where, r] of [["warehouses", whRes], ["staff", staffRes], ["pay", payRes], ["attendance", markRes], ["settings", setRes]] as const) {
    if (r.error) fail(where, r.error);
  }
  if (loadRes.error) fail("order load", loadRes.error);

  const settings = readSettings((setRes.data ?? []) as { key: string; value: unknown }[]);

  const warehouses = (whRes.data ?? []) as { id: string; name: string }[];
  const staff = (staffRes.data ?? []) as { id: string; name: string; warehouse_id: string; active: boolean }[];
  const pay = new Map(((payRes.data ?? []) as { staff_id: string; monthly_salary: number }[]).map((p) => [p.staff_id, p.monthly_salary]));
  const marks = (markRes.data ?? []) as { staff_id: string; day: string; status: AttendanceStatus }[];
  const orders = (Array.isArray(loadRes.data) ? loadRes.data : []) as OrderRow[];

  const mStart = monthStart(day);
  const mEnd = monthEnd(day);
  const people: PersonView[] = staff.map((s) => {
    const mine = marks.filter((m) => m.staff_id === s.id);
    const month = { present: 0, half: 0, absent: 0, leave: 0 };
    for (const m of mine) if (m.day >= mStart && m.day <= mEnd) month[m.status] += 1;
    return {
      id: s.id,
      name: s.name,
      warehouseId: s.warehouse_id,
      active: s.active,
      status: mine.find((m) => m.day === day)?.status ?? null,
      month,
      salary: isOwner ? (pay.get(s.id) ?? null) : null,
    };
  });

  const placedBy = (whId: string | null) => {
    const h: Record<string, number> = {};
    for (const r of orders) if (r.kind === "placed" && (whId === null || r.warehouse_id === whId)) h[r.day] = (h[r.day] ?? 0) + r.orders;
    return h;
  };
  const dueBy = (whId: string | null) => {
    const h: Record<string, number> = {};
    for (const r of orders) if (r.kind === "due" && (whId === null || r.warehouse_id === whId)) h[r.day] = (h[r.day] ?? 0) + r.orders;
    return h;
  };
  const sumDays = (h: Record<string, number>, from: number, to: number) => {
    let n = 0;
    for (let i = from; i <= to; i++) n += h[shiftDay(today, -i)] ?? 0;
    return n;
  };

  const windowStart = shiftDay(today, -14);
  const views: WarehouseView[] = warehouses.map((w, i) => {
    const active = people.filter((p) => p.warehouseId === w.id && p.active);
    const recent = marks.filter((m) => m.day >= windowStart && m.day <= today && active.some((p) => p.id === m.staff_id));
    const history = placedBy(w.id);
    const plan = planWarehouse({
      today,
      staff: active.length,
      attendanceRate: attendanceRate(recent),
      forecast: forecastOrders(history, today),
      booked: dueBy(w.id),
      settings,
    });
    const known = Object.keys(history).length > 0;
    return {
      id: w.id,
      name: w.name,
      color: warehouseColor(w.name, i),
      plan,
      staff: active.length,
      inToday: active.filter((p) => p.status === "present" || p.status === "half").length,
      marked: active.filter((p) => p.status !== null).length,
      yesterday: known ? (history[shiftDay(today, -1)] ?? 0) : null,
      average: known ? Math.round(sumDays(history, 1, 7) / 7) : null,
    };
  });

  const staffTotal = views.reduce((n, v) => n + v.staff, 0);
  const allPlaced = placedBy(null);
  // The "All warehouses" row adds up the rows above it.
  const total = combinePlans(
    views.map((v) => v.plan),
    forecastOrders(allPlaced, today),
    settings,
  );

  const headline = capacityHeadline(
    views.map((v) => ({ name: v.name, plan: v.plan })),
    today,
    settings,
    (d) => formatDate(d, today),
  );

  const past = Array.from({ length: 14 }, (_, i) => {
    const d = shiftDay(today, -(14 - i));
    return { day: d, orders: allPlaced[d] ?? 0 };
  });

  return {
    today,
    day,
    settings,
    isOwner,
    headline,
    total: { plan: total, staff: staffTotal },
    warehouses: views,
    people,
    past,
    noOrders: Object.keys(allPlaced).length === 0,
    monthLabel: new Date(`${mStart}T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }),
  };
}
