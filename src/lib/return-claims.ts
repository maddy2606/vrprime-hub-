// Returns to claim (graphite-spec 12.2, narrowed on 16 Nov 2026): completed Flipkart returns from the last 30 days that
// may need a claim and nobody has checked, with the days left to raise it. The database picks the returns, puts each in
// a reason group and works out days_left; this file reads, counts, groups, filters and sorts.

export type ClaimSource = "courier_return" | "customer_return";

/** The reason groups, in the order the cards show. The first six can also be picked by hand ("Needs claim"). */
export const CLAIM_GROUPS = [
  { key: "wrong_item", label: "Wrong item received", hint: "Different product, brand or specs" },
  { key: "damaged", label: "Damaged", hint: "Product or accessory came back damaged" },
  { key: "missing", label: "Missing item", hint: "Product or accessory missing" },
  { key: "used", label: "Used product", hint: "Came back used" },
  { key: "empty_box", label: "Empty box", hint: "Marked by the warehouse" },
  { key: "other", label: "Other problem", hint: "Marked by the warehouse" },
  { key: "quality", label: "Quality not as expected", hint: "Customer's reason; check what came back" },
  { key: "rto_damaged", label: "RTO came back damaged", hint: "Courier return, damaged shipment" },
] as const;

export type ClaimGroup = (typeof CLAIM_GROUPS)[number]["key"];

/** What the warehouse can pick with "Needs claim" (the database accepts exactly these). */
export const FLAG_REASONS = CLAIM_GROUPS.slice(0, 6).map((g) => ({ value: g.key, label: g.label }));
export type FlagReason = (typeof FLAG_REASONS)[number]["value"];

const GROUP_KEYS = new Set<string>(CLAIM_GROUPS.map((g) => g.key));
export const isFlagReason = (v: unknown): v is FlagReason => typeof v === "string" && FLAG_REASONS.some((r) => r.value === v);
export const groupLabel = (key: ClaimGroup): string => CLAIM_GROUPS.find((g) => g.key === key)?.label ?? key;

export type ClaimRow = {
  returnId: string;
  orderItemId: string;
  orderId: string | null;
  sku: string | null;
  /** The listing title, when the SKU is a known listing. */
  title: string | null;
  source: ClaimSource;
  reason: string | null;
  subReason: string | null;
  group: ClaimGroup;
  /** Marked "Needs claim" by the warehouse (the group is what they found). */
  flagged: boolean;
  quantity: number;
  warehouseId: string | null;
  /** The day the return was completed (India time), yyyy-mm-dd. */
  returnedOn: string;
  /** return_claim_days − (today − returnedOn). Below 0: the window has closed. */
  daysLeft: number;
};

export type ClaimView = "check" | "missed";

export type ClaimFilters = { view: ClaimView; wh: string; q: string };

export const DEFAULT_CLAIM_FILTERS: ClaimFilters = { view: "check", wh: "", q: "" };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown, fallback: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};

/** Reads returns_to_claim()'s rows; anything without its keys is skipped. */
export function readClaimRows(raw: unknown): ClaimRow[] {
  if (!Array.isArray(raw)) return [];
  const out: ClaimRow[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const returnId = str(o.return_id);
    const orderItemId = str(o.order_item_id);
    const returnedOn = str(o.returned_on);
    const source = o.source === "courier_return" || o.source === "customer_return" ? o.source : null;
    const group = typeof o.claim_group === "string" && GROUP_KEYS.has(o.claim_group) ? (o.claim_group as ClaimGroup) : null;
    if (!returnId || !orderItemId || !returnedOn || !source || !group) continue;
    out.push({
      returnId,
      orderItemId,
      orderId: str(o.order_id),
      sku: str(o.sku),
      title: str(o.title),
      source,
      reason: str(o.reason),
      subReason: str(o.sub_reason),
      group,
      flagged: o.flagged === true,
      quantity: Math.max(0, Math.round(num(o.quantity, 1))),
      warehouseId: str(o.warehouse_id),
      returnedOn: returnedOn.slice(0, 10),
      daysLeft: Math.round(num(o.days_left, 0)),
    });
  }
  return out;
}

/** The KPI row: To check (0 or more days left), Closing today or tomorrow (0 or 1), Missed (below 0). */
export function claimCounts(rows: ClaimRow[]): { toCheck: number; closing: number; missed: number } {
  let toCheck = 0;
  let closing = 0;
  let missed = 0;
  for (const r of rows) {
    if (r.daysLeft < 0) missed++;
    else {
      toCheck++;
      if (r.daysLeft <= 1) closing++;
    }
  }
  return { toCheck, closing, missed };
}

/** The Days left Chip: bad at 0 or 1, warn at 2 or 3, neutral above, "Missed" (bad) below 0. */
export function daysLeftChip(daysLeft: number): { tone: "bad" | "warn" | "neutral"; label: string } {
  if (daysLeft < 0) return { tone: "bad", label: "Missed" };
  const label = daysLeft === 0 ? "Today" : daysLeft === 1 ? "1 day" : `${daysLeft} days`;
  if (daysLeft <= 1) return { tone: "bad", label };
  if (daysLeft <= 3) return { tone: "warn", label };
  return { tone: "neutral", label };
}

/** The rows for the view and filters, sorted by days left, fewest first. */
export function filterClaims(rows: ClaimRow[], f: ClaimFilters): ClaimRow[] {
  const needle = f.q.trim().toLowerCase();
  return rows
    .filter((r) => (f.view === "missed" ? r.daysLeft < 0 : r.daysLeft >= 0))
    .filter((r) => !f.wh || r.warehouseId === f.wh)
    .filter((r) => !needle || [r.sku, r.title, r.orderId, r.returnId, r.reason, r.subReason].some((v) => v?.toLowerCase().includes(needle)))
    .sort((a, b) => a.daysLeft - b.daysLeft || a.returnedOn.localeCompare(b.returnedOn) || a.returnId.localeCompare(b.returnId));
}

export type GroupSummary = { key: ClaimGroup; label: string; hint: string; returns: number; units: number; skus: number; closing: number; flagged: number };

/** One card per reason group that has returns, in CLAIM_GROUPS order. `closing`: 0 or 1 day left. */
export function groupClaims(rows: ClaimRow[]): GroupSummary[] {
  const out: GroupSummary[] = [];
  for (const g of CLAIM_GROUPS) {
    const mine = rows.filter((r) => r.group === g.key);
    if (!mine.length) continue;
    out.push({
      key: g.key,
      label: g.label,
      hint: g.hint,
      returns: mine.length,
      units: mine.reduce((n, r) => n + r.quantity, 0),
      skus: new Set(mine.map((r) => r.sku ?? "")).size,
      closing: mine.filter((r) => r.daysLeft >= 0 && r.daysLeft <= 1).length,
      flagged: mine.filter((r) => r.flagged).length,
    });
  }
  return out;
}

export type SkuSummary = { sku: string | null; title: string | null; returns: number; units: number; soonest: number; warehouseIds: string[]; rows: ClaimRow[] };

/** Every SKU in one group, most returns first (then most units, then SKU A to Z); each with its returns, fewest days
 *  left first. Returns with no SKU are one entry. */
export function skusInGroup(rows: ClaimRow[], group: ClaimGroup): SkuSummary[] {
  const by = new Map<string, ClaimRow[]>();
  for (const r of rows) {
    if (r.group !== group) continue;
    const k = r.sku ?? "";
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  return [...by.entries()]
    .map(([k, list]) => {
      const sorted = [...list].sort((a, b) => a.daysLeft - b.daysLeft || a.returnId.localeCompare(b.returnId));
      return {
        sku: k || null,
        title: list.find((r) => r.title)?.title ?? null,
        returns: list.length,
        units: list.reduce((n, r) => n + r.quantity, 0),
        soonest: sorted[0].daysLeft,
        warehouseIds: [...new Set(list.map((r) => r.warehouseId).filter((w): w is string => Boolean(w)))],
        rows: sorted,
      };
    })
    .sort((a, b) => b.returns - a.returns || b.units - a.units || Number(a.sku === null) - Number(b.sku === null) || (a.sku ?? "").localeCompare(b.sku ?? ""));
}

/** The Monday (India time) of the week holding `today` (yyyy-mm-dd): the start of "Checked this week". */
export function weekStart(today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** The new-ticket address for a return: the Returns tab's parameters plus the return and its item. */
export function claimTicketHref(sku: string | null, returnId: string, orderItemId: string): string {
  const params = new URLSearchParams({ platform: "flipkart", issue: "wrong_return" });
  if (sku) params.set("sku", sku);
  params.set("return", returnId);
  params.set("item", orderItemId);
  return `/tickets/new?${params.toString()}`;
}
