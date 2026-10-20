import assert from "node:assert/strict";
import { test } from "node:test";
import { applyAds, findSku, masterUnitCost, monthlyPnl, skuCost, type MasterInfo, type MonthUnits, type ReportUnits, type SkuFacts } from "./costing.ts";

const masters = new Map<string, MasterInfo>([
  ["berry", { id: "berry", name: "Berry Car Perfume", kitParts: [] }],
  ["musk", { id: "musk", name: "Musk Car Perfume", kitParts: [] }],
  ["combo", { id: "combo", name: "Car Perfume", kitParts: [{ part: "berry", qty: 1 }, { part: "musk", qty: 2 }] }],
]);

test("a pack of 2 costs twice the master; a kit costs its parts", () => {
  const costs = { berry: 60, musk: 45.5 };
  assert.equal(masterUnitCost("berry", masters, costs), 60);
  assert.equal(skuCost(2, masterUnitCost("berry", masters, costs)), 120);
  assert.equal(masterUnitCost("combo", masters, costs), 151, "1 x 60 + 2 x 45.5");
  assert.equal(masterUnitCost("combo", masters, { ...costs, combo: 140 }), 140, "a kit's own cost wins");
  assert.equal(masterUnitCost("combo", masters, { berry: 60 }), null, "a part with no cost: not known");
  assert.equal(skuCost(3, null), null);
});

const order = (month: string, sku: string, ordered: number, custReturned: number, rto: number, soldValue: number, soldPricedUnits: number, inReport = false): MonthUnits => ({
  month, sku, inReport, ordered, cancelled: 1, custReturned, rto, soldValue, soldPricedUnits,
});
const rep = (month: string, sku: string, net: number, itemValue: number, sales: number, earnings: number): ReportUnits => ({
  month, sku, gross: net + 1, retCanc: 1, net, itemValue, sales, earnings, firstDay: `${month}-01`, lastDay: `${month}-16`,
});

test("days the Flipkart report covers use its own figures; later days are priced from the SKU's report rates", () => {
  const facts = new Map<string, SkuFacts>([
    ["BERRY-1", { masterId: "berry", cost: 60, price: 199, salesPerUnit: 150, earnPerUnit: 140 }],
    ["NEW-1", { masterId: "musk", cost: null, price: 200 }],
  ]);
  const p = monthlyPnl(
    [
      order("2026-10", "BERRY-1", 12, 0, 0, 12 * 180, 12, true), // covered by the report: counted, not priced again
      order("2026-10", "BERRY-1", 5, 1, 0, 4 * 180, 4), // after the report: 4 sold at the report's 150 / 140 per unit
      order("2026-10", "NEW-1", 3, 0, 1, 2 * 200, 2), // never in the report: 400 selling price x 0.7, fees 10%
    ],
    [rep("2026-10", "BERRY-1", 10, 1900, 1500, 1400)],
    facts,
    { feePct: 10, fspToSales: 0.7 },
  );
  const oct = p.get("2026-10")!;
  assert.deepEqual(oct.counts, { ordered: 20, cancelled: 3, custReturned: 1, rto: 1 });
  assert.deepEqual(oct.report, { gross: 11, retCanc: 1, net: 10, from: "2026-10-01", to: "2026-10-16" });
  assert.equal(oct.total.units, 10 + 4 + 2);
  assert.equal(oct.total.sales, 1500 + 4 * 150 + 280);
  assert.equal(oct.total.fees, 100 + 4 * 10 + 28);
  assert.equal(oct.total.cost, 14 * 60);
  assert.equal(oct.total.estSales, 600 + 280);
  assert.equal(oct.total.itemValue, 1900 + 720 + 400);
  assert.equal(oct.total.uncostedSales, 280);
  assert.equal(oct.total.profit, Math.round((oct.total.sales - oct.total.fees - oct.total.cost) * 100) / 100);
});

test("ad spend comes off the month and the product it advertised", () => {
  const facts = new Map<string, SkuFacts>([["BERRY-1", { masterId: "berry", cost: 60, price: 200 }]]);
  const p = monthlyPnl([], [rep("2026-09", "BERRY-1", 10, 2500, 2000, 1800)], facts, { feePct: 10, fspToSales: 1 });
  applyAds(p, [
    { month: "2026-09", masterKey: "berry", spend: 300 },
    { month: "2026-09", masterKey: "unlinked", spend: 50 },
    { month: "2026-08", masterKey: "musk", spend: 25 },
  ]);
  const sep = p.get("2026-09")!;
  assert.equal(sep.total.profit, 1800 - 600);
  assert.equal(sep.total.ads, 350);
  assert.equal(sep.total.net, 1200 - 350);
  assert.equal(sep.byMaster.get("berry")!.net, 1200 - 300);
  assert.equal(sep.byMaster.get("unlinked")!.net, -50, "ads with no sales: a loss");
  assert.equal(p.get("2026-08")!.total.net, -25, "a month with only ads still shows");
});

test("SKUs match as written, then in any case", () => {
  const exact = new Map([["Lint-01", 1]]);
  const lower = new Map([["lint-01", 1]]);
  assert.equal(findSku("Lint-01", exact, lower), 1);
  assert.equal(findSku("LINT-01", exact, lower), 1);
  assert.equal(findSku("other", exact, lower), undefined);
});

