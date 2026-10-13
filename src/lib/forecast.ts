// The Forecasting tab's maths. Pure functions over the rows flipkart_forecast() returns.
//
// Basis: the DISPATCH day. History is what was dispatched, by units (not the order day, which would lump preorders
// that dispatch weeks later). Rate = units dispatched in the window / complete days in the window; the window ends
// yesterday. Forecast = rate x 1, 7 or 30, rounded. "Booked" is a different thing: units already scheduled to
// dispatch in the next 1, 7 or 30 days. The two are never added together.

export const WINDOWS = [7, 14, 30] as const;
export type Window = (typeof WINDOWS)[number];

export type ForecastRaw = {
  sku: string;
  wid: string | null;
  title: string | null;
  disp: number;
  b1: number;
  b7: number;
  b30: number;
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
  b1: number;
  b7: number;
  b30: number;
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
      b1: num(x.b1),
      b7: num(x.b7),
      b30: num(x.b30),
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
export function forecastRow(r: { sku: string; wid: string | null; title: string | null; disp: number; b1: number; b7: number; b30: number; stock: number }, days: number): ForecastRow {
  const rate = days > 0 ? r.disp / days : 0;
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
    b1: r.b1,
    b7: r.b7,
    b30: r.b30,
    cover: rate > 0 ? r.stock / rate : null,
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
      cur.b1 += r.b1;
      cur.b7 += r.b7;
      cur.b30 += r.b30;
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
