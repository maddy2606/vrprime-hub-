// Profit maths for the Money page. Plain functions over the rows the database returns.
//
// Profit = net payout + input tax credits - cost of the units kept.
//   net payout          what Flipkart paid out (Bank Settlement Value, summed over the SKU's lines)
//   input tax credits   GST + TCS + TDS you can claim back (Flipkart counts them in "Net Earnings")
//   cost                purchase + packaging + freight of units sold, minus the cost of units that came back
// Margin = profit / net revenue, where net revenue = sales - refunds. GST on your own sales is not deducted
// (Flipkart's own report does not either).

export type ProfitRowRaw = {
  sku: string;
  units_sold: number;
  units_returned: number;
  gross_sales: number;
  refunds: number;
  commission: number;
  fixed_fee: number;
  collection_fee: number;
  shipping_fee: number;
  reverse_shipping_fee: number;
  other_fees: number;
  gst_on_fees: number;
  tcs: number;
  tds: number;
  net_payout: number;
  itc: number;
  cost: number;
  cost_missing: boolean;
  orders: number;
};

export type ProfitRow = ProfitRowRaw & {
  /** gross_sales + refunds (refunds are negative) */
  revenue: number;
  netUnits: number;
  profit: number;
  profitPerUnit: number | null;
  /** null when there is no revenue, or no cost to judge by */
  margin: number | null;
};

const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};

export function readProfitRows(value: unknown): ProfitRowRaw[] {
  if (!Array.isArray(value)) return [];
  const out: ProfitRowRaw[] = [];
  for (const r of value) {
    if (typeof r !== "object" || r === null || typeof (r as { sku?: unknown }).sku !== "string") continue;
    const o = r as Record<string, unknown>;
    out.push({
      sku: o.sku as string,
      units_sold: n(o.units_sold),
      units_returned: n(o.units_returned),
      gross_sales: n(o.gross_sales),
      refunds: n(o.refunds),
      commission: n(o.commission),
      fixed_fee: n(o.fixed_fee),
      collection_fee: n(o.collection_fee),
      shipping_fee: n(o.shipping_fee),
      reverse_shipping_fee: n(o.reverse_shipping_fee),
      other_fees: n(o.other_fees),
      gst_on_fees: n(o.gst_on_fees),
      tcs: n(o.tcs),
      tds: n(o.tds),
      net_payout: n(o.net_payout),
      itc: n(o.itc),
      cost: n(o.cost),
      cost_missing: o.cost_missing === true,
      orders: n(o.orders),
    });
  }
  return out;
}

export function withProfit(r: ProfitRowRaw): ProfitRow {
  const revenue = r.gross_sales + r.refunds;
  const netUnits = r.units_sold - r.units_returned;
  const profit = r.net_payout + r.itc - r.cost;
  return {
    ...r,
    revenue,
    netUnits,
    profit,
    profitPerUnit: netUnits > 0 ? profit / netUnits : null,
    margin: revenue > 0 && !r.cost_missing ? (profit / revenue) * 100 : null,
  };
}

export type Totals = {
  units_sold: number;
  units_returned: number;
  gross_sales: number;
  refunds: number;
  fees: number;
  gst_tcs_tds: number;
  net_payout: number;
  itc: number;
  cost: number;
  profit: number;
  revenue: number;
  /** Margin over every SKU, cost missing or not (a SKU with no cost counts as cost 0). */
  margin: number | null;
  skusWithoutCost: number;
};

export function totalsOf(rows: ProfitRow[]): Totals {
  const t: Totals = {
    units_sold: 0, units_returned: 0, gross_sales: 0, refunds: 0, fees: 0, gst_tcs_tds: 0, net_payout: 0, itc: 0,
    cost: 0, profit: 0, revenue: 0, margin: null, skusWithoutCost: 0,
  };
  for (const r of rows) {
    t.units_sold += r.units_sold;
    t.units_returned += r.units_returned;
    t.gross_sales += r.gross_sales;
    t.refunds += r.refunds;
    t.fees += r.commission + r.fixed_fee + r.collection_fee + r.shipping_fee + r.reverse_shipping_fee + r.other_fees;
    t.gst_tcs_tds += r.gst_on_fees + r.tcs + r.tds;
    t.net_payout += r.net_payout;
    t.itc += r.itc;
    t.cost += r.cost;
    t.profit += r.profit;
    t.revenue += r.revenue;
    if (r.cost_missing) t.skusWithoutCost++;
  }
  t.margin = t.revenue > 0 ? (t.profit / t.revenue) * 100 : null;
  return t;
}

export type EstimateRow = {
  sku: string;
  units: number;
  price: number | null;
  fee_pct: number;
  fee_source: string;
  revenue: number;
  est_payout: number;
  cost: number;
  est_profit: number;
  cost_missing: boolean;
};

export function readEstimateRows(value: unknown): EstimateRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((r) => {
    if (typeof r !== "object" || r === null || typeof (r as { sku?: unknown }).sku !== "string") return [];
    const o = r as Record<string, unknown>;
    return [
      {
        sku: o.sku as string,
        units: n(o.units),
        price: o.price === null || o.price === undefined ? null : n(o.price),
        fee_pct: n(o.fee_pct),
        fee_source: String(o.fee_source ?? ""),
        revenue: n(o.revenue),
        est_payout: n(o.est_payout),
        cost: n(o.cost),
        est_profit: n(o.est_profit),
        cost_missing: o.cost_missing === true,
      },
    ];
  });
}

export const rupees = (v: number): string => `₹${Math.round(v).toLocaleString("en-IN")}`;
export const percent = (v: number | null): string => (v === null ? "-" : `${v.toFixed(1)}%`);
