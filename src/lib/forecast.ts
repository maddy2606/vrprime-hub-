// The Forecasting tab's maths. Pure functions over the rows flipkart_forecast() returns.
//
// Basis: the DISPATCH day. History is what was dispatched, by units (not the order day, which would lump preorders
// that dispatch weeks later). Rate = units dispatched in the window / complete days in the window; the window ends
// yesterday. Forecast = rate x 1, 7 or 30, rounded. Days of cover comes from cover.ts, shared with the Stock tab.
import { daysOfCover, ratePerDay } from "./cover.ts";

export const WINDOWS = [7, 14, 30] as const;
export type Window = (typeof WINDOWS)[number];

export type ForecastRaw = {
  sku: string;
  wid: string | null;
  title: string | null;
  disp: number;
  stock: number;
};

export type ForecastMeta = {
  today: string;
  windowStart: string;
  windowEnd: string;
  /** Complete days actually used (may be fewer than asked when the history is shorter). */
  days: number;
  asked: number;
  historyFrom: string | null;
  snapshot: string | null;
};

export type ForecastRow = {
  key: string;
  sku: string;
  wid: string | null;
  title: string | null;
  stock: number;
  dispatched: number;
  /** units per day, or 0 when there is no history */
  rate: number;
  f1: number;
  f7: number;
  f30: number;
  /** stock / rate, or null when the rate is 0 */
  cover: number | null;
};

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function readForecast(value: unknown): { meta: ForecastMeta; raw: ForecastRaw[] } | null {
  if (typeof value !== "object" || value === null) return null;
  const o = value as Record<string, unknown>;
  const raw: ForecastRaw[] = [];
  for (const r of Array.isArray(o.rows) ? o.rows : []) {
    if (typeof r !== "object" || r === null || typeof (r as { sku?: unknown }).sku !== "string") continue;
    const x = r as Record<string, unknown>;
    raw.push({
      sku: x.sku as string,
      wid: typeof x.wid === "string" ? x.wid : null,
      title: typeof x.title === "string" ? x.title : null,
      disp: num(x.disp),
      stock: num(x.stock),
    });
  }
  return {
    meta: {
      today: String(o.today ?? ""),
      windowStart: String(o.window_start ?? ""),
      windowEnd: String(o.window_end ?? ""),
      days: num(o.days),
      asked: num(o.asked),
      historyFrom: typeof o.history_from === "string" ? o.history_from : null,
      snapshot: typeof o.snapshot === "string" ? o.snapshot : null,
    },
    raw,
  };
}

/** One row from sums. 100 units over 10 days: rate 10, forecasts 10 / 70 / 300. */
export function forecastRow(r: ForecastRaw, days: number): ForecastRow {
  const rate = ratePerDay(r.disp, days);
  return {
    key: `${r.sku}|${r.wid ?? ""}`,
    sku: r.sku,
    wid: r.wid,
    title: r.title,
    stock: r.stock,
    dispatched: r.disp,
    rate,
    f1: Math.round(rate),
    f7: Math.round(rate * 7),
    f30: Math.round(rate * 30),
    cover: daysOfCover(r.stock, rate),
  };
}

/** Every SKU summed over its warehouses (the must-have view), or one row per SKU and warehouse. */
export function buildRows(raw: ForecastRaw[], days: number, splitByWarehouse: boolean, onlyWarehouse: string | null = null): ForecastRow[] {
  const source = onlyWarehouse ? raw.filter((r) => r.wid === onlyWarehouse) : raw;
  if (splitByWarehouse) return source.map((r) => forecastRow(r, days));
  const sums = new Map<string, ForecastRaw>();
  for (const r of source) {
    const cur = sums.get(r.sku);
    if (!cur) {
      sums.set(r.sku, { ...r, wid: null });
    } else {
      cur.disp += r.disp;
      cur.stock += r.stock;
      cur.title ??= r.title;
    }
  }
  return [...sums.values()].map((r) => forecastRow(r, days));
}

/** "Based on 24 days of dispatch history" when the window asked for is longer than the history. */
export function historyNote(meta: ForecastMeta): string | null {
  if (meta.days === 0) return "There is no dispatch history yet, so there is nothing to forecast from.";
  return meta.days < meta.asked ? `Based on ${meta.days} days of dispatch history (you asked for ${meta.asked}).` : null;
}

export function topMovers(rows: ForecastRow[], n = 5): ForecastRow[] {
  return [...rows].sort((a, b) => b.f30 - a.f30 || b.dispatched - a.dispatched || a.sku.localeCompare(b.sku)).slice(0, n);
}

// --- By product (master) ------------------------------------------------------------------------------------------

export type MasterChild = ForecastRow & {
  /** Units of the product one order of this listing uses (a 2pc listing = 2). */
  units: number;
};

export type MasterGroup = {
  key: string;
  /** The product's name. */
  name: string;
  /** The product's Flipkart SKUs, each with its own numbers in listing units (summed over the warehouses in scope). */
  children: MasterChild[];
  /**
   * The children combined, in units of the product: each child's stock and units dispatched times its units per
   * order, summed. So the rate is the sum of the children's rates (times units per order).
   */
  total: ForecastRow;
  /** Set when the product is a kit (combo) made of other products. */
  kit?: KitInfo;
};

/** A kit (combo): a product made of other products, e.g. Car Perfume = 1 Berry + 1 Musk. */
export type KitDef = { name: string; parts: { name: string; qty: number }[] };

export type KitInfo = {
  /** The kit's own stock: its Flipkart SKUs, in product units. */
  own: number;
  /** How many kits the parts' stock makes: the smallest of (part stock / quantity), rounded down. */
  canMake: number;
  parts: { name: string; qty: number; stock: number }[];
};

/** How many kits the parts make: the part that runs out first decides. No parts, none. */
export function kitsFromParts(parts: { qty: number; stock: number }[]): number {
  if (!parts.length) return 0;
  return Math.max(0, Math.min(...parts.map((p) => Math.floor(p.stock / p.qty))));
}

/** Children combined into one row in product units; forecasts and cover from those sums. */
export function combineRows(key: string, label: string, children: MasterChild[], days: number): ForecastRow {
  const stock = children.reduce((n, c) => n + c.stock * c.units, 0);
  const dispatched = children.reduce((n, c) => n + c.dispatched * c.units, 0);
  return { ...forecastRow({ sku: label, wid: null, title: null, disp: dispatched, stock }, days), key };
}

/**
 * The Forecasting tab grouped by product. Every Flipkart SKU in the forecast is looked up (exact spelling, then any
 * case); SKUs of one product become that product's children and a combined row. Products with no Flipkart SKU in
 * the data are left out. SKUs with no product come back as `unmapped`, each its own row, so nothing is hidden.
 * SKUs in `removed` (taken out of the checks on the Master SKUs tab) are left out altogether.
 */
export function buildMasterGroups(
  raw: ForecastRaw[],
  days: number,
  masterOf: (sku: string) => { master: string; units: number } | null,
  onlyWarehouse: string | null = null,
  removed: ReadonlySet<string> = new Set(),
  kits: KitDef[] = [],
): { groups: MasterGroup[]; unmapped: ForecastRow[] } {
  const perSku = buildRows(raw.filter((r) => !removed.has(r.sku)), days, false, onlyWarehouse);
  const byMaster = new Map<string, MasterChild[]>();
  const unmapped: ForecastRow[] = [];
  for (const row of perSku) {
    const m = masterOf(row.sku);
    if (m === null) unmapped.push(row);
    else byMaster.set(m.master, [...(byMaster.get(m.master) ?? []), { ...row, units: m.units }]);
  }
  const groups = [...byMaster.entries()].map(([name, children]) => ({
    key: `m:${name}`,
    name,
    children: children.sort((a, b) => b.f30 * b.units - a.f30 * a.units || a.sku.localeCompare(b.sku)),
    total: combineRows(`m:${name}`, name, children, days),
  })) as MasterGroup[];
  if (!kits.length) return { groups, unmapped };

  // Kits: stock = own stock + what the parts make. Parts are read before any kit changes (kits are never parts).
  const stockOf = new Map(groups.map((g) => [g.name, g.total.stock]));
  for (const kit of kits) {
    const parts = kit.parts.map((p) => ({ name: p.name, qty: p.qty, stock: stockOf.get(p.name) ?? 0 }));
    const canMake = kitsFromParts(parts);
    let g = groups.find((x) => x.name === kit.name);
    if (!g) {
      g = { key: `m:${kit.name}`, name: kit.name, children: [], total: combineRows(`m:${kit.name}`, kit.name, [], days) };
      groups.push(g);
    }
    const own = g.total.stock;
    g.kit = { own, canMake, parts };
    g.total = { ...forecastRow({ sku: kit.name, wid: null, title: null, disp: g.total.dispatched, stock: own + canMake }, days), key: g.key };
  }
  return { groups, unmapped };
}
