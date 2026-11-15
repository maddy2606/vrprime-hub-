// Returns to claim (graphite-spec 12.2): completed Flipkart returns from the last 30 days that nobody has checked,
// with the days left to raise a claim. The database works out days_left; this file reads, counts, filters and sorts.

export type ClaimSource = "courier_return" | "customer_return";

export type ClaimRow = {
  returnId: string;
  orderItemId: string;
  orderId: string | null;
  sku: string | null;
  source: ClaimSource;
  reason: string | null;
  subReason: string | null;
  quantity: number;
  warehouseId: string | null;
  /** The day the return was completed (India time), yyyy-mm-dd. */
  returnedOn: string;
  /** return_claim_days − (today − returnedOn). Below 0: the window has closed. */
  daysLeft: number;
};

export type ClaimView = "check" | "missed";

export type ClaimFilters = { view: ClaimView; wh: string; source: "" | ClaimSource; q: string };

export const DEFAULT_CLAIM_FILTERS: ClaimFilters = { view: "check", wh: "", source: "", q: "" };

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
    if (!returnId || !orderItemId || !returnedOn || !source) continue;
    out.push({
      returnId,
      orderItemId,
      orderId: str(o.order_id),
      sku: str(o.sku),
      source,
      reason: str(o.reason),
      subReason: str(o.sub_reason),
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
    .filter((r) => !f.source || r.source === f.source)
    .filter((r) => !needle || [r.sku, r.orderId, r.returnId, r.reason, r.subReason].some((v) => v?.toLowerCase().includes(needle)))
    .sort((a, b) => a.daysLeft - b.daysLeft || a.returnedOn.localeCompare(b.returnedOn) || a.returnId.localeCompare(b.returnId));
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
