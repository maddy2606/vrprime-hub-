// Business page (graphite-spec 12.1): the week against the week before, and the monthly targets. Pure calculations;
// the database adds the figures up (business_week), this file reads them, compares them and works out the targets.

import { addDays } from "./format.ts";

export type WeekProduct = { id: string | null; name: string; units: number };

export type WeekFigures = {
  orders: number;
  units: number;
  sales: number;
  cancelled: number;
  returnsCustomer: number;
  returnsCourier: number;
  dispatchedUnits: number;
  late: number;
  adSpend: number;
  adsReadTo: string | null;
  byProduct: WeekProduct[];
};

export type WeekMetric = "orders" | "units" | "sales" | "dispatchedUnits" | "cancelled" | "returnsCustomer" | "returnsCourier" | "late" | "adSpend";

/** Which way is good: up for orders, units, sales and dispatched units; down for cancelled, returns and late; ads neither. */
export const GOOD_DIRECTION: Record<WeekMetric, "up" | "down" | "none"> = {
  orders: "up",
  units: "up",
  sales: "up",
  dispatchedUnits: "up",
  cancelled: "down",
  returnsCustomer: "down",
  returnsCourier: "down",
  late: "down",
  adSpend: "none",
};

/** The table's rows, in the spec's order. */
export const WEEK_ROWS: { key: WeekMetric; label: string; money?: boolean }[] = [
  { key: "orders", label: "Orders" },
  { key: "units", label: "Units" },
  { key: "sales", label: "Sales (seller price)", money: true },
  { key: "dispatchedUnits", label: "Dispatched units" },
  { key: "cancelled", label: "Cancelled" },
  { key: "returnsCustomer", label: "Customer returns" },
  { key: "returnsCourier", label: "Courier returns" },
  { key: "late", label: "Orders flagged late" },
  { key: "adSpend", label: "Ads incl. 18% GST", money: true },
];

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};

/** Reads one half ({cur} or {prev}) of business_week(). */
export function readWeekFigures(raw: unknown): WeekFigures {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const products = Array.isArray(o.by_product) ? o.by_product : [];
  return {
    orders: num(o.orders),
    units: num(o.units),
    sales: num(o.sales),
    cancelled: num(o.cancelled),
    returnsCustomer: num(o.returns_customer),
    returnsCourier: num(o.returns_courier),
    dispatchedUnits: num(o.dispatched_units),
    late: num(o.late),
    adSpend: num(o.ad_spend),
    adsReadTo: typeof o.ads_read_to === "string" ? o.ads_read_to.slice(0, 10) : null,
    byProduct: products
      .filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === "object")
      .map((p) => ({ id: typeof p.id === "string" ? p.id : null, name: typeof p.name === "string" ? p.name : "—", units: num(p.units) })),
  };
}

/** The Monday (Monday to Sunday weeks) of the week holding `day` (yyyy-mm-dd). */
export function businessWeekStart(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return addDays(day, -((d.getUTCDay() + 6) % 7));
}

/** p_days: the days so far including today for the current week, 7 for a finished week. */
export function weekDays(start: string, today: string): number {
  const end = addDays(start, 6);
  if (end < today) return 7;
  const d = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
  return Math.min(7, Math.max(1, d));
}

/** The week to open: the Monday of a valid `start` parameter no later than this week, else this week. */
export function weekFromParam(param: string | null | undefined, today: string): string {
  const current = businessWeekStart(today);
  if (!param || !/^\d{4}-\d{2}-\d{2}$/.test(param) || Number.isNaN(Date.parse(`${param}T00:00:00Z`))) return current;
  const start = businessWeekStart(param);
  return start > current ? current : start;
}

/** The change from `prev` to `cur`, and the percent (null when there was nothing before). */
export function change(cur: number, prev: number): { diff: number; pct: number | null } {
  return { diff: cur - prev, pct: prev === 0 ? null : ((cur - prev) / prev) * 100 };
}

/** The Change column's tone: ok when the direction is good, bad when it is bad, muted when neutral or under 1%. */
export function changeTone(metric: WeekMetric, cur: number, prev: number): "ok" | "bad" | "muted" {
  const { diff, pct } = change(cur, prev);
  const dir = GOOD_DIRECTION[metric];
  if (dir === "none" || diff === 0) return "muted";
  if (pct !== null && Math.abs(pct) < 1) return "muted";
  return (diff > 0) === (dir === "up") ? "ok" : "bad";
}

/** Signed with a true minus: "+12", "−3". */
export function signed(n: number, format: (n: number) => string): string {
  if (n === 0) return format(0);
  return `${n > 0 ? "+" : "−"}${format(Math.abs(n))}`;
}

/** The percent as shown: "+12%", "−3%", or "new" when there was nothing before. */
export function signedPct(pct: number | null): string {
  if (pct === null) return "new";
  const r = Math.round(pct);
  return r === 0 ? "0%" : `${r > 0 ? "+" : "−"}${Math.abs(r)}%`;
}

/** The subtitle: "Orders are up 12% on last week; sales ₹X against ₹Y." */
export function weekSentence(cur: WeekFigures, prev: WeekFigures, money: (n: number) => string): string {
  const { pct } = change(cur.orders, prev.orders);
  const orders =
    pct === null
      ? cur.orders > 0
        ? "Orders are up on last week"
        : "No orders yet this week or last"
      : Math.round(pct) === 0
        ? "Orders are level with last week"
        : `Orders are ${pct > 0 ? "up" : "down"} ${Math.abs(Math.round(pct))}% on last week`;
  return `${orders}; sales ${money(cur.sales)} against ${money(prev.sales)}.`;
}

export type Mover = { key: string; name: string; units: number; was: number; diff: number };

/** Rising and Falling: the five largest increases and falls in units, ignoring products under 5 units in both weeks. */
export function movers(cur: WeekProduct[], prev: WeekProduct[]): { rising: Mover[]; falling: Mover[] } {
  const keyOf = (p: WeekProduct) => p.id ?? `sku:${p.name}`;
  const all = new Map<string, Mover>();
  for (const p of cur) all.set(keyOf(p), { key: keyOf(p), name: p.name, units: p.units, was: 0, diff: 0 });
  for (const p of prev) {
    const m = all.get(keyOf(p)) ?? { key: keyOf(p), name: p.name, units: 0, was: 0, diff: 0 };
    m.was += p.units;
    all.set(keyOf(p), m);
  }
  const list = [...all.values()].map((m) => ({ ...m, diff: m.units - m.was })).filter((m) => m.units >= 5 || m.was >= 5);
  const byName = (a: Mover, b: Mover) => a.name.localeCompare(b.name);
  return {
    rising: list.filter((m) => m.diff > 0).sort((a, b) => b.diff - a.diff || byName(a, b)).slice(0, 5),
    falling: list.filter((m) => m.diff < 0).sort((a, b) => a.diff - b.diff || byName(a, b)).slice(0, 5),
  };
}

/** A target setting: whole rupees, or null when not set (blank, missing or not a number). */
export function readTargetValue(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

export type TargetView = {
  target: number;
  soFar: number;
  pctOfTarget: number;
  /** Where today should be: target × day of month ÷ days in month. */
  expected: number;
  /** The month's figure so far spread over the whole month (the Dashboard's "on pace" rule), or null. */
  pace: number | null;
  /** pace − target: above 0 ahead, below 0 behind. */
  gap: number | null;
  daysLeft: number;
  /** max(0, target − so far) ÷ days left including today. */
  perDay: number;
};

/**
 * One target card's figures. `covered` is the day of the month the figures run to (the Dashboard's `covered`), null
 * when there are none for this month.
 */
export function targetView(target: number, soFar: number, today: string, covered: number | null): TargetView {
  const [y, m, d] = today.split("-").map(Number);
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pace = covered ? (soFar / covered) * daysIn : null;
  const daysLeft = daysIn - d + 1;
  return {
    target,
    soFar,
    pctOfTarget: target > 0 ? (soFar / target) * 100 : 0,
    expected: (target * d) / daysIn,
    pace,
    gap: pace === null ? null : pace - target,
    daysLeft,
    perDay: Math.max(0, target - soFar) / daysLeft,
  };
}
