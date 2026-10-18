// Team capacity planning, as plain functions (relative imports, so `node --test` can load it).
//
// The question this answers: "will the people we have be able to pack the orders that are coming, and if not, by what date
// must the next person be found?" Everything is per warehouse; the page adds them up.
//
//   demand    orders placed per day (cancelled ones left out), projected forward with the recent trend
//   capacity  people x how often they actually come in x orders one person can pack a day
//   comfort   `low` orders a person (the owner's "normal": nobody is rushed)
//   limit     `high` orders a person (possible, but people feel the pressure)
//
// A day is "ok" up to comfort, "tight" between comfort and the limit, and "short" past the limit.

export type AttendanceStatus = "present" | "half" | "absent" | "leave";

/** How much of a working day each mark counts for. */
export const ATTENDANCE_WEIGHT: Record<AttendanceStatus, number> = { present: 1, half: 0.5, absent: 0, leave: 0 };

export type CapacitySettings = {
  /** Orders one person packs in a normal day. */
  low: number;
  /** Orders one person can pack when pushed. */
  high: number;
  /** Days it takes to find and train a new person. */
  leadDays: number;
};

export const DEFAULT_CAPACITY_SETTINGS: CapacitySettings = { low: 400, high: 500, leadDays: 7 };

const DAY_MS = 86_400_000;

export const shiftDay = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const weekday = (day: string): number => new Date(`${day}T00:00:00Z`).getUTCDay();
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// --- Demand -----------------------------------------------------------------------------------------------------------

export const MIN_HISTORY_DAYS = 7;
const WINDOW_DAYS = 28;
/** Each further day of a trend counts for a little less, so a steep week is not carried on forever. */
const DAMPING = 0.9;

export type OrdersForecast =
  | { ready: false; haveDays: number; needDays: number }
  | {
      ready: true;
      /** The average of the last 7 full days. */
      level: number;
      /** Orders added to the daily level, per day, by the recent trend. */
      slopePerDay: number;
      /** Last 7 days against the 7 before, in percent; null with under 14 days of history. */
      weeklyChangePct: number | null;
      /** How many full days of history this is drawn from. */
      historyDays: number;
      days: { day: string; orders: number }[];
    };

/**
 * Orders per day for the next `horizon` days. `history` is orders placed per day (a day with no row had no orders, but days
 * before the first row are unknown, not zero). Today is left out of the history: it is not finished.
 *
 * It takes the 7-day average as the level, fits a straight line to the last two weeks of that average for the trend, damps
 * the trend, and (with 3+ weeks of history) applies each weekday's usual share.
 */
export function forecastOrders(history: Record<string, number>, today: string, horizon = 14): OrdersForecast {
  const known = Object.keys(history).filter((d) => d < today && history[d] >= 0).sort();
  if (known.length === 0) return { ready: false, haveDays: 0, needDays: MIN_HISTORY_DAYS };
  const start = known[0] > shiftDay(today, -WINDOW_DAYS) ? known[0] : shiftDay(today, -WINDOW_DAYS);
  const series: number[] = [];
  const dayOf: string[] = [];
  for (let d = start; d < today; d = shiftDay(d, 1)) {
    series.push(history[d] ?? 0);
    dayOf.push(d);
  }
  const n = series.length;
  if (n < MIN_HISTORY_DAYS) return { ready: false, haveDays: n, needDays: MIN_HISTORY_DAYS };

  const avg7: number[] = [];
  for (let i = 6; i < n; i++) avg7.push(mean(series.slice(i - 6, i + 1)));
  const level = avg7[avg7.length - 1];

  // Least-squares slope of the last (up to) 14 points of the 7-day average.
  const tail = avg7.slice(-14);
  let slope = 0;
  if (tail.length >= 3) {
    const mx = (tail.length - 1) / 2;
    const my = mean(tail);
    let num = 0;
    let den = 0;
    tail.forEach((y, x) => {
      num += (x - mx) * (y - my);
      den += (x - mx) ** 2;
    });
    slope = den === 0 ? 0 : num / den;
  }

  const last7 = mean(series.slice(-7));
  const prev7 = n >= 14 ? mean(series.slice(-14, -7)) : 0;
  const weeklyChangePct = n >= 14 && prev7 > 0 ? ((last7 - prev7) / prev7) * 100 : null;

  // Each weekday's usual share of the average day, held to 70%..130% so one odd Tuesday cannot rewrite the forecast.
  // Measured against the 7-day average centred on each day, so a rising or falling trend cancels out and is not mistaken
  // for a weekday habit.
  const factor = Array.from({ length: 7 }, () => 1);
  if (n >= 21) {
    const ratios: number[][] = Array.from({ length: 7 }, () => []);
    for (let i = 3; i < n - 3; i++) {
      const around = mean(series.slice(i - 3, i + 4));
      if (around > 0) ratios[weekday(dayOf[i])].push(series[i] / around);
    }
    for (let w = 0; w < 7; w++) if (ratios[w].length) factor[w] = Math.min(1.3, Math.max(0.7, mean(ratios[w])));
  }

  // A trailing 7-day average sits about 3 days behind the latest day; on a rising or falling trend that lag is 3 x the slope,
  // so add it back or the forecast would start below where orders already are.
  const base = level + slope * 3;
  const days: { day: string; orders: number }[] = [];
  let carried = 0;
  for (let h = 1; h <= horizon; h++) {
    carried += DAMPING ** h;
    const day = shiftDay(today, h);
    days.push({ day, orders: Math.round(Math.max(0, base + slope * carried) * factor[weekday(day)]) });
  }
  return { ready: true, level, slopePerDay: slope, weeklyChangePct, historyDays: n, days };
}

// --- Attendance -------------------------------------------------------------------------------------------------------

/** Fewer marks than this and the attendance rate is not trusted; the full headcount is used. */
export const MIN_ATTENDANCE_MARKS = 5;

/** The share of working days people actually came in (0..1), from marks over a recent window; null with too few marks. */
export function attendanceRate(marks: { status: AttendanceStatus }[]): number | null {
  if (marks.length < MIN_ATTENDANCE_MARKS) return null;
  return mean(marks.map((m) => ATTENDANCE_WEIGHT[m.status]));
}

/** A rate below this is treated as this: a week of bad luck should not halve the plan. */
const RATE_FLOOR = 0.3;
const usable = (rate: number | null): number => (rate === null ? 1 : Math.min(1, Math.max(RATE_FLOOR, rate)));

// --- The plan ---------------------------------------------------------------------------------------------------------

export type DayStatus = "ok" | "tight" | "short";

export type DayPlan = {
  day: string;
  /** What the trend expects. */
  orders: number;
  /** Orders already waiting to be packed on that day (a floor under the forecast). */
  booked: number;
  /** The load used: the larger of the two. */
  demand: number;
  status: DayStatus;
  /** Extra people needed to be comfortable that day; 0 when ok. */
  extra: number;
};

export type WarehousePlan = {
  forecast: OrdersForecast;
  staff: number;
  /** Headcount after attendance: the people who really turn up. */
  effective: number;
  attendanceRate: number | null;
  /** Orders a day the team packs comfortably, and at the limit. */
  comfortable: number;
  limit: number;
  days: DayPlan[];
  /** The first day that is not "ok", and the last day to start looking for someone for it. */
  firstPressure: string | null;
  hireBy: string | null;
  firstShort: string | null;
  /** The most extra people needed on any day in the window. */
  extraNeeded: number;
};

export function planWarehouse(input: {
  today: string;
  staff: number;
  attendanceRate: number | null;
  forecast: OrdersForecast;
  /** Orders already booked to be packed, by day. */
  booked: Record<string, number>;
  settings: CapacitySettings;
  horizon?: number;
}): WarehousePlan {
  const { today, staff, forecast, booked, settings } = input;
  const horizon = input.horizon ?? 14;
  const rate = usable(input.attendanceRate);
  const effective = staff * rate;
  const comfortable = Math.round(effective * settings.low);
  const limit = Math.round(effective * settings.high);

  const trend = forecast.ready ? new Map(forecast.days.map((d) => [d.day, d.orders])) : new Map<string, number>();
  const days: DayPlan[] = [];
  for (let h = 1; h <= horizon; h++) {
    const day = shiftDay(today, h);
    const orders = trend.get(day) ?? 0;
    const b = booked[day] ?? 0;
    const demand = Math.max(orders, b);
    const status: DayStatus = demand <= comfortable ? "ok" : demand <= limit ? "tight" : "short";
    // A new person is also not there every day, so they count for `low x rate`.
    const extra = status === "ok" ? 0 : Math.ceil((demand - comfortable) / (settings.low * rate));
    days.push({ day, orders, booked: b, demand, status, extra });
  }

  const firstPressure = days.find((d) => d.status !== "ok")?.day ?? null;
  const firstShort = days.find((d) => d.status === "short")?.day ?? null;
  return {
    forecast,
    staff,
    effective,
    attendanceRate: input.attendanceRate,
    comfortable,
    limit,
    days,
    firstPressure,
    hireBy: firstPressure ? shiftDay(firstPressure, -settings.leadDays) : null,
    firstShort,
    extraNeeded: Math.max(0, ...days.map((d) => d.extra)),
  };
}

// --- The headline -----------------------------------------------------------------------------------------------------

export type Headline = { tone: "ok" | "warn" | "bad"; headline: string; detail: string };

const people = (n: number) => `${n} more ${n === 1 ? "person" : "people"}`;

/**
 * One sentence for the top of the page. `bad` when someone should already be looking (the date to start has come), `warn`
 * when pressure is coming, `ok` when the team covers the whole window.
 */
export function capacityHeadline(
  plans: { name: string; plan: WarehousePlan }[],
  today: string,
  settings: CapacitySettings,
  fmtDay: (day: string) => string,
  horizon = 14,
): Headline {
  const ready = plans.filter((p) => p.plan.staff > 0);
  if (ready.length === 0) return { tone: "warn", headline: "No team is set up yet", detail: "Import your staff sheet to start planning." };
  const needing = ready.filter((p) => p.plan.firstPressure).sort((a, b) => (a.plan.hireBy ?? "").localeCompare(b.plan.hireBy ?? ""));
  if (needing.length === 0) {
    const waiting = ready.every((p) => !p.plan.forecast.ready);
    return waiting
      ? { tone: "ok", headline: "Nothing booked beyond what the team can pack", detail: "There is not enough order history yet to project the trend, so only orders already booked are counted." }
      : { tone: "ok", headline: `Your team covers the next ${horizon} days`, detail: `At ${settings.low} orders a person a day, with attendance counted.` };
  }
  const first = needing[0];
  const total = needing.reduce((n, p) => n + p.plan.extraNeeded, 0);
  const overdue = (first.plan.hireBy ?? today) <= today;
  const where = needing.length === 1 ? first.name : `${first.name} first`;
  return {
    tone: overdue ? "bad" : "warn",
    headline: overdue ? `Start hiring now: ${people(total)} needed, ${where}` : `Plan ${people(total)} by ${fmtDay(first.plan.hireBy ?? today)}, ${where}`,
    detail: `${first.name} gets busier from ${fmtDay(first.plan.firstPressure ?? today)}; finding someone takes about ${settings.leadDays} days.`,
  };
}
