// Profit and Loss Report (Seller Hub > Payments > Reports): sheet "Orders P&L", one row per order item received in
// the period, with Flipkart's own profit figures and the payments that settled it.
//
// The header is two rows: a group row ("Total Expenses (INR)") and a row of sub-columns ("Commission Fee"). A column
// is named by the sub-column when it has one and by the group otherwise.
import { dateOf, headerListOf, indexLetter, isBlank, letterIndex, normalizeHeader, num, ReportError, round3, textOf } from "./columns.ts";
import type { SheetCells } from "./xlsx-stream.ts";

export type PnlOrder = {
  order_item_id: string;
  order_id: string | null;
  order_date: string | null;
  sku: string | null;
  fulfilment: string | null;
  status: string | null;
  gross_units: number | null;
  returned_units: number | null;
  net_units: number | null;
  order_item_value: number | null;
  fsp: number | null;
  estimated_net_sales: number | null;
  accounted_sales: number | null;
  seller_discount: number | null;
  total_expenses: number | null;
  commission: number | null;
  collection_fee: number | null;
  fixed_fee: number | null;
  pick_pack_fee: number | null;
  shipping_fee: number | null;
  reverse_shipping_fee: number | null;
  gst: number | null;
  tcs: number | null;
  tds: number | null;
  rewards: number | null;
  spf: number | null;
  bank_projected: number | null;
  itc: number | null;
  net_earnings: number | null;
  amount_settled: number | null;
  amount_pending: number | null;
  txns: [string, number][];
};

const REQUIRED = {
  order_date: "order date",
  order_id: "order id",
  order_item_id: "order item id",
  sku: "sku name",
  status: "order status",
  gross_units: "gross units",
  returned_units: "returned cancelled units",
  net_units: "net units",
  order_item_value: "order item value",
  total_expenses: "total expenses",
  bank_projected: "bank settlement projected",
  amount_settled: "amount settled",
  amount_pending: "amount pending",
  net_earnings: "net earnings",
} as const;

const OPTIONAL = {
  fulfilment: "fulfillment type",
  fsp: "final selling price fsp",
  estimated_net_sales: "estimated net sales",
  accounted_sales: "accounted net sales seller price",
  seller_discount: "seller funded discount",
  commission: "commission fee",
  collection_fee: "collection fee",
  fixed_fee: "fixed fee",
  pick_pack_fee: "pick and pack fee",
  shipping_fee: "forward shipping fee",
  reverse_shipping_fee: "reverse shipping fee",
  gst: "taxes gst",
  tcs: "taxes tcs",
  tds: "taxes tds",
  rewards: "rewards",
  spf: "spf payout",
  itc: "input tax credits",
} as const;

export type PnlColumns = {
  required: Record<keyof typeof REQUIRED, string>;
  optional: Record<keyof typeof OPTIONAL, string | null>;
  /** [amount column, NEFT ID column] for each "Transaction" block */
  txns: [string, string][];
};

/** Combines the group row and the sub-column row into one list of column names. */
export function pnlHeaderNames(group: SheetCells, sub: SheetCells): SheetCells {
  const merged: SheetCells = {};
  for (const letter of new Set([...Object.keys(group), ...Object.keys(sub)])) {
    merged[letter] = sub[letter] ?? group[letter];
  }
  return merged;
}

export function isPnlGroupRow(cells: SheetCells): boolean {
  const names = Object.values(cells).map(normalizeHeader);
  return names.includes("order item id") && names.includes("sku name");
}

export function resolvePnl(merged: SheetCells): PnlColumns {
  const list = headerListOf(merged);
  const first = new Map<string, string>();
  for (const h of list) if (!first.has(h.name)) first.set(h.name, h.letter);
  const missing = Object.values(REQUIRED).filter((name) => !first.has(name));
  if (missing.length) {
    throw new ReportError(
      `The "Orders P&L" sheet has no column called ${missing.map((m) => `"${m}"`).join(", ")}. Flipkart may have renamed it. Nothing was imported.`,
    );
  }
  const required = {} as Record<keyof typeof REQUIRED, string>;
  for (const k of Object.keys(REQUIRED) as (keyof typeof REQUIRED)[]) required[k] = first.get(REQUIRED[k]) as string;
  const optional = {} as Record<keyof typeof OPTIONAL, string | null>;
  for (const k of Object.keys(OPTIONAL) as (keyof typeof OPTIONAL)[]) optional[k] = first.get(OPTIONAL[k]) ?? null;

  // Each "Transaction Amount" column starts a block of Amount, Reason, Status, Payment Date, Account Type, NEFT ID.
  const txns: [string, string][] = [];
  for (const h of list) {
    if (h.name !== "transaction amount") continue;
    const neft = indexLetter(letterIndex(h.letter) + 5);
    if (normalizeHeader(merged[neft] ?? "") === "neft id") txns.push([h.letter, neft]);
  }
  return { required, optional, txns };
}

export function pnlOrder(cells: SheetCells, c: PnlColumns, row: number): PnlOrder | null {
  const r = c.required;
  const itemId = cells[r.order_item_id];
  if (isBlank(itemId)) return null;
  const where = (name: string) => `Orders P&L sheet, row ${row}, ${name}`;
  const n = (letter: string | null, name: string) => (letter ? num(cells[letter], where(name)) : null);
  const o = c.optional;
  const txns: [string, number][] = [];
  for (const [amountCol, neftCol] of c.txns) {
    const neft = textOf(cells[neftCol])?.trim() || null;
    const amount = num(cells[amountCol], where("Transaction Amount"));
    if (neft && amount !== null) txns.push([neft, round3(amount)]);
  }
  return {
    order_item_id: itemId,
    order_id: textOf(cells[r.order_id]),
    order_date: dateOf(cells[r.order_date], where("Order Date")),
    sku: textOf(cells[r.sku]),
    fulfilment: o.fulfilment ? textOf(cells[o.fulfilment]) : null,
    status: textOf(cells[r.status]),
    gross_units: n(r.gross_units, "Gross Units"),
    returned_units: n(r.returned_units, "Returned & Cancelled Units"),
    net_units: n(r.net_units, "Net Units"),
    order_item_value: n(r.order_item_value, "Order Item Value"),
    fsp: n(o.fsp, "Final Selling Price"),
    estimated_net_sales: n(o.estimated_net_sales, "Estimated Net Sales"),
    accounted_sales: n(o.accounted_sales, "Accounted Net Sales"),
    seller_discount: n(o.seller_discount, "Seller-Funded Discount"),
    total_expenses: n(r.total_expenses, "Total Expenses"),
    commission: n(o.commission, "Commission Fee"),
    collection_fee: n(o.collection_fee, "Collection Fee"),
    fixed_fee: n(o.fixed_fee, "Fixed Fee"),
    pick_pack_fee: n(o.pick_pack_fee, "Pick and Pack Fee"),
    shipping_fee: n(o.shipping_fee, "Forward Shipping Fee"),
    reverse_shipping_fee: n(o.reverse_shipping_fee, "Reverse Shipping Fee"),
    gst: n(o.gst, "Taxes (GST)"),
    tcs: n(o.tcs, "Taxes (TCS)"),
    tds: n(o.tds, "Taxes (TDS)"),
    rewards: n(o.rewards, "Rewards"),
    spf: n(o.spf, "SPF Payout"),
    bank_projected: n(r.bank_projected, "Bank Settlement [Projected]"),
    itc: n(o.itc, "Input Tax Credits"),
    net_earnings: n(r.net_earnings, "Net Earnings"),
    amount_settled: n(r.amount_settled, "Amount Settled"),
    amount_pending: n(r.amount_pending, "Amount Pending"),
    txns,
  };
}

export type PnlSummary = {
  orders_from: string | null;
  orders_to: string | null;
  gross_sales: number | null;
  gross_units: number | null;
  total_expenses: number | null;
  ads: number | null;
  google_ads: number | null;
  bank_settlement: number | null;
  already_paid: number | null;
  pending: number | null;
};

/** Flipkart's own totals from the "Overall Summary" sheet. */
export function readPnlSummary(rows: { cells: SheetCells }[]): PnlSummary {
  const out: PnlSummary = {
    orders_from: null, orders_to: null, gross_sales: null, gross_units: null, total_expenses: null,
    ads: null, google_ads: null, bank_settlement: null, already_paid: null, pending: null,
  };
  const clean = (s: string | undefined) => (s ?? "").replace(/^[•\s]+/, "").replace(/^&#8226;\s*/, "").trim();
  for (const { cells } of rows) {
    const label = clean(cells.A);
    const value = cells.B !== undefined ? Number(cells.B) : NaN;
    if (/^Orders Rec/i.test(label)) {
      const m = /(\d{4}-\d{2}-\d{2})\s*to\s*(\d{4}-\d{2}-\d{2})/.exec(cells.B ?? "");
      if (m) [out.orders_from, out.orders_to] = [m[1], m[2]];
    } else if (label === "Gross Sales") {
      out.gross_sales = value;
      out.gross_units = Number(cells.C);
    } else if (label === "Total Expenses") out.total_expenses = value;
    else if (label === "Ads") out.ads = value;
    else if (label === "Google Ads") out.google_ads = value;
    else if (/^Bank Settlement \(Projected\)/i.test(label) || /^Total Expected Bank Settlement/i.test(label)) out.bank_settlement = value;
    else if (/^Already Paid/i.test(label)) out.already_paid = value;
    else if (/^Pending/i.test(label)) out.pending = value;
  }
  return out;
}
