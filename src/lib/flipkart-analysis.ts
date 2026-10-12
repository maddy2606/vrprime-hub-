// Everything the Flipkart page works out from the data. Pure functions: no database, no React.
//
// Contents: price flags, listing health, days of cover ("running out soon"), return rates,
// pending orders by warehouse, and the "Needs action today" list built from all of them.

import { addDays, todayIST } from "./format.ts";
import { daysBetween, restockHref, type DeskListing } from "./stock-analysis.ts";

// --- Settings ---------------------------------------------------------------------------------------

export type FlipkartSettings = {
  /** An overnight drop in selling price bigger than this many percent is flagged. */
  priceDropPercent: number;
  /** A listing whose dispatch SLA is above this many days is flagged. */
  dispatchSlaDays: number;
  /** A SKU with fewer days of cover than this is "running out soon". */
  runningOutDays: number;
  /** A SKU returned above this percent of units sold (30 days) is flagged. */
  returnRatePercent: number;
};

export const DEFAULT_FLIPKART_SETTINGS: FlipkartSettings = {
  priceDropPercent: 15,
  dispatchSlaDays: 2,
  runningOutDays: 7,
  returnRatePercent: 10,
};

/** Below this many units sold in 30 days a return rate means little, so it is not flagged. */
export const MIN_SOLD_FOR_RATE = 10;

function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// --- Prices -----------------------------------------------------------------------------------------------

export type PriceChange = {
  date: string;
  oldMrp: number | null;
  newMrp: number | null;
  oldSelling: number | null;
  newSelling: number | null;
};

export type PriceFlag = "over_mrp" | "big_drop" | "missing";

export const PRICE_FLAG_LABEL: Record<PriceFlag, string> = {
  over_mrp: "Selling price at or above MRP",
  big_drop: "Big overnight drop",
  missing: "Price missing",
};

export type PriceInput = {
  sku: string;
  title: string | null;
  status: string;
  mrp: number | null;
  sellingPrice: number | null;
  /** Newest first. */
  changes: PriceChange[];
};

export type PriceRow = PriceInput & {
  discountPct: number | null;
  flags: PriceFlag[];
  lastChange: PriceChange | null;
  /** How far the selling price fell in the latest change, when that was overnight. */
  dropPct: number | null;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export function buildPriceRows(inputs: PriceInput[], settings: FlipkartSettings, snapshotDate: string): PriceRow[] {
  const overnight = addDays(snapshotDate, -1);
  return inputs.map((p) => {
    const flags: PriceFlag[] = [];
    const mrp = p.mrp !== null && p.mrp > 0 ? p.mrp : null;
    const selling = p.sellingPrice !== null && p.sellingPrice > 0 ? p.sellingPrice : null;
    if (selling === null || mrp === null) flags.push("missing");
    if (selling !== null && mrp !== null && selling >= mrp) flags.push("over_mrp");

    const last = p.changes[0] ?? null;
    let dropPct: number | null = null;
    if (last && last.date >= overnight && last.oldSelling !== null && last.oldSelling > 0 && last.newSelling !== null && last.newSelling < last.oldSelling) {
      dropPct = round1(((last.oldSelling - last.newSelling) / last.oldSelling) * 100);
      if (dropPct > settings.priceDropPercent) flags.push("big_drop");
    }
    return {
      ...p,
      discountPct: selling !== null && mrp !== null ? round1(((mrp - selling) / mrp) * 100) : null,
      flags,
      lastChange: last,
      dropPct,
    };
  });
}

// --- Listing health -----------------------------------------------------------------------------------------

export type HealthProblem = "no_size" | "no_weight" | "slow_dispatch" | "sku_space" | "no_tax";

export const HEALTH_LABEL: Record<HealthProblem, string> = {
  no_size: "Missing package size",
  no_weight: "Missing weight",
  slow_dispatch: "Slow dispatch SLA",
  sku_space: "Space in SKU",
  no_tax: "Missing HSN / tax code",
};

export const HEALTH_KEYS: HealthProblem[] = ["no_size", "no_weight", "slow_dispatch", "sku_space", "no_tax"];

export type HealthInput = {
  sku: string;
  title: string | null;
  status: string;
  packages: unknown;
  fulfillment: unknown;
  hsn: string | null;
  taxCode: string | null;
  /** False until a sync has looked at the tax fields: then HSN is unknown, not missing. */
  taxRead: boolean;
};

export type HealthRow = {
  sku: string;
  title: string | null;
  status: string;
  problems: HealthProblem[];
  dispatchSla: number | null;
  hsn: string | null;
  taxCode: string | null;
};

function positive(value: unknown): boolean {
  const n = num(value);
  return n !== null && n > 0;
}

/** True when no package has all three sizes above zero / no package has a weight above zero. */
export function packageIssues(packages: unknown): { noSize: boolean; noWeight: boolean } {
  const list = Array.isArray(packages) ? packages.filter(isObject) : [];
  const sized = list.some((p) => isObject(p.dimensions) && positive(p.dimensions.length) && positive(p.dimensions.breadth) && positive(p.dimensions.height));
  const weighed = list.some((p) => positive(p.weight));
  return { noSize: !sized, noWeight: !weighed };
}

export function dispatchSlaOf(fulfillment: unknown): number | null {
  return isObject(fulfillment) ? num(fulfillment.dispatch_sla) : null;
}

export function buildHealthRows(inputs: HealthInput[], settings: FlipkartSettings): HealthRow[] {
  const rows: HealthRow[] = [];
  for (const l of inputs) {
    const problems: HealthProblem[] = [];
    const { noSize, noWeight } = packageIssues(l.packages);
    const sla = dispatchSlaOf(l.fulfillment);
    if (noSize) problems.push("no_size");
    if (noWeight) problems.push("no_weight");
    if (sla !== null && sla > settings.dispatchSlaDays) problems.push("slow_dispatch");
    if (l.sku !== l.sku.trim()) problems.push("sku_space");
    if (l.taxRead && (!l.hsn || !l.taxCode)) problems.push("no_tax");
    if (problems.length) rows.push({ sku: l.sku, title: l.title, status: l.status, problems, dispatchSla: sla, hsn: l.hsn, taxCode: l.taxCode });
  }
  return rows;
}

// --- Days of cover ("running out soon") ------------------------------------------------------------------------

export type SalesRates = {
  /** The oldest day of shipped orders that has been read in full; sales numbers are trusted from there. */
  coverageFrom: string | null;
  rows: { sku: string; wid: string; u7: number; u14: number }[];
};

export type StockDrops = {
  firstSnapshot: string | null;
  lastSnapshot: string | null;
  rows: { sku: string; wid: string; lost7: number; days7: number; lost14: number; days14: number }[];
};

export function readSalesRates(value: unknown): SalesRates {
  const out: SalesRates = { coverageFrom: null, rows: [] };
  if (!isObject(value)) return out;
  out.coverageFrom = typeof value.coverage_from === "string" ? value.coverage_from : null;
  for (const r of Array.isArray(value.rows) ? value.rows : []) {
    if (!isObject(r) || typeof r.sku !== "string" || typeof r.wid !== "string") continue;
    out.rows.push({ sku: r.sku, wid: r.wid, u7: num(r.u7) ?? 0, u14: num(r.u14) ?? 0 });
  }
  return out;
}

export function readStockDrops(value: unknown): StockDrops {
  const out: StockDrops = { firstSnapshot: null, lastSnapshot: null, rows: [] };
  if (!isObject(value)) return out;
  out.firstSnapshot = typeof value.first_snapshot === "string" ? value.first_snapshot : null;
  out.lastSnapshot = typeof value.last_snapshot === "string" ? value.last_snapshot : null;
  for (const r of Array.isArray(value.rows) ? value.rows : []) {
    if (!isObject(r) || typeof r.sku !== "string" || typeof r.wid !== "string") continue;
    out.rows.push({ sku: r.sku, wid: r.wid, lost7: num(r.lost7) ?? 0, days7: num(r.days7) ?? 0, lost14: num(r.lost14) ?? 0, days14: num(r.days14) ?? 0 });
  }
  return out;
}

export type Cover = {
  sku: string;
  warehouseId: string;
  units: number;
  /** Units used per day. */
  rate: number;
  days: number;
  source: "orders" | "stock";
};

export type CoverState = {
  state: "ready" | "collecting";
  /** When "collecting": the day there will be enough history from stock snapshots. */
  readyOn: string | null;
  ordersReady: boolean;
  stockReady: boolean;
};

export const COVER_HISTORY_DAYS = 7;

/**
 * Days of cover per SKU and warehouse: units in stock divided by units used per day.
 * Units used per day come from real orders (the larger of the 7-day and 14-day average, so the
 * warning comes early) once 7 days of shipped orders have been read; for a SKU with no orders at
 * that warehouse they come from stock drops between daily snapshots instead (restock days left out),
 * once 7 days of snapshots exist. Until either exists nothing is flagged.
 */
export function computeCover(args: {
  listings: Pick<DeskListing, "sku" | "status" | "now">[];
  warehouses: { id: string }[];
  sales: SalesRates;
  drops: StockDrops;
  today: string;
}): { covers: Cover[]; state: CoverState } {
  const { listings, warehouses, sales, drops, today } = args;
  const ordersReady = sales.coverageFrom !== null && daysBetween(sales.coverageFrom, today) >= COVER_HISTORY_DAYS;
  const stockReady = drops.firstSnapshot !== null && daysBetween(drops.firstSnapshot, today) >= COVER_HISTORY_DAYS;
  const state: CoverState = {
    state: ordersReady || stockReady ? "ready" : "collecting",
    readyOn: drops.firstSnapshot ? addDays(drops.firstSnapshot, COVER_HISTORY_DAYS) : null,
    ordersReady,
    stockReady,
  };
  if (state.state === "collecting") return { covers: [], state };

  const salesByKey = new Map(sales.rows.map((r) => [`${r.sku}|${r.wid}`, r]));
  const dropsByKey = new Map(drops.rows.map((r) => [`${r.sku}|${r.wid}`, r]));
  const span14 = sales.coverageFrom ? Math.min(14, Math.max(COVER_HISTORY_DAYS, daysBetween(sales.coverageFrom, today))) : 14;

  const covers: Cover[] = [];
  for (const listing of listings) {
    if (listing.status !== "ACTIVE") continue;
    warehouses.forEach((w, i) => {
      const units = listing.now[i];
      if (units === null || units === undefined || units <= 0) return;
      const key = `${listing.sku}|${w.id}`;
      let rate: number | null = null;
      let source: "orders" | "stock" = "orders";

      const s = salesByKey.get(key);
      if (ordersReady && s) {
        rate = Math.max(s.u7 / 7, s.u14 / span14);
      } else if (stockReady) {
        const d = dropsByKey.get(key);
        if (d) {
          const r7 = d.days7 > 0 ? d.lost7 / d.days7 : null;
          const r14 = d.days14 > 0 ? d.lost14 / d.days14 : null;
          rate = r7 === null && r14 === null ? null : Math.max(r7 ?? 0, r14 ?? 0);
          source = "stock";
        }
      }
      if (rate === null || rate <= 0) return;
      covers.push({ sku: listing.sku, warehouseId: w.id, units, rate, days: units / rate, source });
    });
  }
  return { covers, state };
}

/** The soonest-to-run-out warehouse per SKU, as a plain object (it crosses from server to browser). */
export function soonestBySku(covers: Cover[]): Record<string, Cover> {
  const out: Record<string, Cover> = {};
  for (const c of covers) {
    const current = out[c.sku];
    if (!current || c.days < current.days) out[c.sku] = c;
  }
  return out;
}

export function formatDays(days: number): string {
  if (days < 1) return "<1";
  return days < 10 ? String(Math.round(days * 10) / 10) : String(Math.round(days));
}

// --- Return rates -----------------------------------------------------------------------------------------------

export type ReturnRate = {
  sku: string;
  sold: number;
  returned: number;
  /** null when order history does not cover the 30 days yet, or nothing was sold. */
  ratePct: number | null;
  flagged: boolean;
};

export function buildReturnRates(value: unknown, settings: FlipkartSettings, historyReady: boolean): ReturnRate[] {
  const rows: ReturnRate[] = [];
  for (const r of Array.isArray(value) ? value : []) {
    if (!isObject(r) || typeof r.sku !== "string") continue;
    const sold = num(r.sold) ?? 0;
    const returned = num(r.returned) ?? 0;
    const ratePct = historyReady && sold > 0 ? round1((returned / sold) * 100) : null;
    rows.push({ sku: r.sku, sold, returned, ratePct, flagged: ratePct !== null && sold >= MIN_SOLD_FOR_RATE && ratePct > settings.returnRatePercent });
  }
  return rows;
}

/** 30 days of shipped orders are in: the backfill has read back to 29 days ago. */
export function returnHistoryReady(coverageFrom: string | null, today: string): boolean {
  return coverageFrom !== null && daysBetween(coverageFrom, today) >= 29;
}

// --- Pending orders -----------------------------------------------------------------------------------------------

export type PendingOrder = {
  orderItemId: string;
  orderId: string;
  sku: string | null;
  quantity: number;
  warehouseId: string | null;
  status: string | null;
  hold: boolean;
  /** An instant (ISO text). */
  dispatchBy: string | null;
};

export type StatusGroup = "new" | "packed" | "ready" | "other";

export const STATUS_GROUP_LABEL: Record<StatusGroup, string> = {
  new: "New",
  packed: "Packed",
  ready: "Ready to dispatch",
  other: "Other",
};

export function statusGroup(status: string | null): StatusGroup {
  switch ((status ?? "").toUpperCase()) {
    case "APPROVED":
      return "new";
    case "PACKING_IN_PROGRESS":
    case "PACKED":
      return "packed";
    case "READY_TO_DISPATCH":
      return "ready";
    default:
      return "other";
  }
}

export type Urgency = "late" | "today" | "tomorrow" | "later" | "none";

/** Late: the deadline has passed. Today / tomorrow: the deadline's day in IST. */
export function urgency(dispatchBy: string | null, now: Date): Urgency {
  if (!dispatchBy) return "none";
  const at = new Date(dispatchBy);
  if (Number.isNaN(at.getTime())) return "none";
  if (at.getTime() < now.getTime()) return "late";
  const today = todayIST(now);
  const day = todayIST(at);
  if (day === today) return "today";
  if (day === addDays(today, 1)) return "tomorrow";
  return "later";
}

/** Red on screen: past or due today. */
export function isRed(u: Urgency): boolean {
  return u === "late" || u === "today";
}

export type WarehouseOrders = {
  warehouseId: string | null;
  name: string;
  new: number;
  packed: number;
  ready: number;
  other: number;
  total: number;
  held: number;
  late: number;
  today: number;
  tomorrow: number;
  /** The earliest deadline among orders that are not on hold. */
  nextDue: string | null;
};

/** Counts of orders (not items) per warehouse. Orders on hold are counted apart: they are not at risk. */
export function ordersByWarehouse(orders: PendingOrder[], warehouses: { id: string; name: string }[], now: Date): WarehouseOrders[] {
  const make = (warehouseId: string | null, name: string): WarehouseOrders => ({
    warehouseId, name, new: 0, packed: 0, ready: 0, other: 0, total: 0, held: 0, late: 0, today: 0, tomorrow: 0, nextDue: null,
  });
  const byId = new Map<string | null, WarehouseOrders>();
  for (const w of warehouses) byId.set(w.id, make(w.id, w.name));
  const seen = new Set<string>();
  for (const o of orders) {
    const key = o.warehouseId && byId.has(o.warehouseId) ? o.warehouseId : null;
    if (!byId.has(key)) byId.set(key, make(null, "Unknown warehouse"));
    const row = byId.get(key) as WarehouseOrders;
    const orderKey = `${key}|${o.orderId}`;
    if (seen.has(orderKey)) {
      if (!o.hold && o.dispatchBy && (row.nextDue === null || o.dispatchBy < row.nextDue)) row.nextDue = o.dispatchBy;
      continue;
    }
    seen.add(orderKey);
    row.total += 1;
    if (o.hold) {
      row.held += 1;
      continue;
    }
    row[statusGroup(o.status)] += 1;
    const u = urgency(o.dispatchBy, now);
    if (u === "late") row.late += 1;
    else if (u === "today") row.today += 1;
    else if (u === "tomorrow") row.tomorrow += 1;
    if (o.dispatchBy && (row.nextDue === null || o.dispatchBy < row.nextDue)) row.nextDue = o.dispatchBy;
  }
  return [...byId.values()].filter((w) => w.warehouseId !== null || w.total > 0);
}

// --- Needs action today ------------------------------------------------------------------------------------------------

export type ActionLink = { label: string; href: string; external?: boolean };

export type ActionRow = {
  key: string;
  title: string;
  detail: string;
  tone: "bad" | "warn" | "info";
  actions: ActionLink[];
};

export type ActionSection = {
  key: "orders" | "empty" | "prices" | "inactive" | "returns" | "running";
  title: string;
  rows: ActionRow[];
};

export type NeedsInput = {
  now: Date;
  /** Owner, manager and listing see prices, listing problems and new inactive listings; warehouse users do not. */
  staff: boolean;
  warehouses: { id: string; name: string }[];
  /** Pending orders (not on hold are the ones at risk). */
  orders: PendingOrder[];
  /** Stock listings with units per warehouse, in the order of `warehouses`. */
  listings: DeskListing[];
  settings: FlipkartSettings & { newInactiveDays: number };
  priceRows: PriceRow[];
  returnRates: ReturnRate[];
  covers: Cover[];
  newInactive: DeskListing[];
};

export function ticketHref(sku: string | null, issue: "wrong_return" | "listing_blocked" | "other" = "other"): string {
  const params = new URLSearchParams({ platform: "flipkart", issue });
  if (sku) params.set("sku", sku);
  return `/tickets/new?${params.toString()}`;
}

export function buildNeedsAction(input: NeedsInput, links: { sellerHubOrders: string; sellerHubListings: string }): ActionSection[] {
  const { now, warehouses, orders, listings, settings } = input;
  const sections: ActionSection[] = [];
  const nameOf = (id: string | null) => warehouses.find((w) => w.id === id)?.name ?? "Unknown warehouse";
  const hub = (label: string, href: string): ActionLink => ({ label, href, external: true });

  // 1. Orders that will miss their dispatch deadline today or tomorrow, most urgent first.
  const perWarehouse = ordersByWarehouse(orders, warehouses, now)
    .filter((w) => w.late + w.today + w.tomorrow > 0)
    .sort((a, b) => (a.nextDue ?? "9").localeCompare(b.nextDue ?? "9"));
  if (perWarehouse.length) {
    sections.push({
      key: "orders",
      title: "Orders about to miss dispatch",
      rows: perWarehouse.map((w) => {
        const parts = [w.late ? `${w.late} late` : null, w.today ? `${w.today} due today` : null, w.tomorrow ? `${w.tomorrow} due tomorrow` : null].filter(Boolean);
        return {
          key: `orders-${w.warehouseId ?? "unknown"}`,
          title: `${w.name}: ${parts.join(", ")}`,
          detail: w.nextDue ? `Earliest deadline ${w.late ? "was " : ""}${formatDue(w.nextDue, now)}` : "",
          tone: w.late || w.today ? "bad" : "warn",
          actions: [
            { label: "View orders", href: `/flipkart?tab=orders${w.warehouseId ? `&wh=${w.warehouseId}` : ""}` },
            hub("Open in Seller Hub", links.sellerHubOrders),
          ],
        };
      }),
    });
  }

  // 2. A SKU that is empty at a warehouse that has orders waiting for it.
  const waiting = new Map<string, { sku: string; warehouseId: string; orders: Set<string>; units: number }>();
  for (const o of orders) {
    if (!o.sku || !o.warehouseId || o.hold) continue;
    const key = `${o.sku}|${o.warehouseId}`;
    const entry = waiting.get(key) ?? { sku: o.sku, warehouseId: o.warehouseId, orders: new Set<string>(), units: 0 };
    entry.orders.add(o.orderId);
    entry.units += o.quantity;
    waiting.set(key, entry);
  }
  const listingBySku = new Map(listings.map((l) => [l.sku, l]));
  const empties = [...waiting.values()]
    .filter((w) => {
      const l = listingBySku.get(w.sku);
      const i = warehouses.findIndex((x) => x.id === w.warehouseId);
      return l !== undefined && i >= 0 && l.now[i] === 0;
    })
    .sort((a, b) => b.orders.size - a.orders.size || a.sku.localeCompare(b.sku));
  if (empties.length) {
    sections.push({
      key: "empty",
      title: "Empty where orders are waiting",
      rows: empties.map((w) => ({
        key: `empty-${w.sku}-${w.warehouseId}`,
        title: w.sku,
        detail: `0 units at ${nameOf(w.warehouseId)}, ${w.orders.size} ${w.orders.size === 1 ? "order" : "orders"} waiting (${w.units} ${w.units === 1 ? "unit" : "units"})`,
        tone: "bad",
        actions: [{ label: "+ Restock", href: restockHref(w.sku, w.warehouseId) }, { label: "Raise ticket", href: ticketHref(w.sku) }],
      })),
    });
  }

  if (input.staff) {
    // 3. Price errors.
    const priceProblems = input.priceRows.filter((p) => p.status === "ACTIVE" && p.flags.length > 0);
    if (priceProblems.length) {
      sections.push({
        key: "prices",
        title: "Price errors",
        rows: priceProblems
          .sort((a, b) => b.flags.length - a.flags.length || a.sku.localeCompare(b.sku))
          .map((p) => ({
            key: `price-${p.sku}`,
            title: p.sku,
            detail: p.flags
              .map((f) => (f === "big_drop" ? `selling price fell ${p.dropPct}% overnight` : f === "over_mrp" ? `selling price ${p.sellingPrice} is not below MRP ${p.mrp}` : "price missing"))
              .join("; "),
            tone: p.flags.includes("missing") || p.flags.includes("big_drop") ? "bad" : "warn",
            actions: [hub("Open in Seller Hub", links.sellerHubListings), { label: "Raise ticket", href: ticketHref(p.sku) }],
          })),
      });
    }

    // 4. New inactive listings.
    if (input.newInactive.length) {
      sections.push({
        key: "inactive",
        title: "New inactive listings",
        rows: input.newInactive.map((l) => ({
          key: `inactive-${l.sku}`,
          title: l.sku,
          detail: `Went inactive ${l.inactiveSince ?? ""}`.trim(),
          tone: "bad",
          actions: [{ label: "Raise ticket", href: ticketHref(l.sku, "listing_blocked") }, hub("Open in Seller Hub", links.sellerHubListings)],
        })),
      });
    }
  }

  // 5. High return rate.
  const high = input.returnRates.filter((r) => r.flagged).sort((a, b) => (b.ratePct ?? 0) - (a.ratePct ?? 0));
  if (high.length) {
    sections.push({
      key: "returns",
      title: "High return rate",
      rows: high.map((r) => ({
        key: `rate-${r.sku}`,
        title: r.sku,
        detail: `${r.ratePct}% returned: ${r.returned} of ${r.sold} units in 30 days`,
        tone: "warn",
        actions: [{ label: "Raise ticket", href: ticketHref(r.sku, "wrong_return") }, ...(input.staff ? [hub("Open in Seller Hub", links.sellerHubListings)] : [])],
      })),
    });
  }

  // 6. Running out soon.
  const soon = input.covers.filter((c) => c.days < settings.runningOutDays).sort((a, b) => a.days - b.days);
  if (soon.length) {
    sections.push({
      key: "running",
      title: "Running out soon",
      rows: soon.map((c) => ({
        key: `run-${c.sku}-${c.warehouseId}`,
        title: c.sku,
        detail: `${formatDays(c.days)} ${c.days <= 1 ? "day" : "days"} left at ${nameOf(c.warehouseId)}: ${c.units} units, using ${Math.round(c.rate * 10) / 10} a day (from ${c.source === "orders" ? "orders" : "stock drops"})`,
        tone: c.days < 3 ? "bad" : "warn",
        actions: [{ label: "+ Restock", href: restockHref(c.sku, c.warehouseId) }],
      })),
    });
  }

  return sections;
}

/** "today 4:30 pm" / "tomorrow 11:00 am" / "12 Oct, 4:30 pm", in IST. */
export function formatDue(iso: string, now: Date): string {
  const at = new Date(iso);
  const time = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).format(at);
  const day = todayIST(at);
  const today = todayIST(now);
  if (day === today) return `today ${time}`;
  if (day === addDays(today, 1)) return `tomorrow ${time}`;
  if (day === addDays(today, -1)) return `yesterday ${time}`;
  const label = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }).format(at);
  return `${label}, ${time}`;
}
