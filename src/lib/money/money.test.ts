// Run with: npm test
// Reports are built in memory here (small fake workbooks laid out like Flipkart's), never from the real files.
import assert from "node:assert/strict";
import { test } from "node:test";
import { strToU8, zipSync } from "fflate";
import { dateOf, normalizeHeader, num, ReportError } from "./columns.ts";
import { costOn, parseCostCsv } from "./costs.ts";
import { importReport, type FinishInfo, type Sink } from "./import.ts";
import { readPeriod } from "./period.ts";
import { readEstimateRows, readProfitRows, totalsOf, withProfit, type ProfitRowRaw } from "./profit.ts";
import type { SettledLine } from "./settled.ts";
import type { PnlOrder } from "./pnl.ts";
import { feeTicketNotes, newTicketHref, weightTicketNotes } from "./tickets.ts";
import { readCsv, readWorkbook } from "./xlsx-stream.ts";

// --- A fake workbook ----------------------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const sheetXml = (rows: Record<string, string>[]) =>
  `<?xml version="1.0"?><worksheet><sheetData>${rows
    .map(
      (cells, i) =>
        `<row r="${i + 1}">${Object.entries(cells)
          .map(([col, v]) => (/^-?\d+(\.\d+)?$/.test(v) && col !== "ID" ? `<c r="${col}${i + 1}"><v>${v}</v></c>` : `<c r="${col}${i + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`))
          .join("")}</row>`,
    )
    .join("")}</sheetData></worksheet>`;

function workbook(sheets: { name: string; rows: Record<string, string>[] }[]): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8("<Types/>"),
    "xl/sharedStrings.xml": strToU8('<sst count="0" uniqueCount="0"/>'),
    "xl/workbook.xml": strToU8(`<workbook><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" r:id="rId${i + 1}" sheetId="${i + 1}"/>`).join("")}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<Relationships>${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`),
  };
  sheets.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s.rows))));
  return zipSync(files);
}

async function* inPieces(bytes: Uint8Array, size = 300): AsyncGenerator<Uint8Array> {
  for (let at = 0; at < bytes.length; at += size) yield bytes.subarray(at, Math.min(at + size, bytes.length));
}

class FakeSink implements Sink {
  settled: SettledLine[] = [];
  other: { kind: string; amount: number; expense: number }[] = [];
  pnl: PnlOrder[] = [];
  began: string[] = [];
  failed: string[] = [];
  summary: Record<string, unknown> = {};
  async begin(kind: string, filename: string) {
    this.began.push(`${kind}:${filename}`);
    return "upload-1";
  }
  async addSettled(_u: string, rows: SettledLine[]) { this.settled.push(...rows); }
  async addOther(_u: string, rows: { kind: string; amount: number; expense: number }[]) { this.other.push(...rows); }
  async addPnl(_u: string, rows: PnlOrder[]) { this.pnl.push(...rows); }
  async finish(_u: string, summary: Record<string, unknown>): Promise<FinishInfo> {
    this.summary = summary;
    return { from: null, to: null, total: null, skus_filled: 0 };
  }
  async fail(_u: string, message: string) { this.failed.push(message); }
}

// The Orders sheet of a Settled Transactions report: group row, header row, sub-header row, then data.
const ORDERS_HEADER: Record<string, string> = {
  A: "NEFT ID", B: "Neft Type", C: " Payment Date", D: "Bank Settlement Value (Rs.) \n= SUM(J:R)", E: "Input GST + TCS Credits (Rs.)\n[GST+TCS]", F: "Income Tax Credits (Rs.)\n[TDS]",
  H: "Order ID", I: "Order item ID", J: "Sale Amount (Rs.)", K: "Total Offer Amount (Rs.)", M: "Customer Add-ons Amount (Rs.)", N: "Marketplace Fee (Rs.)\n= SUM (V:AI)",
  O: "Taxes (Rs.)", P: "Offer Adjustments (Rs.)", Q: "Protection Fund (Rs.)", R: "Refund (Rs.)", U: "Commission Rate (%)", V: "Commission (Rs.)", W: "Fixed Fee  (Rs.)",
  X: "Collection Fee (Rs.)", Y: "Pick And Pack Fee (Rs.)", Z: "Shipping Fee (Rs.)", AA: "Reverse Shipping Fee (Rs.)", AB: "No Cost Emi Fee Reimbursement(Rs.)",
  AK: "TCS (Rs.)", AL: "TDS (Rs.)", AM: "GST on MP Fees (Rs.)", AV: "Dead Weight (kgs)", AX: "Volumetric Weight (kgs)", BA: "Chargeable Wt. Slab (In Kgs)", BB: "Shipping Zone",
  BD: "Order Date", BG: "Seller SKU", BH: "Quantity", BO: "Invoice ID",
};

function orderRow(over: Record<string, string>): Record<string, string> {
  return {
    A: "NFT-/XUTR/AAA111X ", B: "Postpaid", C: "2026-09-28", D: "100", E: "1", F: "0.2", H: "OD1", I: "1", J: "120", K: "0", M: "0", N: "-5", O: "-15", P: "0", Q: "0", R: "0",
    U: "0", V: "0", W: "-5", X: "0", Y: "0", Z: "0", AA: "0", AB: "0", AK: "-1", AL: "-0.2", AM: "-0.9", AV: "NA", AX: "NA", BA: "NA", BB: "NA", BD: "2026-09-17", BG: "SKU-A", BH: "1", BO: "INV1",
    ...over,
  };
}

const settledBook = (orders: Record<string, string>[], extraSheets: { name: string; rows: Record<string, string>[] }[] = [], header = ORDERS_HEADER) =>
  workbook([
    { name: "Report Help", rows: [{ A: "Dear Seller," }] },
    { name: "Summary of report", rows: [{ B: "Payment Duration " , C: "2026-09-01 - 2026-09-30" }, { B: "# Sale Orders (Not returned)", C: "2" }, { B: "Net Bank Settlement (A)", E: "155.5" }] },
    { name: "Orders", rows: [{ A: "Payment Details", H: "Transaction Summary" }, header, { BR: "Total" }, ...orders] },
    ...extraSheets,
  ]);

// --- Columns ----------------------------------------------------------------------------------------------------

test("header names are matched by name, ignoring units, brackets and the formula line", () => {
  assert.equal(normalizeHeader("Bank Settlement Value (Rs.) \n= SUM(J:R)"), "bank settlement value");
  assert.equal(normalizeHeader(" Payment Date"), "payment date");
  assert.equal(normalizeHeader("Chargeable Wt. Slab (In Kgs)"), "chargeable wt slab");
  assert.equal(normalizeHeader("Taxes (GST)"), "taxes gst");
  assert.equal(normalizeHeader("Bank Settlement [Projected] (INR)"), "bank settlement projected");
  assert.equal(normalizeHeader("Length*Breadth*Height"), "length breadth height");
});

test("numbers and dates: blanks and NA are empty, junk is refused", () => {
  assert.equal(num("NA", "x"), null);
  assert.equal(num("Generation in progress", "x"), null);
  assert.equal(num("1,234.50", "x"), 1234.5);
  assert.throws(() => num("abc", "Orders, row 5"), /Orders, row 5/);
  assert.equal(dateOf("2026-09-28", "x"), "2026-09-28");
  assert.equal(dateOf("28/09/2026", "x"), "2026-09-28");
  assert.equal(dateOf("46293", "x"), "2026-09-28");
  assert.equal(dateOf("NA", "x"), null);
  assert.throws(() => dateOf("soon", "x"), ReportError);
});

// --- Reading the workbook -----------------------------------------------------------------------------------

test("a workbook is read row by row, in tiny pieces, with sheet names and entities decoded", async () => {
  const bytes = workbook([
    { name: "Orders P&L", rows: [{ A: "x & y", B: "5" }, { A: "<tag>" }] },
    { name: "Skipped", rows: [{ A: "no" }] },
  ]);
  const rows = [];
  for await (const r of readWorkbook(inPieces(bytes, 64), (n) => n !== "Skipped")) rows.push(r);
  assert.deepEqual(rows.map((r) => [r.sheet, r.row, r.cells]), [
    ["Orders P&L", 1, { A: "x & y", B: "5" }],
    ["Orders P&L", 2, { A: "<tag>" }],
  ]);
});

test("a CSV is read as rows with column letters, quotes and all", async () => {
  const text = '﻿sku,purchase_cost\r\n" RATH2","1,200"\r\n"a\nb",3\r\n';
  const rows = [];
  for await (const r of readCsv(inPieces(strToU8(text), 7))) rows.push(r.cells);
  assert.deepEqual(rows, [{ A: "sku", B: "purchase_cost" }, { A: " RATH2", B: "1,200" }, { A: "a\nb", B: "3" }]);
});

// --- Settled Transactions -------------------------------------------------------------------------------------

test("a settled report is read from its headers; SKUs keep their spaces, NEFT IDs lose theirs", async () => {
  const sink = new FakeSink();
  const book = settledBook([
    orderRow({ I: "1", H: "OD1", BG: " RATH2", D: "100", J: "120" }),
    orderRow({ I: "2", H: "OD2", BG: "SKU-B", J: "200", D: "55.5", R: "0", W: "-20", N: "-20", BA: "0.0-0.5", BB: "Local", AV: "0.30", AX: "0.31" }),
  ]);
  const result = await importReport(inPieces(book), "settled.xlsx", sink);
  assert.equal(result.kind, "settled");
  assert.equal(sink.settled.length, 2);
  const [a, b] = sink.settled;
  assert.equal(a.sku, " RATH2", "a SKU is never trimmed");
  assert.equal(a.neft_id, "NFT-/XUTR/AAA111X", "the NEFT ID is trimmed");
  assert.equal(a.payment_date, "2026-09-28");
  assert.equal(a.net, 100);
  assert.equal(a.other_fees, 0);
  assert.equal(b.fixed_fee, -20);
  assert.equal(b.weight_slab, "0.0-0.5");
  assert.equal(b.zone, "Local");
  assert.equal(b.dead_weight, 0.3);
  assert.equal(a.dead_weight, null, "NA is empty, not zero");
  assert.equal(result.hasWeightColumns, true);
  assert.deepEqual((result.summary.flipkart as { sale_orders: number; flipkart_net: number; period_from: string }).sale_orders, 2);
  assert.equal((result.summary.flipkart as { flipkart_net: number }).flipkart_net, 155.5);
  assert.equal((result.summary.flipkart as { period_from: string }).period_from, "2026-09-01");
});

test("identical lines in one file keep their own keys; the same line in another upload gets the same key", async () => {
  const rows = [orderRow({}), orderRow({}), orderRow({ I: "9" })];
  const one = new FakeSink();
  await importReport(inPieces(settledBook(rows)), "a.xlsx", one);
  const two = new FakeSink();
  await importReport(inPieces(settledBook(rows)), "b.xlsx", two);
  assert.equal(new Set(one.settled.map((l) => l.key)).size, 3, "three distinct keys");
  assert.deepEqual(one.settled.map((l) => l.key), two.settled.map((l) => l.key), "stable between uploads, which is what lets the database skip duplicates");
});

test("a file with a renamed or missing column is refused, naming the column, before anything is saved", async () => {
  const header = { ...ORDERS_HEADER, W: "Fixed Charge (Rs.)" };
  delete (header as Record<string, string>).AA;
  const sink = new FakeSink();
  await assert.rejects(
    importReport(inPieces(settledBook([orderRow({})], [], header)), "bad.xlsx", sink),
    (error: Error) => error instanceof ReportError && /"fixed fee"/.test(error.message) && /"reverse shipping fee"/.test(error.message),
  );
  assert.deepEqual(sink.began, [], "no upload was even started");
  assert.equal(sink.settled.length, 0);
});

test("a number that is not a number stops the import and marks the upload failed", async () => {
  const sink = new FakeSink();
  await assert.rejects(importReport(inPieces(settledBook([orderRow({ J: "twelve" })])), "x.xlsx", sink), /Sale Amount/);
  assert.equal(sink.failed.length, 1);
});

test("the other sheets of a settled report are kept: ads cost what was redeemed, a top-up is only cash", async () => {
  const sink = new FakeSink();
  const ads = {
    name: "Ads",
    rows: [
      { A: "Payment Details" } as Record<string, string>,
      { A: "NEFT ID", B: "Payment Date", C: "Settlement Value (Rs.) = SUM(G:K)", E: "Type", F: "Campaign / Transaction ID", G: "Wallet Redeem (Rs.)", H: "Wallet Redeem Reversal (Rs.)", I: "Wallet Topup (Rs.)", J: "Wallet Refund (Rs.)", K: "GST on Ads Fees (Rs.)" },
      { A: "N1 ", B: "2026-09-25", C: "-100", E: "topup", F: "T1", G: "0", H: "0", I: "-100", J: "0", K: "0" },
      { A: "N2", B: "2026-09-25", C: "0", E: "redeem", F: "C1", G: "-50", H: "10", I: "0", J: "0", K: "-7.2" },
    ],
  };
  await importReport(inPieces(settledBook([orderRow({})], [ads])), "x.xlsx", sink);
  assert.deepEqual(sink.other.map((o) => [o.kind, o.amount, o.expense]), [["ads", -100, 0], ["ads", 0, -47.2]]);
});

test("a file that is neither report is refused with its sheet names", async () => {
  const sink = new FakeSink();
  await assert.rejects(importReport(inPieces(workbook([{ name: "Sheet1", rows: [{ A: "hello" }] }])), "x.xlsx", sink), /not a Settled Transactions or Profit and Loss report/);
});

// --- Profit and Loss ------------------------------------------------------------------------------------------

test("a P&L report: two header rows, and the payments that settled each order", async () => {
  const group: Record<string, string> = { A: "Order Date", B: "Order ID", C: "Order Item ID", D: "SKU Name", E: "Fulfillment Type", H: "Order Status", J: "Gross Units (#)", K: "Returned & Cancelled Units", O: "Net Units ", Q: "Order Item Value", AB: "Total Expenses (INR)", AX: "Bank Settlement [Projected] (INR)", BB: "Net Earnings (INR)", BE: "Amount Settled (INR)", BF: "Amount Pending (INR)", BH: "Transaction-1" };
  const sub: Record<string, string> = { AC: "Commission Fee", AE: "Fixed Fee", AR: "Taxes (GST)", BH: "Transaction Amount", BM: "NEFT ID", BN: "Transaction Amount", BS: "NEFT ID" };
  // The "(#)" in the first header and the unit-less names must still match.
  group.J = "Gross Units";
  const data: Record<string, string> = { A: "2026-09-01", B: "OD5", C: "5", D: " RATH2", E: "NON_FBF", H: "DELIVERED", J: "1", K: "0", O: "1", Q: "188", AB: "-22", AX: "115.5", BB: "118", BE: "115.5", BF: "0", AC: "0", AE: "-5", AR: "-3", BH: "10.5", BM: "NFT-1 ", BN: "105", BS: "NFT-2" };
  const book = workbook([
    { name: "Overall Summary", rows: [{ A: "Orders Recieved During:", B: "2026-09-01 to 2026-09-30" }, { A: "Gross Sales", B: "188", C: "1" }, { A: "• Ads", B: "-5" }] },
    { name: "Orders P&L", rows: [group, sub, data] },
  ]);
  const sink = new FakeSink();
  const result = await importReport(inPieces(book), "pnl.xlsx", sink);
  assert.equal(result.kind, "pnl");
  assert.equal(sink.pnl.length, 1);
  const o = sink.pnl[0];
  assert.equal(o.sku, " RATH2");
  assert.equal(o.amount_settled, 115.5);
  assert.equal(o.fixed_fee, -5);
  assert.deepEqual(o.txns, [["NFT-1", 10.5], ["NFT-2", 105]], "payments are paired with their NEFT IDs, which are trimmed");
  const f = result.summary.flipkart as { orders_from: string; gross_sales: number; ads: number };
  assert.deepEqual([f.orders_from, f.gross_sales, f.ads], ["2026-09-01", 188, -5]);
});

// --- Costs, period, profit --------------------------------------------------------------------------------------

test("a cost CSV is read whole or refused with the line that is wrong", () => {
  const rows = parseCostCsv("sku,purchase_cost,packaging_cost,freight,effective_from\n RATH2,100,5,,2026-09-01\nB1,50,2,1,\n", "2026-10-14");
  assert.deepEqual(rows, [
    { sku: " RATH2", purchase_cost: 100, packaging_cost: 5, freight: 0, effective_from: "2026-09-01" },
    { sku: "B1", purchase_cost: 50, packaging_cost: 2, freight: 1, effective_from: "2026-10-14" },
  ]);
  assert.throws(() => parseCostCsv("sku,purchase_cost\nA,abc\n", "2026-10-14"), /Line 2: purchase_cost/);
  assert.throws(() => parseCostCsv("sku,cost\nA,1\n", "2026-10-14"), /"purchase_cost"/);
  assert.throws(() => parseCostCsv("sku,purchase_cost\nA,1\nA,2\n", "2026-10-14"), /twice/);
});

test("an old order uses the old cost: the cost in force on the order date", () => {
  const costs = parseCostCsv("sku,purchase_cost,packaging_cost,freight,effective_from\nA,100,5,0,2026-01-01\nA,120,5,2,2026-09-15\n", "2026-10-14");
  assert.equal(costOn(costs, "A", "2026-09-01"), 105);
  assert.equal(costOn(costs, "A", "2026-09-15"), 127);
  assert.equal(costOn(costs, "A", "2025-12-31"), null, "no cost yet");
  assert.equal(costOn(costs, "B", "2026-09-15"), null);
});

test("periods end on the last settlement day, not today", () => {
  assert.deepEqual(readPeriod({}, "2026-09-28", "2026-10-14"), { from: "2026-08-30", to: "2026-09-28", preset: 30 });
  assert.deepEqual(readPeriod({ range: "7" }, "2026-09-28", "2026-10-14"), { from: "2026-09-22", to: "2026-09-28", preset: 7 });
  assert.deepEqual(readPeriod({ from: "2026-09-01", to: "2026-09-10" }, "2026-09-28", "2026-10-14"), { from: "2026-09-01", to: "2026-09-10", preset: null });
  assert.equal(readPeriod({ from: "2026-09-10", to: "2026-09-01" }, null, "2026-10-14").preset, 30, "a backwards range falls back");
});

const raw = (over: Partial<ProfitRowRaw>): ProfitRowRaw => ({
  sku: "A", units_sold: 10, units_returned: 3, units_returned_paid: 2, gross_sales: 1000, refunds: -200, commission: 0, fixed_fee: -50, collection_fee: 0, shipping_fee: 0,
  reverse_shipping_fee: -100, other_fees: 0, gst_on_fees: -27, tcs: -10, tds: -2, net_payout: 600, itc: 39, cost: 400, cost_missing: false, orders: 10, ...over,
});

test("profit = net payout + tax credits - cost; margin is over sales kept; no cost means no profit shown", () => {
  const r = withProfit(raw({}));
  assert.equal(r.revenue, 800);
  assert.equal(r.profit, 239);
  assert.equal(r.netUnits, 8);
  assert.equal(Math.round((r.profitPerUnit ?? 0) * 100) / 100, 29.88);
  assert.equal(Math.round((r.margin ?? 0) * 10) / 10, 29.9);
  const noCost = withProfit(raw({ sku: "B", cost: 0, cost_missing: true }));
  assert.equal(noCost.margin, null, "a SKU with no cost has no margin");
  const t = totalsOf([r, noCost]);
  assert.equal(t.skusWithoutCost, 1);
  assert.equal(t.units_sold, 20);
  assert.equal(t.fees, -300);
});

test("rows from the database are read safely", () => {
  assert.equal(readProfitRows(null).length, 0);
  const [row] = readProfitRows([{ sku: "A", units_sold: "3", net_payout: "12.5", cost_missing: true }, "junk", { nope: 1 }]);
  assert.deepEqual([row.units_sold, row.net_payout, row.cost_missing, row.cost], [3, 12.5, true, 0]);
  assert.equal(readEstimateRows([{ sku: "A", units: 2, price: null, fee_pct: "12", est_profit: "-4" }])[0].est_profit, -4);
});

test("a ticket link carries the issue, the SKU and the order details", () => {
  const href = newTicketHref({ issue: "weight_overcharge", sku: " RATH2", notes: weightTicketNotes({ order_id: "OD1", order_item_id: "1", charged_slab: "0.5-1.0", our_kg: 0.31, our_slab_kg: 0.5, extra_fee: 20 }) });
  const url = new URL(href, "https://x.test");
  assert.equal(url.pathname, "/tickets/new");
  assert.equal(url.searchParams.get("issue"), "weight_overcharge");
  assert.equal(url.searchParams.get("sku"), " RATH2");
  assert.match(url.searchParams.get("notes") ?? "", /OD1.*0\.5-1\.0.*Rs\. 20/);
  assert.match(feeTicketNotes({ order_id: "OD2", order_item_id: "2", problem: "Fee charged twice", extra_fee: null }), /unknown/);
});
