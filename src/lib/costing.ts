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

export type MonthUnits = { month: string; sku: string; dispatched: number; returned: number };
export type SkuFacts = { masterId: string | null; cost: number | null; price: number | null };
/** profit is before ads; net is after ads (the month's ad spend, from the Flipkart Ads report). */
export type PnlLine = { units: number; sales: number; fees: number; cost: number; profit: number; ads: number; net: number; uncostedSales: number; unpricedUnits: number };

const emptyLine = (): PnlLine => ({ units: 0, sales: 0, fees: 0, cost: 0, profit: 0, ads: 0, net: 0, uncostedSales: 0, unpricedUnits: 0 });

/**
 * Profit per month, and per master SKU within it. Units sold = dispatched less returned. Sales = units x selling price;
 * Flipkart fees = sales x fee %; profit = sales - fees - cost. A SKU with no cost yet counts as costing nothing, and its
 * sales are added up in uncostedSales so the page can say the profit is too high until costs are filled in.
 */
export function monthlyPnl(rows: MonthUnits[], facts: Map<string, SkuFacts>, feePct: number): Map<string, { total: PnlLine; byMaster: Map<string, PnlLine> }> {
  const out = new Map<string, { total: PnlLine; byMaster: Map<string, PnlLine> }>();
  for (const r of rows) {
    const sold = Math.max(0, r.dispatched - r.returned);
    if (sold === 0) continue;
    const f = facts.get(r.sku) ?? { masterId: null, cost: null, price: null };
    const month = out.get(r.month) ?? { total: emptyLine(), byMaster: new Map<string, PnlLine>() };
    out.set(r.month, month);
    const key = f.masterId ?? "unlinked";
    const line = month.byMaster.get(key) ?? emptyLine();
    month.byMaster.set(key, line);
    const sales = f.price === null ? 0 : sold * f.price;
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
      if (f.price === null) l.unpricedUnits += sold;
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
export function applyAds(pnl: Map<string, { total: PnlLine; byMaster: Map<string, PnlLine> }>, ads: MonthAds[]): void {
  for (const a of ads) {
    if (!a.spend) continue;
    const month = pnl.get(a.month) ?? { total: emptyLine(), byMaster: new Map<string, PnlLine>() };
    pnl.set(a.month, month);
    const line = month.byMaster.get(a.masterKey) ?? emptyLine();
    month.byMaster.set(a.masterKey, line);
    for (const l of [month.total, line]) {
      l.ads = round2(l.ads + a.spend);
      l.net = round2(l.profit - l.ads);
    }
  }
}
