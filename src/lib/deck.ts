// The Command Deck's logic, as plain functions (relative imports, so `node --test` can load it): how the priority queue is
// ranked, what the headline says, and how healthy a warehouse looks.

import { analyze, isInactive, type DeskData } from "./stock-analysis.ts";

export type QueueKind = "late" | "risk" | "overfill" | "dry" | "ticket" | "work";

export type QueueAction = { label: string; href: string };

export type QueueItem = {
  key: string;
  kind: QueueKind;
  /** Higher is more urgent. Fixed per kind, see SEVERITY. */
  severity: number;
  /** When it is (or was) due, in ms since 1970. Earlier first among equals; none goes last. */
  deadline: number | null;
  title: string;
  detail: string;
  actions: QueueAction[];
};

export const KIND_TAG: Record<QueueKind, string> = {
  late: "LATE",
  risk: "AT RISK",
  overfill: "OVERFILL",
  dry: "OUT OF STOCK",
  ticket: "TICKET",
  work: "WORK",
};

/**
 * How urgent each kind is. A late order is money already at risk; overfill is an order that cannot ship; a SKU that is
 * dry and selling is about to cause both; an order close to its deadline comes next; then follow-ups and my own work.
 */
export const SEVERITY: Record<QueueKind, number> = { late: 100, overfill: 85, dry: 75, risk: 65, ticket: 50, work: 35 };

/** Ranked by severity, then the earliest deadline, then the title so the order never jumps about. */
export function rankQueue(items: QueueItem[]): QueueItem[] {
  return [...items].sort(
    (a, b) =>
      b.severity - a.severity ||
      (a.deadline ?? Number.POSITIVE_INFINITY) - (b.deadline ?? Number.POSITIVE_INFINITY) ||
      a.title.localeCompare(b.title),
  );
}

/** Items that count as urgent for the hero and the all-clear state. Work assigned to me is a to-do, not an alarm, unless overdue. */
export function urgentCount(items: QueueItem[]): number {
  return items.filter((i) => i.severity >= SEVERITY.ticket).length;
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

export type HeroInput = {
  lateOrders: number;
  /** Selling SKUs with no stock at all in this person's warehouses, busiest first. */
  dry: { sku: string }[];
  overfillSkus: number;
  followUpsDue: number;
  onTime: number;
  active: number;
};

export type Hero = { tone: "bad" | "warn" | "ok"; headline: string; reassurance: string };

/** The single worst thing right now, in plain language, and one line of reassurance. */
export function heroFor(i: HeroInput): Hero {
  const parts: string[] = [];
  if (i.lateOrders > 0) parts.push(`${plural(i.lateOrders, "order is", "orders are")} late`);
  if (i.dry.length === 1) parts.push(`${i.dry[0].sku} just ran dry`);
  else if (i.dry.length > 1) parts.push(`${plural(i.dry.length, "selling SKU is", "selling SKUs are")} out of stock`);
  if (parts.length === 0 && i.overfillSkus > 0) parts.push(`${plural(i.overfillSkus, "SKU has", "SKUs have")} orders waiting and no stock`);
  if (parts.length === 0 && i.followUpsDue > 0) parts.push(`${plural(i.followUpsDue, "ticket follow-up is", "ticket follow-ups are")} due`);

  const reassurance =
    i.active > 0
      ? `${i.onTime.toLocaleString("en-IN")} of ${i.active.toLocaleString("en-IN")} active orders are on time.`
      : "There are no active orders waiting right now.";

  if (parts.length === 0) {
    return { tone: "ok", headline: "You're all caught up", reassurance: i.active > 0 ? `Nothing is urgent. ${reassurance}` : "Nothing is urgent, and no orders are waiting." };
  }
  const headline = parts.length === 2 ? `${parts[0]}, and ${parts[1]}` : parts[0];
  return { tone: i.lateOrders > 0 ? "bad" : "warn", headline: headline.charAt(0).toUpperCase() + headline.slice(1), reassurance };
}

export type Health = { pct: number; tone: "ok" | "warn" | "bad"; chip: { label: string; tone: "ok" | "warn" | "bad" } };

/**
 * A warehouse's on-time health: the share of its active orders that are not late. The chip says late (red),
 * soon (amber: the next deadline is within three hours) or on time (green).
 */
export function warehouseHealth(card: { active: number; late: number; nextDue: string | null }, now: Date): Health {
  const raw = card.active > 0 ? Math.round(((card.active - Math.min(card.late, card.active)) / card.active) * 100) : 100;
  // A late order never reads as a perfect 100.
  const pct = card.late > 0 ? Math.min(raw, 99) : raw;
  const tone = pct >= 95 ? "ok" : pct >= 80 ? "warn" : "bad";
  if (card.late > 0) return { pct, tone: tone === "ok" ? "warn" : tone, chip: { label: `${card.late.toLocaleString("en-IN")} late`, tone: "bad" } };
  const soon = card.nextDue !== null && Date.parse(card.nextDue) - now.getTime() < 3 * 3_600_000;
  return { pct, tone, chip: soon ? { label: "Due soon", tone: "warn" } : { label: "On time", tone: "ok" } };
}

/** SKUs the Stock tab lists as out of stock (no units in any warehouse in scope), inactive listings included, and which are inactive. */
export type OutOfStock = ReadonlyMap<string, { inactive: boolean }>;

/** The Stock tab's out-of-stock list over every warehouse this person can see, with inactive listings kept in. */
export function outOfStock(data: DeskData): OutOfStock {
  const rows = analyze(data, data.warehouses.map((_, i) => i), false).out;
  return new Map(rows.map((r) => [r.sku, { inactive: isInactive(r.status) }]));
}

export type DrySku = { sku: string; title: string | null; disp: number; inactive: boolean };

/**
 * Selling SKUs with nothing in stock across the scope, busiest first: dispatched in the forecast window and on the Stock tab's
 * out-of-stock list. A SKU the stock sync does not record (FBF, or no longer listed) has no known stock, so it is left out rather
 * than called out of stock. `inactive` marks a listing that has gone inactive, which the Out of stock tile does not count.
 */
export function dryAndSelling(rows: { sku: string; title: string | null; disp: number }[], out: OutOfStock): DrySku[] {
  const by = new Map<string, { title: string | null; disp: number }>();
  for (const r of rows) {
    const cur = by.get(r.sku) ?? { title: r.title, disp: 0 };
    cur.disp += r.disp;
    cur.title = cur.title ?? r.title;
    by.set(r.sku, cur);
  }
  const dry: DrySku[] = [];
  for (const [sku, v] of by) {
    const o = out.get(sku);
    if (o && v.disp > 0) dry.push({ sku, title: v.title, disp: v.disp, inactive: o.inactive });
  }
  return dry.sort((a, b) => b.disp - a.disp || a.sku.localeCompare(b.sku));
}

/**
 * The line under the Out of stock tile. The tile counts active listings with no units, so only those are "of them";
 * inactive listings that still sold in the window are named apart.
 */
export function outOfStockSub(dry: Pick<DrySku, "inactive">[]): string {
  const inactive = dry.filter((d) => d.inactive).length;
  const active = dry.length - inactive;
  const parts: string[] = [];
  if (active > 0) parts.push(`${active.toLocaleString("en-IN")} of them selling`);
  if (inactive > 0) parts.push(`${plural(inactive, "inactive listing", "inactive listings")} sold recently`);
  return parts.length > 0 ? parts.join(" · ") : "active listings with no units";
}

// ---- Today's dispatch and the orders graph (from the team_order_load rows) -------------------------------------------

/** A row of team_order_load: orders placed per day (kind "placed"), or still waiting by their dispatch day ("due"). */
export type LoadRow = { kind: "placed" | "due"; day: string; warehouse_id: string | null; orders: number };

const shiftDay = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The change from `before` to `now` in percent, rounded; null when there is nothing to compare with. */
export function changePct(now: number, before: number): number | null {
  return before > 0 ? Math.round(((now - before) / before) * 100) : null;
}

export type DispatchToday = {
  /** Orders still waiting to go out today (not on hold). */
  due: number;
  /** How many warehouses have orders due today, and the one with the most. */
  warehouses: number;
  busiest: { id: string; orders: number } | null;
  /** Orders placed yesterday, and the change from the day before. */
  yesterday: number | null;
  yesterdayChange: number | null;
  /** The average of the last 7 full days, and the change from the 7 before. */
  avg7: number | null;
  avg7Change: number | null;
};

/** The Command Deck's top card: what is left to dispatch today, and how yesterday and the last week went. */
export function dispatchToday(load: LoadRow[], today: string): DispatchToday {
  const due = new Map<string, number>();
  const placed = new Map<string, number>();
  for (const r of load) {
    if (r.kind === "due" && r.day === today && r.warehouse_id) due.set(r.warehouse_id, (due.get(r.warehouse_id) ?? 0) + r.orders);
    if (r.kind === "placed") placed.set(r.day, (placed.get(r.day) ?? 0) + r.orders);
  }
  const top = [...due.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  // Days before the order history began are unknown, not zero, so nothing is compared with them.
  const earliest = [...placed.keys()].sort()[0] ?? null;
  const had = (n: number) => earliest !== null && earliest <= shiftDay(today, -n);
  const day = (n: number) => placed.get(shiftDay(today, -n)) ?? 0;
  const sum = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => day(from + i)).reduce((a, b) => a + b, 0);
  return {
    due: [...due.values()].reduce((a, b) => a + b, 0),
    warehouses: [...due.values()].filter((n) => n > 0).length,
    busiest: top && top[1] > 0 ? { id: top[0], orders: top[1] } : null,
    yesterday: had(1) ? day(1) : null,
    yesterdayChange: had(2) ? changePct(day(1), day(2)) : null,
    avg7: had(7) ? Math.round(sum(1, 7) / 7) : null,
    avg7Change: had(14) ? changePct(sum(1, 7), sum(8, 14)) : null,
  };
}

/** Orders placed per day for the last `days` full days (today is not over yet), oldest first, from where the history begins. */
export function ordersTrend(load: LoadRow[], today: string, days = 14): { day: string; orders: number }[] {
  const placed = new Map<string, number>();
  for (const r of load) if (r.kind === "placed") placed.set(r.day, (placed.get(r.day) ?? 0) + r.orders);
  const earliest = [...placed.keys()].sort()[0];
  if (!earliest) return [];
  const out: { day: string; orders: number }[] = [];
  for (let i = days; i >= 1; i--) {
    const d = shiftDay(today, -i);
    if (d >= earliest) out.push({ day: d, orders: placed.get(d) ?? 0 });
  }
  return out;
}
