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

/** Per order month and Flipkart SKU, counted as Seller Hub does (see pnl_month_units). */
export type MonthUnits = { month: string; sku: string; ordered: number; cancelled: number; custReturned: number; rto: number; soldValue: number; soldPricedUnits: number };
export type SkuFacts = { masterId: string | null; cost: number | null; price: number | null };
/**
 * units: sold (ordered less customer and courier returns). profit is before ads; net is after ads. listPricedUnits are
 * sold units with no order price saved, priced at today's listing price instead; unpricedUnits have neither.
 */
export type PnlLine = { units: number; sales: number; fees: number; cost: number; profit: number; ads: number; net: number; uncostedSales: number; unpricedUnits: number; listPricedUnits: number };
/** The month's units as Seller Hub shows them: orders (not cancelled), cancellations, customer returns, courier returns. */
export type MonthCounts = { ordered: number; cancelled: number; custReturned: number; rto: number };
export type MonthPnlData = { total: PnlLine; counts: MonthCounts; byMaster: Map<string, PnlLine> };

const emptyLine = (): PnlLine => ({ units: 0, sales: 0, fees: 0, cost: 0, profit: 0, ads: 0, net: 0, uncostedSales: 0, unpricedUnits: 0, listPricedUnits: 0 });
const emptyMonth = (): MonthPnlData => ({ total: emptyLine(), counts: { ordered: 0, cancelled: 0, custReturned: 0, rto: 0 }, byMaster: new Map() });

/**
 * Profit per month, and per master SKU within it. Units sold = ordered less customer returns and courier returns (RTO).
 * Sales = the real selling price of those orders, plus today's listing price for sold units with no order price saved.
 * Flipkart fees = sales x fee %; profit = sales - fees - cost. A SKU with no cost yet counts as costing nothing, and its
 * sales are added up in uncostedSales so the page can say the profit is too high until costs are filled in.
 */
export function monthlyPnl(rows: MonthUnits[], facts: Map<string, SkuFacts>, feePct: number): Map<string, MonthPnlData> {
  const out = new Map<string, MonthPnlData>();
  for (const r of rows) {
    const month = out.get(r.month) ?? emptyMonth();
    out.set(r.month, month);
    month.counts.ordered += r.ordered;
    month.counts.cancelled += r.cancelled;
    month.counts.custReturned += r.custReturned;
    month.counts.rto += r.rto;
    const sold = Math.max(0, r.ordered - r.custReturned - r.rto);
    if (sold === 0) continue;
    const f = facts.get(r.sku) ?? { masterId: null, cost: null, price: null };
    const key = f.masterId ?? "unlinked";
    const line = month.byMaster.get(key) ?? emptyLine();
    month.byMaster.set(key, line);
    const listUnits = Math.max(0, sold - r.soldPricedUnits);
    const sales = r.soldValue + (f.price === null ? 0 : listUnits * f.price);
    const fees = (sales * feePct) / 100;
    const cost = f.cost === null ? 0 : sold * f.cost;
    for (const l of [month.total, line]) {
      l.units += sold;
      l.sales = round2(l.sales + sales);
      l.fees = round2(l.fees + fees);
      l.cost = round2(l.cost + cost);
      l.profit = round2(l.sales - l.fees - l.cost);
      l.net = round2(l.profit - l.ads);
      if (f.cost === null) l.uncostedSales = round2(l.uncostedSales + sales);
      if (f.price === null) l.unpricedUnits += listUnits;
      else l.listPricedUnits += listUnits;
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
