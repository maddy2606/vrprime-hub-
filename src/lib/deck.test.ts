import assert from "node:assert/strict";
import { test } from "node:test";
import { dryAndSelling, heroFor, outOfStock, outOfStockSub, rankQueue, SEVERITY, urgentCount, warehouseHealth, type QueueItem } from "./deck.ts";
import { analyze, type DeskData, type DeskListing } from "./stock-analysis.ts";

const item = (key: string, kind: QueueItem["kind"], deadline: number | null, title = key): QueueItem => ({ key, kind, severity: SEVERITY[kind], deadline, title, detail: "", actions: [] });

test("the queue is ranked by severity, then the earliest deadline, then the title", () => {
  const ranked = rankQueue([item("w", "work", 5), item("t", "ticket", 1), item("l2", "late", 20), item("l1", "late", 10), item("d", "dry", null), item("o", "overfill", 3), item("r", "risk", 1), item("l3", "late", null)]);
  assert.deepEqual(
    ranked.map((i) => i.key),
    ["l1", "l2", "l3", "o", "d", "r", "t", "w"],
  );
});

test("urgent items are everything except work that is only assigned to me", () => {
  assert.equal(urgentCount([item("w", "work", null), item("t", "ticket", 1), item("r", "risk", 2)]), 2);
  assert.equal(urgentCount([item("w", "work", null)]), 0);
});

test("the headline names the worst thing: late orders, then a SKU that ran dry", () => {
  const h = heroFor({ lateOrders: 1, dry: [{ sku: "VACMAP2" }], overfillSkus: 3, followUpsDue: 2, onTime: 499, active: 500 });
  assert.equal(h.headline, "1 order is late, and VACMAP2 just ran dry");
  assert.equal(h.tone, "bad");
  assert.equal(h.reassurance, "499 of 500 active orders are on time.");
});

test("several dry SKUs are counted, and an amber headline when nothing is late", () => {
  const h = heroFor({ lateOrders: 0, dry: [{ sku: "A" }, { sku: "B" }], overfillSkus: 0, followUpsDue: 0, onTime: 10, active: 10 });
  assert.equal(h.headline, "2 selling SKUs are out of stock");
  assert.equal(h.tone, "warn");
});

test("all caught up when nothing is urgent", () => {
  const h = heroFor({ lateOrders: 0, dry: [], overfillSkus: 0, followUpsDue: 0, onTime: 12, active: 12 });
  assert.equal(h.tone, "ok");
  assert.equal(h.headline, "You're all caught up");
});

test("warehouse health: share of active orders that are not late, with a late, soon or on-time chip", () => {
  const now = new Date("2026-10-14T10:00:00Z");
  assert.deepEqual(warehouseHealth({ active: 100, late: 10, nextDue: null }, now), { pct: 90, tone: "warn", chip: { label: "10 late", tone: "bad" } });
  assert.equal(warehouseHealth({ active: 100, late: 0, nextDue: "2026-10-14T11:00:00Z" }, now).chip.label, "Due soon");
  assert.equal(warehouseHealth({ active: 100, late: 0, nextDue: "2026-10-14T20:00:00Z" }, now).chip.label, "On time");
  assert.equal(warehouseHealth({ active: 0, late: 0, nextDue: null }, now).pct, 100);
  // one late order among 500 is 99.8%: still not shown as all green, because the chip is red
  assert.equal(warehouseHealth({ active: 500, late: 1, nextDue: null }, now).chip.tone, "bad");
});

const WH = [{ id: "11111111-1111-4111-8111-111111111111", name: "Delhi" }, { id: "22222222-2222-4222-8222-222222222222", name: "Pune" }];

const listing = (sku: string, now: (number | null)[], over: Partial<DeskListing> = {}): DeskListing => ({
  sku, title: `Title ${sku}`, status: "ACTIVE", listingId: `L-${sku}`, inactiveSince: null, beforeTracking: false, dims: null, now, prev: now.map(() => null), prevStatus: null, ...over,
});

const desk = (listings: DeskListing[]): DeskData => ({
  warehouses: WH, listings, settings: { low: 100, weightLimit: 2000, newInactiveDays: 2 }, today: "2026-10-17", snapshotDate: "2026-10-17", previousDate: null, fullAccess: true,
});

test("dry and selling: on the out-of-stock list and dispatched recently, busiest first", () => {
  const out = outOfStock(desk([listing("A", [0, 0]), listing("B", [0, null]), listing("C", [5, 0]), listing("D", [0, 0])]));
  const dry = dryAndSelling(
    [
      { sku: "A", title: "a", disp: 5 },
      { sku: "A", title: "a", disp: 5 },
      { sku: "B", title: null, disp: 3 },
      { sku: "C", title: null, disp: 50 },
      { sku: "D", title: null, disp: 0 },
    ],
    out,
  );
  assert.deepEqual(dry.map((r) => [r.sku, r.disp]), [["A", 10], ["B", 3]]);
});

test("a SKU the stock sync does not record (FBF, delisted) is not called out of stock", () => {
  const dry = dryAndSelling([{ sku: "FBF-1", title: null, disp: 900 }], outOfStock(desk([listing("A", [10, 10])])));
  assert.deepEqual(dry, []);
});

test("inactive listings that sold are kept but marked, and never counted as 'of them' under the tile", () => {
  const data = desk([listing("A", [0, 0]), listing("VACMAP2", [0, 0], { status: "INACTIVE" }), listing("VAC1", [0, 0], { status: "INACTIVE" }), listing("OK", [50, 50])]);
  const dry = dryAndSelling(
    [
      { sku: "A", title: null, disp: 4 },
      { sku: "VACMAP2", title: null, disp: 2050 },
      { sku: "VAC1", title: null, disp: 1383 },
      { sku: "FBF-1", title: null, disp: 700 },
    ],
    outOfStock(data),
  );
  assert.deepEqual(dry.map((d) => [d.sku, d.inactive]), [["VACMAP2", true], ["VAC1", true], ["A", false]]);

  const tile = analyze(data, [0, 1], true).tiles.out;
  assert.equal(tile, 1, "the tile hides inactive listings");
  assert.ok(dry.filter((d) => !d.inactive).length <= tile, "'of them' is part of the tile's count");
  assert.equal(outOfStockSub(dry), "1 of them selling · 2 inactive listings sold recently");
});

test("the Out of stock tile's line: active sellers, inactive sellers, both or neither", () => {
  assert.equal(outOfStockSub([{ inactive: false }, { inactive: false }]), "2 of them selling");
  assert.equal(outOfStockSub([{ inactive: true }]), "1 inactive listing sold recently");
  assert.equal(outOfStockSub([]), "active listings with no units");
});
