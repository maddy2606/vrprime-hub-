import assert from "node:assert/strict";
import { test } from "node:test";
import { applyAds, feeRate, findSku, masterUnitCost, monthlyPnl, skuCost, type MasterInfo, type SkuFacts } from "./costing.ts";

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

test("profit per month: counted like Seller Hub, real order prices first, missing costs flagged", () => {
  const facts = new Map<string, SkuFacts>([
    ["BERRY-1", { masterId: "berry", cost: 60, price: 199 }],
    ["BERRY-2", { masterId: "berry", cost: 120, price: 349 }],
    ["NEW-1", { masterId: "musk", cost: null, price: 150 }],
  ]);
  const u = (month: string, sku: string, ordered: number, custReturned: number, rto: number, soldValue: number, soldPricedUnits: number) => ({ month, sku, ordered, cancelled: 1, custReturned, rto, soldValue, soldPricedUnits });
  const p = monthlyPnl(
    [
      u("2026-10", "BERRY-1", 10, 1, 1, 8 * 180, 8), // every sold unit has its order price (180, not today's 199)
      u("2026-10", "BERRY-2", 4, 0, 0, 2 * 300, 2), // two units priced, two at today's listing price
      u("2026-10", "NEW-1", 3, 1, 0, 0, 0),
      u("2026-09", "BERRY-1", 1, 2, 1, 0, 0),
    ],
    facts,
    20,
  );
  const oct = p.get("2026-10")!;
  assert.deepEqual(oct.counts, { ordered: 17, cancelled: 3, custReturned: 2, rto: 1 });
  assert.equal(oct.total.units, 8 + 4 + 2);
  const sales = 8 * 180 + (2 * 300 + 2 * 349) + 2 * 150;
  assert.equal(oct.total.sales, sales);
  assert.equal(oct.total.fees, (sales * 20) / 100);
  assert.equal(oct.total.cost, 8 * 60 + 4 * 120);
  assert.equal(oct.total.listPricedUnits, 2 + 2);
  assert.equal(oct.total.uncostedSales, 300);
  assert.equal(oct.byMaster.get("berry")!.units, 12);
  assert.equal(p.get("2026-09")!.total.units, 0, "more returned than ordered: nothing sold");
});

test("SKUs match as written, then in any case", () => {
  const exact = new Map([["Lint-01", 1]]);
  const lower = new Map([["lint-01", 1]]);
  assert.equal(findSku("Lint-01", exact, lower), 1);
  assert.equal(findSku("LINT-01", exact, lower), 1);
  assert.equal(findSku("other", exact, lower), undefined);
});

test("ad spend comes off the month and the product it advertised", () => {
  const facts = new Map<string, SkuFacts>([["BERRY-1", { masterId: "berry", cost: 60, price: 200 }]]);
  const p = monthlyPnl([{ month: "2026-09", sku: "BERRY-1", ordered: 10, cancelled: 0, custReturned: 0, rto: 0, soldValue: 0, soldPricedUnits: 0 }], facts, 10);
  applyAds(p, [
    { month: "2026-09", masterKey: "berry", spend: 300 },
    { month: "2026-09", masterKey: "unlinked", spend: 50 },
    { month: "2026-08", masterKey: "musk", spend: 25 },
  ]);
  const sep = p.get("2026-09")!;
  assert.equal(sep.total.profit, 2000 - 200 - 600);
  assert.equal(sep.total.ads, 350);
  assert.equal(sep.total.net, 1200 - 350);
  assert.equal(sep.byMaster.get("berry")!.net, 1200 - 300);
  assert.equal(sep.byMaster.get("unlinked")!.net, -50, "ads with no sales: a loss");
  assert.equal(p.get("2026-08")!.total.net, -25, "a month with only ads still shows");
});

test("each SKU's real Flipkart fee rate is used; the rest are estimated and flagged", () => {
  assert.equal(feeRate(1000, -320), 32);
  assert.equal(feeRate(0, -5), null);
  const facts = new Map<string, SkuFacts>([
    ["REAL", { masterId: "berry", cost: 0, price: 100, feePct: 32 }],
    ["GUESS", { masterId: "musk", cost: 0, price: 100 }],
  ]);
  const p = monthlyPnl(
    [
      { month: "2026-10", sku: "REAL", ordered: 10, cancelled: 0, custReturned: 0, rto: 0, soldValue: 1000, soldPricedUnits: 10 },
      { month: "2026-10", sku: "GUESS", ordered: 5, cancelled: 0, custReturned: 0, rto: 0, soldValue: 500, soldPricedUnits: 5 },
    ],
    facts,
    12,
  );
  const oct = p.get("2026-10")!.total;
  assert.equal(oct.fees, 320 + 60);
  assert.equal(oct.estFeeSales, 500);
});
