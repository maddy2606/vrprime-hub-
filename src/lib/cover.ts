// ONE definition of "days of cover" for the whole app: the Stock tab, Forecasting and Needs action all call this.
//
//   rate  = units dispatched in the window / complete days in the window   (dispatched by DISPATCH day; see
//           flipkart_forecast in the database: the same rate the Forecasting tab uses)
//   cover = units in stock / rate, or none when nothing was dispatched
//
// Pure functions; relative imports so the tests can load them.

/** Cover needs this many complete days of dispatch history before it is trusted. */
export const COVER_HISTORY_DAYS = 7;

/** Units dispatched per day over a window of `days` complete days. */
export function ratePerDay(dispatched: number, days: number): number {
  return days > 0 && dispatched > 0 ? dispatched / days : 0;
}

/** Days the stock lasts at that rate; null when there is no rate (nothing is being dispatched). */
export function daysOfCover(units: number, rate: number): number | null {
  return rate > 0 ? Math.max(units, 0) / rate : null;
}

/** One SKU at one warehouse, as the forecast function gives it. */
export type DispatchRow = { sku: string; wid: string | null; disp: number; stock: number };

export type CoverLine = {
  sku: string;
  warehouseId: string;
  units: number;
  rate: number;
  days: number;
  source: "dispatch";
};

/** Cover per SKU and warehouse, for stock that is there and a rate that is above zero. */
export function coversPerWarehouse(rows: DispatchRow[], days: number): CoverLine[] {
  const out: CoverLine[] = [];
  for (const r of rows) {
    if (!r.wid || r.stock <= 0) continue;
    const rate = ratePerDay(r.disp, days);
    const d = daysOfCover(r.stock, rate);
    if (d !== null) out.push({ sku: r.sku, warehouseId: r.wid, units: r.stock, rate, days: d, source: "dispatch" });
  }
  return out;
}

/**
 * Cover per SKU over a set of warehouses (null = all of them): the SKU's stock in those warehouses over the units
 * they dispatched per day. This is the number the Forecasting tab shows for the same scope.
 */
export function coverBySku(rows: DispatchRow[], days: number, warehouseIds: string[] | null): Record<string, CoverLine & { warehouseId: string }> {
  const sums = new Map<string, { units: number; disp: number }>();
  for (const r of rows) {
    if (warehouseIds && (!r.wid || !warehouseIds.includes(r.wid))) continue;
    const cur = sums.get(r.sku) ?? { units: 0, disp: 0 };
    cur.units += r.stock;
    cur.disp += r.disp;
    sums.set(r.sku, cur);
  }
  const out: Record<string, CoverLine & { warehouseId: string }> = {};
  for (const [sku, s] of sums) {
    const rate = ratePerDay(s.disp, days);
    const d = daysOfCover(s.units, rate);
    if (d !== null) out[sku] = { sku, warehouseId: warehouseIds?.length === 1 ? warehouseIds[0] : "", units: s.units, rate, days: d, source: "dispatch" };
  }
  return out;
}
