// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import type { DeskData, DeskListing } from "./stock-analysis.ts";
import { buildStockView, defaultStockQuery, stockCsv, stockMeta, stockQuerySchema, STOCK_PAGE_SIZE } from "./stock-view.ts";

const WH = [{ id: "11111111-1111-4111-8111-111111111111", name: "Delhi" }, { id: "22222222-2222-4222-8222-222222222222", name: "Pune" }];

const listing = (sku: string, now: (number | null)[], over: Partial<DeskListing> = {}): DeskListing => ({
  sku, title: `Title ${sku}`, status: "ACTIVE", listingId: `L-${sku}`, inactiveSince: null, beforeTracking: false, dims: null, now, prev: now.map(() => null), prevStatus: null, ...over,
});

function desk(listings: DeskListing[]): DeskData {
  return { warehouses: WH, listings, settings: { low: 100, weightLimit: 2000, newInactiveDays: 2 }, today: "2026-10-13", snapshotDate: "2026-10-13", previousDate: null, fullAccess: true };
}

const many = Array.from({ length: 120 }, (_, i) => listing(`SKU-${String(i + 1).padStart(3, "0")}`, [i % 7 === 0 ? 0 : 50 + i, 300]));

test("only one page of the open list is sent, with the counts of every list", () => {
  const v = buildStockView(desk(many), defaultStockQuery("location"), null);
  assert.equal(v.rows.length, STOCK_PAGE_SIZE);
  assert.equal(v.total, 120);
  assert.equal(v.counts.location, 120);
  assert.equal(v.counts.low, v.tiles.low);
  assert.equal(v.cards.length, 2);
  const second = buildStockView(desk(many), { ...defaultStockQuery("location"), offset: 50 }, null);
  assert.equal(second.rows[0].sku, "SKU-051", "the next page carries on where the first stopped");
  const last = buildStockView(desk(many), { ...defaultStockQuery("location"), offset: 100 }, null);
  assert.equal(last.rows.length, 20);
});

test("sorting happens on the server, in both directions, and by a warehouse column", () => {
  const asc = buildStockView(desk(many), { ...defaultStockQuery("location"), sort: "sku", dir: "asc" }, null);
  const desc = buildStockView(desk(many), { ...defaultStockQuery("location"), sort: "sku", dir: "desc" }, null);
  assert.equal(asc.rows[0].sku, "SKU-001");
  assert.equal(desc.rows[0].sku, "SKU-120");
  const byDelhi = buildStockView(desk(many), { ...defaultStockQuery("location"), sort: "wh0", dir: "desc" }, null);
  assert.equal(byDelhi.rows[0].sku, "SKU-119", "the most units at Delhi first (SKU-120 happens to be empty there)");
  const byTotal = buildStockView(desk(many), { ...defaultStockQuery("location"), sort: "total", dir: "asc" }, null);
  assert.ok(byTotal.rows[0].total <= byTotal.rows[1].total);
});

test("search, hide inactive and a warehouse choice narrow the list", () => {
  const withInactive = [...many.slice(0, 10), listing("OLD-1", [5, 5], { status: "INACTIVE", inactiveSince: "2026-10-01", beforeTracking: true })];
  assert.equal(buildStockView(desk(withInactive), { ...defaultStockQuery("location"), q: "sku-00" }, null).total, 9);
  assert.equal(buildStockView(desk(withInactive), { ...defaultStockQuery("location"), q: "title old" }, null).total, 1, "title is searched too");
  assert.equal(buildStockView(desk(withInactive), defaultStockQuery("location"), null).total, 11);
  assert.equal(buildStockView(desk(withInactive), { ...defaultStockQuery("location"), hide: true }, null).total, 10);
  const pune = buildStockView(desk([listing("ONLY-DELHI", [10, null]), listing("BOTH", [10, 10])]), { ...defaultStockQuery("location"), wh: WH[1].id }, null);
  assert.deepEqual(pune.rows.map((r) => r.sku), ["BOTH"], "with one warehouse chosen only SKUs listed there appear");
});

test("days of cover ride along with each row of the page", () => {
  const soonest = { "SKU-001": { days: 3, warehouseId: WH[0].id, units: 30, rate: 10, source: "orders" as const } };
  const v = buildStockView(desk(many.slice(0, 3)), { ...defaultStockQuery("location"), sort: "cover", dir: "asc" }, soonest);
  assert.equal(v.rows[0].sku, "SKU-001", "the SKU with cover sorts first; the ones without go last");
  assert.equal(v.rows[0].cover?.days, 3);
  assert.equal(v.rows[1].cover, null);
});

test("the CSV has every row, not just the page", () => {
  const csv = stockCsv(desk(many), defaultStockQuery("location"), null);
  assert.equal(csv.body.length, 120);
  assert.deepEqual(csv.headers.slice(0, 4), ["SKU", "Title", "Delhi", "Pune"]);
  const low = stockCsv(desk(many), { ...defaultStockQuery("low"), q: "SKU-001" }, null);
  assert.deepEqual(low.headers.slice(0, 2), ["SKU", "Title"]);
  assert.ok(low.body.length >= 1 && low.body.length < 120, "the search narrows the CSV too");
});

test("what the screen needs to label things is small", () => {
  const meta = stockMeta(desk(many));
  assert.deepEqual(Object.keys(meta).sort(), ["fullAccess", "previousDate", "settings", "snapshotDate", "today", "warehouses"]);
  assert.ok(JSON.stringify(meta).length < 500);
});

test("a request for the Stock tab is checked before it reaches the server", () => {
  assert.ok(stockQuerySchema.safeParse(defaultStockQuery("low")).success);
  for (const bad of [{ view: "evil" }, { wh: "nope" }, { offset: -1 }, { dir: "up" }, { q: "x".repeat(101) }, { hide: "yes" }]) {
    assert.equal(stockQuerySchema.safeParse({ ...defaultStockQuery("low"), ...bad }).success, false, JSON.stringify(bad));
  }
});

test("one warehouse picked: its out-of-stock list is what is 0 there, its low list is what is under the level there", () => {
  const d = desk([
    listing("OUT-AT-DELHI", [0, 500]),
    listing("LOW-AT-DELHI", [40, 500]),
    listing("FINE", [200, 0]),
    listing("OUT-EVERYWHERE", [0, 0]),
    listing("ONLY-PUNE", [null, 5]),
  ]);
  const delhi = { wh: WH[0].id };
  const out = buildStockView(d, { ...defaultStockQuery("out"), ...delhi }, null);
  assert.deepEqual(out.rows.map((r) => r.sku).sort(), ["OUT-AT-DELHI", "OUT-EVERYWHERE"], "0 units at Delhi, whatever Pune has");
  const low = buildStockView(d, { ...defaultStockQuery("low"), ...delhi }, null);
  assert.deepEqual(low.rows.map((r) => r.sku), ["LOW-AT-DELHI"], "under 100 but not 0 at Delhi; a SKU not listed at Delhi is in neither list");
  assert.deepEqual([out.counts.out, out.counts.low], [2, 1], "the counts on the two buttons");
});
