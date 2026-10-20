// Costing and month-by-month profit for the P&L page, as plain functions (no imports, so `node --test` can load them).
// The owner enters what one unit of each master SKU costs; a Flipkart SKU that is a pack of 2 costs twice that, and a kit
// with no cost of its own costs the sum of its parts.

export type KitPart = { part: string; qty: number };
export type MasterInfo = { id: string; name: string; kitParts: KitPart[] };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** One unit of a master SKU: its own cost; else, for a kit, the sum of its parts (only when every part has a cost). */
export function masterUnitCost(id: string, masters: Map<string, MasterInfo>, costs: Record<string, number>): number | null {
  if (costs[id] !== undefined) return costs[id];
  const m = masters.get(id);
  if (!m || m.kitParts.length === 0) return null;
  let sum = 0;
  for (const p of m.kitParts) {
    const c = costs[p.part];
    if (c === undefined) return null;
    sum += c * p.qty;
  }
  return round2(sum);
}

/** A Flipkart SKU's cost: the master's unit cost times the units in one order (2 for a pack of 2). */
export function skuCost(unitsPerOrder: number, unitCost: number | null): number | null {
  return unitCost === null ? null : round2(unitCost * Math.max(1, unitsPerOrder));
}

/** Synced orders per order month and Flipkart SKU (see pnl_month_units). inReport: days Flipkart's P&L report covers. */
export type MonthUnits = { month: string; sku: string; inReport?: boolean; ordered: number; cancelled: number; custReturned: number; rto: number; soldValue: number; soldPricedUnits: number };
/** Flipkart's P&L report per order month and SKU: units, order value, seller price (revenue) and net earnings. */
export type ReportUnits = { month: string; sku: string; gross: number; retCanc: number; net: number; itemValue: number; sales: number; earnings: number; firstDay: string | null; lastDay: string | null };
/**
 * salesPerUnit / earnPerUnit: the SKU's seller price and net earnings per unit sold, from Flipkart's P&L report; used to
 * price orders the report does not cover yet. Without them, the order's selling price is scaled by the report-wide
 * ratio of seller price to selling price, and fees are the default estimate.
 */
export type SkuFacts = { masterId: string | null; cost: number | null; price: number | null; salesPerUnit?: number | null; earnPerUnit?: number | null };
/**
 * units: sold. sales: your revenue (Flipkart's seller price). fees: what Flipkart keeps of it (sales less net earnings).
 * profit is before ads; net is after ads. estSales: sales worked out from synced orders rather than taken from
 * Flipkart's report. itemValue: what buyers paid (Seller Hub's "sales"). listPricedUnits are sold units with no order
 * price, priced at today's listing price; unpricedUnits have neither.
 */
export type PnlLine = {
  units: number;
  sales: number;
  fees: number;
  cost: number;
  profit: number;
  ads: number;
  net: number;
  itemValue: number;
  estSales: number;
  uncostedSales: number;
  unpricedUnits: number;
  listPricedUnits: number;
};
/** The month's units: synced orders as Seller Hub counts them, and Flipkart's report where it covers. */
export type MonthCounts = { ordered: number; cancelled: number; custReturned: number; rto: number };
export type ReportCounts = { gross: number; retCanc: number; net: number; from: string | null; to: string | null };
export type MonthPnlData = { total: PnlLine; counts: MonthCounts; report: ReportCounts | null; byMaster: Map<string, PnlLine> };

const emptyLine = (): PnlLine => ({ units: 0, sales: 0, fees: 0, cost: 0, profit: 0, ads: 0, net: 0, itemValue: 0, estSales: 0, uncostedSales: 0, unpricedUnits: 0, listPricedUnits: 0 });
const emptyMonth = (): MonthPnlData => ({ total: emptyLine(), counts: { ordered: 0, cancelled: 0, custReturned: 0, rto: 0 }, report: null, byMaster: new Map() });

function add(month: MonthPnlData, key: string, units: number, sales: number, fees: number, itemValue: number, f: SkuFacts, estimated: boolean, listUnits = 0) {
  const line = month.byMaster.get(key) ?? emptyLine();
  month.byMaster.set(key, line);
  const cost = f.cost === null ? 0 : units * f.cost;
  for (const l of [month.total, line]) {
    l.units += units;
    l.sales = round2(l.sales + sales);
    l.fees = round2(l.fees + fees);
    l.cost = round2(l.cost + cost);
    l.itemValue = round2(l.itemValue + itemValue);
    l.profit = round2(l.sales - l.fees - l.cost);
    l.net = round2(l.profit - l.ads);
    if (estimated) l.estSales = round2(l.estSales + sales);
    if (f.cost === null) l.uncostedSales = round2(l.uncostedSales + sales);
    if (f.price === null) l.unpricedUnits += listUnits;
    else l.listPricedUnits += listUnits;
  }
}

/**
 * Profit per month, and per master SKU within it.
 *   Days Flipkart's P&L report covers: its own figures. Units are its net units, sales its seller price, fees what it
 *   keeps (sales less net earnings).
 *   Later days (and months with no report): synced orders. Units sold = ordered less customer and courier returns,
 *   valued at the SKU's per-unit seller price and earnings from the report; for a SKU the report never had, its
 *   selling price x the report-wide seller-price ratio, with fees at the default estimate.
 * Profit = sales - fees - product cost. A SKU with no cost yet counts as costing nothing (uncostedSales says so).
 */
export function monthlyPnl(orders: MonthUnits[], report: ReportUnits[], facts: Map<string, SkuFacts>, opts: { feePct: number; fspToSales: number }): Map<string, MonthPnlData> {
  const out = new Map<string, MonthPnlData>();
  const monthOf = (m: string) => {
    const d = out.get(m) ?? emptyMonth();
    out.set(m, d);
    return d;
  };
  const none: SkuFacts = { masterId: null, cost: null, price: null };
  for (const r of report) {
    const month = monthOf(r.month);
    const rc = (month.report ??= { gross: 0, retCanc: 0, net: 0, from: null, to: null });
    rc.gross += r.gross;
    rc.retCanc += r.retCanc;
    rc.net += r.net;
    if (r.firstDay && (!rc.from || r.firstDay < rc.from)) rc.from = r.firstDay;
    if (r.lastDay && (!rc.to || r.lastDay > rc.to)) rc.to = r.lastDay;
    const f = facts.get(r.sku) ?? none;
    add(month, f.masterId ?? "unlinked", Math.max(0, r.net), r.sales, r.sales - r.earnings, r.itemValue, f, false);
  }
  for (const r of orders) {
    const month = monthOf(r.month);
    month.counts.ordered += r.ordered;
    month.counts.cancelled += r.cancelled;
    month.counts.custReturned += r.custReturned;
    month.counts.rto += r.rto;
    if (r.inReport) continue;
    const sold = Math.max(0, r.ordered - r.custReturned - r.rto);
    if (sold === 0) continue;
    const f = facts.get(r.sku) ?? none;
    const listUnits = Math.max(0, sold - r.soldPricedUnits);
    const fspValue = r.soldValue + (f.price === null ? 0 : listUnits * f.price);
    if (f.salesPerUnit != null && f.earnPerUnit != null) {
      add(month, f.masterId ?? "unlinked", sold, sold * f.salesPerUnit, sold * (f.salesPerUnit - f.earnPerUnit), fspValue, f, true, listUnits);
    } else {
      const sales = fspValue * opts.fspToSales;
      add(month, f.masterId ?? "unlinked", sold, sales, (sales * opts.feePct) / 100, fspValue, f, true, listUnits);
    }
  }
  return out;
}

/** The SKU as written, else the same SKU in any case (how master SKU links are matched elsewhere). */
export function findSku<T>(sku: string, exact: Map<string, T>, lower: Map<string, T>): T | undefined {
  return exact.get(sku) ?? lower.get(sku.toLowerCase());
}

export type MonthAds = { month: string; masterKey: string; spend: number };

/**
 * Takes each month's ad spend off: from the month, and from the master SKU the advertised Flipkart SKU belongs to
 * ("unlinked" when it belongs to none). A month or product with ads but no sales still shows, as a loss.
 */
export function applyAds(pnl: Map<string, MonthPnlData>, ads: MonthAds[]): void {
  for (const a of ads) {
    if (!a.spend) continue;
    const month = pnl.get(a.month) ?? emptyMonth();
    pnl.set(a.month, month);
    const line = month.byMaster.get(a.masterKey) ?? emptyLine();
    month.byMaster.set(a.masterKey, line);
    for (const l of [month.total, line]) {
      l.ads = round2(l.ads + a.spend);
      l.net = round2(l.profit - l.ads);
    }
  }
}

