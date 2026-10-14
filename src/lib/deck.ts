// The Command Deck's logic, as plain functions (relative imports, so `node --test` can load it): how the priority queue is
// ranked, what the headline says, and how healthy a warehouse looks.

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

/** Selling SKUs with nothing in stock across the scope: from the forecast rows (units dispatched and stock per SKU per warehouse). */
export function dryAndSelling(rows: { sku: string; title: string | null; disp: number; stock: number }[]): { sku: string; title: string | null; disp: number }[] {
  const by = new Map<string, { title: string | null; disp: number; stock: number }>();
  for (const r of rows) {
    const cur = by.get(r.sku) ?? { title: r.title, disp: 0, stock: 0 };
    cur.disp += r.disp;
    cur.stock += r.stock;
    cur.title = cur.title ?? r.title;
    by.set(r.sku, cur);
  }
  return [...by.entries()]
    .filter(([, v]) => v.stock <= 0 && v.disp > 0)
    .map(([sku, v]) => ({ sku, title: v.title, disp: v.disp }))
    .sort((a, b) => b.disp - a.disp || a.sku.localeCompare(b.sku));
}
