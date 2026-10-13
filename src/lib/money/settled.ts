// Settled Transactions report (Seller Hub > Payments > Reports): the "Orders" sheet is one row per order item per
// payment; the other sheets (ads, storage, SPF, fines ...) are kept in their own table.
//
// No buyer personal data is read: only money, SKU, order and payment IDs and dates, and package details.
import { dateOf, headerMapOf, isBlank, normalizeHeader, num, num0, ReportError, resolveColumns, round3, textOf, type HeaderMap } from "./columns.ts";
import type { SheetRow } from "./xlsx-stream.ts";

export type SettledLine = {
  key: string;
  neft_id: string;
  neft_type: string | null;
  payment_date: string;
  order_id: string | null;
  order_item_id: string;
  sku: string | null;
  order_date: string | null;
  dispatch_date: string | null;
  qty: number | null;
  fulfilment: string | null;
  return_type: string | null;
  invoice_id: string | null;
  sale_amount: number;
  offer_amount: number;
  refund: number;
  addons: number;
  mp_fee: number;
  taxes: number;
  offer_adj: number;
  protection_fund: number;
  commission_rate: number | null;
  commission: number;
  fixed_fee: number;
  collection_fee: number;
  pick_pack_fee: number;
  shipping_fee: number;
  reverse_shipping_fee: number;
  other_fees: number;
  gst_on_fees: number;
  tcs: number;
  tds: number;
  net: number;
  itc_gst_tcs: number;
  itc_tds: number;
  dead_weight: number | null;
  vol_weight: number | null;
  weight_source: string | null;
  weight_type: string | null;
  weight_slab: string | null;
  zone: string | null;
  lbh: string | null;
  extra: Record<string, number> | null;
};

export const SETTLED_REQUIRED = {
  neft_id: "neft id",
  payment_date: "payment date",
  net: "bank settlement value",
  order_id: "order id",
  order_item_id: "order item id",
  sale_amount: "sale amount",
  mp_fee: "marketplace fee",
  taxes: "taxes",
  refund: "refund",
  commission: "commission",
  fixed_fee: "fixed fee",
  collection_fee: "collection fee",
  shipping_fee: "shipping fee",
  reverse_shipping_fee: "reverse shipping fee",
  gst_on_fees: "gst on mp fees",
  tcs: "tcs",
  tds: "tds",
  sku: "seller sku",
  qty: "quantity",
  order_date: "order date",
} as const;

export const SETTLED_OPTIONAL = {
  neft_type: "neft type",
  offer_amount: "total offer amount",
  addons: "customer add ons amount",
  offer_adj: "offer adjustments",
  protection_fund: "protection fund",
  commission_rate: "commission rate",
  pick_pack_fee: "pick and pack fee",
  itc_gst_tcs: "input gst tcs credits",
  itc_tds: "income tax credits",
  dead_weight: "dead weight",
  vol_weight: "volumetric weight",
  weight_source: "chargeable weight source",
  weight_type: "chargeable weight type",
  weight_slab: "chargeable wt slab",
  zone: "shipping zone",
  lbh: "length breadth height",
  dispatch_date: "dispatch date",
  fulfilment: "fulfilment type",
  return_type: "return type",
  invoice_id: "invoice id",
} as const;

/** Fee columns that are folded into "other fees" and kept by name in `extra` when they are not zero. */
const EXTRA_FEES = [
  "no cost emi fee reimbursement",
  "installation fee",
  "tech visit fee",
  "uninstallation packaging fee",
  "customer add ons amount recovery",
  "franchise fee",
  "shopsy marketing fee",
  "product cancellation fee",
] as const;

export type SettledColumns = ReturnType<typeof resolveSettled>;

export function resolveSettled(map: HeaderMap) {
  const cols = resolveColumns(map, "Orders", SETTLED_REQUIRED, SETTLED_OPTIONAL);
  const extra = EXTRA_FEES.flatMap((name) => {
    const letter = map.get(name);
    return letter ? [{ name, letter }] : [];
  });
  return { ...cols, extra, hasWeight: cols.optional.weight_slab !== null };
}

/** Finds the header row of the Orders sheet: the first of the top rows that has an "Order item ID" column. */
export function isSettledHeader(cells: Record<string, string>): boolean {
  const names = Object.values(cells).map(normalizeHeader);
  return names.includes("order item id") && names.includes("bank settlement value");
}

/** Counts how many times the same key was seen in one file so that identical lines are all kept. */
export class KeyCounter {
  private seen = new Map<string, number>();
  next(base: string): string {
    const n = (this.seen.get(base) ?? 0) + 1;
    this.seen.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
  }
}

/**
 * One data row to a line, or null for a row that is not a transaction (a sub-header, a blank).
 *
 * Dedupe key: NEFT ID + order item ID + invoice ID + sale amount + refund + bank settlement value. In both real
 * reports this is unique per row, and the same line seen in an overlapping report or in the same file twice gives
 * the same key. Lines that are truly identical inside one file are kept apart by a counter.
 */
export function settledLine(cells: Record<string, string>, c: SettledColumns, keys: KeyCounter, row: number): SettledLine | null {
  const r = c.required;
  const o = c.optional;
  const itemId = cells[r.order_item_id];
  // NEFT IDs come with a trailing space in the real reports: trim them (SKUs are never trimmed).
  const neft = cells[r.neft_id]?.trim();
  if (isBlank(itemId) && isBlank(neft)) return null;
  const where = (col: string) => `Orders sheet, row ${row}, ${col}`;
  if (isBlank(itemId)) throw new ReportError(`Orders sheet, row ${row} has a payment but no order item ID.`);
  if (isBlank(neft)) throw new ReportError(`Orders sheet, row ${row} has no NEFT ID.`);
  const payment = dateOf(cells[r.payment_date], where("Payment Date"));
  if (!payment) throw new ReportError(`Orders sheet, row ${row} has no payment date.`);

  const n0 = (letter: string | null, name: string) => (letter ? num0(cells[letter], where(name)) : 0);
  const sale = num0(cells[r.sale_amount], where("Sale Amount"));
  const refund = num0(cells[r.refund], where("Refund"));
  const net = num0(cells[r.net], where("Bank Settlement Value"));
  const commission = num0(cells[r.commission], where("Commission"));
  const fixed = num0(cells[r.fixed_fee], where("Fixed Fee"));
  const collection = num0(cells[r.collection_fee], where("Collection Fee"));
  const shipping = num0(cells[r.shipping_fee], where("Shipping Fee"));
  const reverse = num0(cells[r.reverse_shipping_fee], where("Reverse Shipping Fee"));
  const pick = n0(o.pick_pack_fee, "Pick And Pack Fee");
  const mp = num0(cells[r.mp_fee], where("Marketplace Fee"));
  const other = round3(mp - (commission + fixed + collection + pick + shipping + reverse));

  let extra: Record<string, number> | null = null;
  for (const e of c.extra) {
    const v = num(cells[e.letter], where(e.name));
    if (v) (extra ??= {})[e.name] = v;
  }

  const invoice = o.invoice_id ? textOf(cells[o.invoice_id]) : null;
  const key = keys.next([neft, itemId, invoice ?? "", sale, refund, net].join("|"));
  const slab = o.weight_slab ? textOf(cells[o.weight_slab]) : null;

  return {
    key,
    neft_id: neft,
    neft_type: o.neft_type ? textOf(cells[o.neft_type]) : null,
    payment_date: payment,
    order_id: textOf(cells[r.order_id]),
    order_item_id: itemId,
    sku: textOf(cells[r.sku]),
    order_date: dateOf(cells[r.order_date], where("Order Date")),
    dispatch_date: o.dispatch_date ? dateOf(cells[o.dispatch_date], where("Dispatch Date")) : null,
    qty: (() => {
      const q = num(cells[r.qty], where("Quantity"));
      return q === null ? null : Math.round(q);
    })(),
    fulfilment: o.fulfilment ? textOf(cells[o.fulfilment]) : null,
    return_type: o.return_type ? textOf(cells[o.return_type]) : null,
    invoice_id: invoice,
    sale_amount: sale,
    offer_amount: n0(o.offer_amount, "Total Offer Amount"),
    refund,
    addons: n0(o.addons, "Customer Add-ons Amount"),
    mp_fee: mp,
    taxes: num0(cells[r.taxes], where("Taxes")),
    offer_adj: n0(o.offer_adj, "Offer Adjustments"),
    protection_fund: n0(o.protection_fund, "Protection Fund"),
    commission_rate: o.commission_rate ? num(cells[o.commission_rate], where("Commission Rate")) : null,
    commission,
    fixed_fee: fixed,
    collection_fee: collection,
    pick_pack_fee: pick,
    shipping_fee: shipping,
    reverse_shipping_fee: reverse,
    other_fees: other,
    gst_on_fees: num0(cells[r.gst_on_fees], where("GST on MP Fees")),
    tcs: num0(cells[r.tcs], where("TCS")),
    tds: num0(cells[r.tds], where("TDS")),
    net,
    itc_gst_tcs: n0(o.itc_gst_tcs, "Input GST + TCS Credits"),
    itc_tds: n0(o.itc_tds, "Income Tax Credits"),
    dead_weight: o.dead_weight ? num(cells[o.dead_weight], where("Dead Weight")) : null,
    vol_weight: o.vol_weight ? num(cells[o.vol_weight], where("Volumetric Weight")) : null,
    weight_source: o.weight_source ? textOf(cells[o.weight_source]) : null,
    weight_type: o.weight_type ? textOf(cells[o.weight_type]) : null,
    weight_slab: slab,
    zone: o.zone ? textOf(cells[o.zone]) : null,
    lbh: o.lbh ? textOf(cells[o.lbh]) : null,
    extra,
  };
}

// --- The other sheets --------------------------------------------------------------------------------------

export type OtherLine = {
  key: string;
  kind: string;
  neft_id: string | null;
  payment_date: string | null;
  sku: string | null;
  ref: string | null;
  ref_date: string | null;
  amount: number;
  expense: number;
  gst: number;
  extra: Record<string, string | number> | null;
};

type OtherSheet = {
  sheet: string;
  kind: (cells: Record<string, string>, cols: Record<string, string>) => string;
  /** normalized header name for each field this sheet can give */
  fields: Record<string, string>;
  required: string[];
  /** expense, gst and reference from the row */
  map: (v: (field: string) => string | undefined, d: (field: string) => string | null, n: (field: string) => number) => {
    expense: number;
    gst: number;
    ref: string | null;
    ref_date: string | null;
    sku: string | null;
    extra: Record<string, string | number> | null;
  };
};

const SERVICE_FIELDS = {
  neft: "neft id",
  date: "payment date",
  settlement: "settlement value",
  name: "service name",
  details: "service details",
  order: "service order id",
  purchased: "purchase date",
  total: "total amount",
  gst: "gst on service amount",
};

function serviceSheet(sheet: string, kind: string): OtherSheet {
  return {
    sheet,
    kind: () => kind,
    fields: SERVICE_FIELDS,
    required: ["neft", "date", "settlement"],
    map: (v, d, n) => ({
      expense: n("total") || n("settlement"),
      gst: n("gst"),
      ref: v("order") ?? null,
      ref_date: d("purchased"),
      sku: null,
      extra: v("name") || v("details") ? { name: v("name") ?? "", details: v("details") ?? "" } : null,
    }),
  };
}

export const OTHER_SHEETS: OtherSheet[] = [
  {
    sheet: "Ads",
    kind: () => "ads",
    fields: {
      neft: "neft id", date: "payment date", settlement: "settlement value", type: "type",
      ref: "campaign transaction id", redeem: "wallet redeem", reversal: "wallet redeem reversal", topup: "wallet topup",
      refund: "wallet refund", gst: "gst on ads fees",
    },
    required: ["neft", "date", "settlement"],
    // Ads cost what was redeemed from the wallet (minus reversals) plus GST. A top-up only moves cash into the wallet.
    map: (v, d, n) => ({
      expense: round3(n("redeem") + n("reversal") + n("gst")),
      gst: n("gst"),
      ref: v("ref") ?? null,
      ref_date: null,
      sku: null,
      extra: { type: v("type") ?? "", topup: n("topup"), refund: n("refund") },
    }),
  },
  serviceSheet("Google Ads Services", "google_ads"),
  serviceSheet("Value Added Services", "value_added"),
  serviceSheet("Support Services Services", "support_services"),
  serviceSheet("Review Accelerator Services", "review_accelerator"),
  serviceSheet("Insight Subscription Services", "insight_subscription"),
  {
    sheet: "Fines",
    kind: () => "fines",
    fields: {
      neft: "neft id", date: "payment date", settlement: "settlement value", name: "transaction name",
      details: "transaction details", ref: "transaction id", when: "transaction date", total: "total amount", gst: "gst on amount",
    },
    required: ["neft", "date", "settlement"],
    map: (v, d, n) => ({ expense: n("total") || n("settlement"), gst: n("gst"), ref: v("ref") ?? null, ref_date: d("when"), sku: null, extra: v("details") ? { details: v("details") ?? "" } : null }),
  },
  {
    sheet: "Storage_Recall",
    kind: (cells, cols) => (/recall/i.test(cells[cols.name] ?? "") ? "recall" : "storage"),
    fields: { neft: "neft id", date: "payment date", settlement: "settlement value", name: "service name", ref: "listing id", recall: "recall id", fsn: "fsn" },
    required: ["neft", "date", "settlement"],
    map: (v, d, n) => ({ expense: n("settlement"), gst: 0, ref: v("recall") ?? v("ref") ?? null, ref_date: null, sku: null, extra: v("fsn") ? { fsn: v("fsn") ?? "" } : null }),
  },
  {
    sheet: "Non_Order_SPF",
    kind: () => "spf_non_order",
    fields: { neft: "neft id", date: "payment date", settlement: "settlement value", ref: "claim id", reason: "protection reason", sku: "seller sku" },
    required: ["neft", "date", "settlement"],
    map: (v, d, n) => ({ expense: n("settlement"), gst: 0, ref: v("ref") ?? null, ref_date: null, sku: v("sku") ?? null, extra: v("reason") ? { reason: v("reason") ?? "" } : null }),
  },
  {
    sheet: "MP Fee Rebate",
    kind: () => "mp_rebate",
    fields: { neft: "neft id", date: "payment date", settlement: "settlement value", sku: "sku", item: "order item id", when: "rebate processing date" },
    required: ["neft", "date", "settlement"],
    map: (v, d, n) => ({ expense: n("settlement"), gst: 0, ref: v("item") ?? null, ref_date: d("when"), sku: v("sku") ?? null, extra: null }),
  },
  {
    sheet: "TDS",
    kind: () => "tds_claim",
    fields: { neft: "neft id", date: "payment date", settlement: "settlement value", ref: "id", when: "claim date" },
    required: ["neft", "date", "settlement"],
    map: (v, d, n) => ({ expense: n("settlement"), gst: 0, ref: v("ref") ?? null, ref_date: d("when"), sku: null, extra: null }),
  },
  {
    sheet: "TCS_Recovery",
    kind: () => "tcs_recovery",
    fields: { neft: "neft id", settlement: "settlement value", ref: "service order id", when: "purchase date" },
    required: ["neft", "settlement"],
    map: (v, d, n) => ({ expense: n("settlement"), gst: 0, ref: v("ref") ?? null, ref_date: d("when"), sku: null, extra: null }),
  },
];

export const OTHER_SHEET_NAMES = new Set(OTHER_SHEETS.map((s) => s.sheet));

/** Reads one non-order sheet row by row. Create one per sheet; feed it every row of that sheet. */
export class OtherSheetReader {
  private readonly spec: OtherSheet;
  private cols: Record<string, string> | null = null;
  private readonly keys = new KeyCounter();
  constructor(spec: OtherSheet) {
    this.spec = spec;
  }

  /** The line for a row, or null (header rows, blanks). */
  read(row: SheetRow): OtherLine | null {
    const { cells } = row;
    if (!this.cols) {
      // The header is the first row with a "NEFT ID" cell.
      const map = headerMapOf(cells);
      if (!map.has("neft id")) return null;
      const cols: Record<string, string> = {};
      const missing: string[] = [];
      for (const [field, name] of Object.entries(this.spec.fields)) {
        const letter = map.get(name);
        if (letter) cols[field] = letter;
        else if (this.spec.required.includes(field)) missing.push(name);
      }
      if (missing.length) {
        throw new ReportError(`The "${this.spec.sheet}" sheet has no column called ${missing.map((m) => `"${m}"`).join(", ")}. Nothing was imported.`);
      }
      this.cols = cols;
      return null;
    }
    const cols = this.cols;
    const get = (field: string) => (cols[field] ? (isBlank(cells[cols[field]]) ? undefined : cells[cols[field]]) : undefined);
    const neft = get("neft")?.trim() || undefined;
    if (!neft && isBlank(cells[cols.settlement])) return null;
    const where = (field: string) => `${this.spec.sheet} sheet, row ${row.row}, ${this.spec.fields[field]}`;
    const n = (field: string) => (cols[field] ? num0(cells[cols[field]], where(field)) : 0);
    const d = (field: string) => (cols[field] ? dateOf(cells[cols[field]], where(field)) : null);
    const v = (field: string) => get(field);
    const mapped = this.spec.map(v, d, n);
    const amount = n("settlement");
    const date = cols.date ? dateOf(cells[cols.date], where("date")) : null;
    const base = [this.spec.sheet, neft ?? "", mapped.ref ?? "", mapped.sku ?? "", mapped.ref_date ?? "", amount, mapped.expense, mapped.extra ? JSON.stringify(mapped.extra) : ""].join("|");
    return {
      key: this.keys.next(base),
      kind: this.spec.kind(cells, cols),
      neft_id: neft ?? null,
      payment_date: date,
      sku: mapped.sku,
      ref: mapped.ref,
      ref_date: mapped.ref_date,
      amount,
      expense: mapped.expense,
      gst: mapped.gst,
      extra: mapped.extra,
    };
  }
}

// --- The summary sheet ----------------------------------------------------------------------------------------

export type SettledSummary = {
  period_from: string | null;
  period_to: string | null;
  sale_orders: number | null;
  returns: number | null;
  /** "Net Bank Settlement (A)": what Seller Hub shows as the amount settled in the period. */
  flipkart_net: number | null;
};

/** Reads the "Summary of report" sheet: the period and Flipkart's own totals, for matching against our import. */
export function readSettledSummary(rows: SheetRow[]): SettledSummary {
  const out: SettledSummary = { period_from: null, period_to: null, sale_orders: null, returns: null, flipkart_net: null };
  for (const { cells } of rows) {
    const label = (cells.B ?? "").trim();
    if (/^Payment Duration/i.test(label)) {
      const m = /(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})/.exec(cells.C ?? "");
      if (m) [out.period_from, out.period_to] = [m[1], m[2]];
    } else if (/^# Sale Orders/i.test(label)) out.sale_orders = Number(cells.C);
    else if (/^# Returns/i.test(label)) out.returns = Number(cells.C);
    else if (/^Net Bank Settlement/i.test(label)) out.flipkart_net = Number(cells.E);
  }
  return out;
}
