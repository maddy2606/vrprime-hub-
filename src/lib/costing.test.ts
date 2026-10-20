import assert from "node:assert/strict";
import { test } from "node:test";
import { applyAds, findSku, masterUnitCost, monthlyPnl, skuCost, type MasterInfo, type SkuFacts } from "./costing.ts";

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

test("profit per month: returns come off, fees are a share of sales, missing costs are flagged", () => {
  const facts = new Map<string, SkuFacts>([
    ["BERRY-1", { masterId: "berry", cost: 60, price: 199 }],
    ["BERRY-2", { masterId: "berry", cost: 120, price: 349 }],
    ["NEW-1", { masterId: "musk", cost: null, price: 150 }],
  ]);
  const p = monthlyPnl(
    [
      { month: "2026-10", sku: "BERRY-1", dispatched: 10, returned: 2 },
      { month: "2026-10", sku: "BERRY-2", dispatched: 4, returned: 0 },
      { month: "2026-10", sku: "NEW-1", dispatched: 3, returned: 1 },
      { month: "2026-09", sku: "BERRY-1", dispatched: 1, returned: 3 },
    ],
    facts,
    20,
  );
  const oct = p.get("2026-10")!;
  assert.equal(oct.total.units, 8 + 4 + 2);
  assert.equal(oct.total.sales, 8 * 199 + 4 * 349 + 2 * 150);
  assert.equal(oct.total.fees, ((8 * 199 + 4 * 349 + 2 * 150) * 20) / 100);
  assert.equal(oct.total.cost, 8 * 60 + 4 * 120);
  assert.equal(oct.total.profit, Math.round((oct.total.sales - oct.total.fees - oct.total.cost) * 100) / 100);
  assert.equal(oct.total.uncostedSales, 300);
  assert.equal(oct.byMaster.get("berry")!.units, 12);
  assert.equal(p.has("2026-09"), false, "more returned than sent: nothing sold");
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
  const p = monthlyPnl([{ month: "2026-09", sku: "BERRY-1", dispatched: 10, returned: 0 }], facts, 10);
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
