// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildHealthRows,
  buildNeedsAction,
  buildPriceRows,
  buildReturnRates,
  computeCover,
  DEFAULT_FLIPKART_SETTINGS,
  isRed,
  bucketOf,
  ordersByWarehouse,
  packageIssues,
  pickList,
  shortBy,
  skuGroups,
  upcomingVsStock,
  readSalesRates,
  readStockDrops,
  returnHistoryReady,
  soonestBySku,
  urgency,
  type PendingOrder,
  type PriceInput,
} from "./flipkart-analysis.ts";
import type { DeskListing } from "./stock-analysis.ts";

const S = DEFAULT_FLIPKART_SETTINGS;
const NOW = new Date("2026-10-12T08:00:00Z"); // 13:30 IST on 12 Oct
const TODAY = "2026-10-12";
const at = (offsetHours: number) => new Date(NOW.getTime() + offsetHours * 3_600_000).toISOString();

// --- Prices ---------------------------------------------------------------------------------------------

const price = (over: Partial<PriceInput>): PriceInput => ({ sku: "A", title: null, status: "ACTIVE", mrp: 500, sellingPrice: 400, changes: [], ...over });

test("flags a selling price at or above MRP, and a missing price", () => {
  const rows = buildPriceRows(
    [price({ sku: "OK" }), price({ sku: "EQ", sellingPrice: 500 }), price({ sku: "OVER", sellingPrice: 600 }), price({ sku: "NONE", sellingPrice: null }), price({ sku: "ZERO", mrp: 0 })],
    S,
    TODAY,
  );
  const flags = Object.fromEntries(rows.map((r) => [r.sku, r.flags]));
  assert.deepEqual(flags.OK, []);
  assert.deepEqual(flags.EQ, ["over_mrp"]);
  assert.deepEqual(flags.OVER, ["over_mrp"]);
  assert.deepEqual(flags.NONE, ["missing"]);
  assert.deepEqual(flags.ZERO, ["missing"]);
  assert.equal(rows[0].discountPct, 20);
});

test("flags an overnight drop bigger than the setting, not a small one or an old one", () => {
  const change = (date: string, oldSelling: number, newSelling: number) => [{ date, oldMrp: 500, newMrp: 500, oldSelling, newSelling }];
  const rows = buildPriceRows(
    [
      price({ sku: "BIG", sellingPrice: 300, changes: change("2026-10-12", 400, 300) }), // 25%
      price({ sku: "EDGE", sellingPrice: 340, changes: change("2026-10-12", 400, 340) }), // exactly 15%: not above
      price({ sku: "SMALL", sellingPrice: 390, changes: change("2026-10-12", 400, 390) }),
      price({ sku: "OLD", sellingPrice: 300, changes: change("2026-10-09", 400, 300) }),
      price({ sku: "UP", sellingPrice: 450, changes: change("2026-10-12", 400, 450) }),
    ],
    S,
    TODAY,
  );
  const by = Object.fromEntries(rows.map((r) => [r.sku, r]));
  assert.ok(by.BIG.flags.includes("big_drop"));
  assert.equal(by.BIG.dropPct, 25);
  assert.ok(!by.EDGE.flags.includes("big_drop"));
  assert.ok(!by.SMALL.flags.includes("big_drop"));
  assert.ok(!by.OLD.flags.includes("big_drop"), "a drop from days ago is not overnight");
  assert.ok(!by.UP.flags.includes("big_drop"));
  const stricter = buildPriceRows([price({ sku: "EDGE", sellingPrice: 340, changes: change("2026-10-12", 400, 340) })], { ...S, priceDropPercent: 10 }, TODAY);
  assert.ok(stricter[0].flags.includes("big_drop"), "the setting is used");
});

// --- Listing health --------------------------------------------------------------------------------------

const box = { dimensions: { length: 10, breadth: 5, height: 2 }, weight: 0.4 };
const health = (over: Record<string, unknown>) => ({
  sku: "A", title: null, status: "ACTIVE", packages: [box], fulfillment: { dispatch_sla: 1 }, hsn: "3301", taxCode: "GST_5", taxRead: true, ...over,
});

test("package size and weight problems", () => {
  assert.deepEqual(packageIssues([box]), { noSize: false, noWeight: false });
  assert.deepEqual(packageIssues([]), { noSize: true, noWeight: true });
  assert.deepEqual(packageIssues(null), { noSize: true, noWeight: true });
  assert.deepEqual(packageIssues([{ dimensions: { length: 10, breadth: 0, height: 2 }, weight: 1 }]), { noSize: true, noWeight: false });
  assert.deepEqual(packageIssues([{ dimensions: { length: 10, breadth: 5, height: 2 }, weight: 0 }]), { noSize: false, noWeight: true });
  assert.deepEqual(packageIssues([{ dimensions: {}, weight: 1 }, box]), { noSize: false, noWeight: false }, "one good package is enough");
});

test("one row per SKU with its problems; healthy SKUs do not appear", () => {
  const rows = buildHealthRows(
    [
      health({ sku: "GOOD" }),
      health({ sku: "NOBOX", packages: [] }),
      health({ sku: "SLOW", fulfillment: { dispatch_sla: 3 } }),
      health({ sku: "EDGE", fulfillment: { dispatch_sla: 2 } }),
      health({ sku: " RATH2" }),
      health({ sku: "TRAIL " }),
      health({ sku: "NOHSN", hsn: null }),
      health({ sku: "NOTAX", taxCode: null }),
      health({ sku: "UNREAD", hsn: null, taxCode: null, taxRead: false }),
      health({ sku: "MANY", packages: [], fulfillment: { dispatch_sla: 5 }, hsn: null }),
    ],
    S,
  );
  const by = Object.fromEntries(rows.map((r) => [r.sku, r.problems]));
  assert.equal(by.GOOD, undefined);
  assert.deepEqual(by.NOBOX, ["no_size", "no_weight"]);
  assert.deepEqual(by.SLOW, ["slow_dispatch"]);
  assert.equal(by.EDGE, undefined, "an SLA equal to the setting is fine");
  assert.deepEqual(by[" RATH2"], ["sku_space"]);
  assert.deepEqual(by["TRAIL "], ["sku_space"]);
  assert.deepEqual(by.NOHSN, ["no_tax"]);
  assert.deepEqual(by.NOTAX, ["no_tax"]);
  assert.equal(by.UNREAD, undefined, "tax details that have not been read yet are not reported as missing");
  assert.deepEqual(by.MANY, ["no_size", "no_weight", "slow_dispatch", "no_tax"]);
});

// --- Days of cover -----------------------------------------------------------------------------------------------

const L = (sku: string, now: (number | null)[], status = "ACTIVE") => ({ sku, status, now });
const WH = [{ id: "w1" }, { id: "w2" }];

test("collecting data until there is history: nothing flagged, with the date it will be ready", () => {
  const sales = readSalesRates({ coverage_from: null, rows: [] });
  const drops = readStockDrops({ first_snapshot: "2026-10-12", last_snapshot: "2026-10-12", rows: [] });
  const r = computeCover({ listings: [L("A", [10, 10])], warehouses: WH, sales, drops, today: TODAY });
  assert.equal(r.state.state, "collecting");
  assert.equal(r.state.readyOn, "2026-10-19");
  assert.deepEqual(r.covers, []);
});

test("from real orders: the larger of the 7 and 14 day averages, once 7 days of orders are in", () => {
  const sales = readSalesRates({
    coverage_from: "2026-09-13",
    rows: [
      { sku: "A", wid: "w1", u7: 70, u14: 98 }, // 10/day and 7/day: uses 10
      { sku: "A", wid: "w2", u7: 7, u14: 70 }, // 1/day and 5/day: uses 5
    ],
  });
  const drops = readStockDrops({ first_snapshot: "2026-10-12", rows: [] });
  const r = computeCover({ listings: [L("A", [50, 50])], warehouses: WH, sales, drops, today: TODAY });
  assert.equal(r.state.state, "ready");
  const by = Object.fromEntries(r.covers.map((c) => [c.warehouseId, c]));
  assert.equal(by.w1.days, 5);
  assert.equal(by.w1.source, "orders");
  assert.equal(by.w2.days, 10);
  assert.deepEqual(soonestBySku(r.covers).A.warehouseId, "w1");
});

test("a partly loaded backfill is not trusted yet", () => {
  const sales = readSalesRates({ coverage_from: "2026-10-09", rows: [{ sku: "A", wid: "w1", u7: 70, u14: 70 }] });
  const r = computeCover({ listings: [L("A", [50, 50])], warehouses: WH, sales, drops: readStockDrops(null), today: TODAY });
  assert.equal(r.state.state, "collecting");
});

test("a SKU with no orders falls back to stock drops (restock days already left out by the database)", () => {
  const sales = readSalesRates({ coverage_from: "2026-09-13", rows: [{ sku: "A", wid: "w1", u7: 7, u14: 14 }] });
  const drops = readStockDrops({
    first_snapshot: "2026-10-01",
    rows: [{ sku: "B", wid: "w1", lost7: 30, days7: 3, lost14: 30, days14: 3 }],
  });
  const r = computeCover({ listings: [L("A", [10, null]), L("B", [100, 0]), L("C", [100, 100])], warehouses: WH, sales, drops, today: TODAY });
  const b = r.covers.find((c) => c.sku === "B");
  assert.equal(b?.source, "stock");
  assert.equal(b?.rate, 10);
  assert.equal(b?.days, 10);
  assert.ok(!r.covers.some((c) => c.sku === "C"), "no orders and no drops: no rate, nothing to say");
  assert.ok(!r.covers.some((c) => c.sku === "B" && c.warehouseId === "w2"), "an empty warehouse has no cover to count");
  assert.equal(r.covers.find((c) => c.sku === "A")?.source, "orders");
});

test("inactive listings and unlisted warehouses are left out", () => {
  const sales = readSalesRates({ coverage_from: "2026-09-13", rows: [{ sku: "A", wid: "w1", u7: 7, u14: 14 }] });
  const r = computeCover({ listings: [L("A", [10, 10], "INACTIVE")], warehouses: WH, sales, drops: readStockDrops(null), today: TODAY });
  assert.deepEqual(r.covers, []);
});

// --- Return rates ------------------------------------------------------------------------------------------------

test("return rate = returns / units sold, flagged above the setting once enough was sold and history is ready", () => {
  const data = [
    { sku: "HIGH", sold: 40, returned: 8 },
    { sku: "LOW", sold: 100, returned: 5 },
    { sku: "TINY", sold: 3, returned: 2 },
    { sku: "ZERO", sold: 0, returned: 1 },
  ];
  const ready = Object.fromEntries(buildReturnRates(data, S, true).map((r) => [r.sku, r]));
  assert.equal(ready.HIGH.ratePct, 20);
  assert.ok(ready.HIGH.flagged);
  assert.ok(!ready.LOW.flagged);
  assert.ok(!ready.TINY.flagged, "too few units to judge");
  assert.equal(ready.ZERO.ratePct, null);
  const early = Object.fromEntries(buildReturnRates(data, S, false).map((r) => [r.sku, r]));
  assert.equal(early.HIGH.ratePct, null, "no rate until 30 days of orders are in");
  assert.ok(!early.HIGH.flagged);
  assert.equal(early.HIGH.returned, 8, "but the returns are still counted");
  assert.equal(returnHistoryReady("2026-09-13", TODAY), true);
  assert.equal(returnHistoryReady("2026-09-20", TODAY), false);
  assert.equal(returnHistoryReady(null, TODAY), false);
});

// --- Orders --------------------------------------------------------------------------------------------------------

const order = (over: Partial<PendingOrder>): PendingOrder => ({
  orderItemId: "i", orderId: "o", shipmentId: null, sku: "A", quantity: 1, warehouseId: "w1", status: "APPROVED", hold: false, dispatchBy: at(5), dispatchAfter: at(-20), ...over,
});

test("Seller Hub tabs: Active (To Accept, To Pack, To Dispatch) by dispatch-after, Upcoming, Under Processing", () => {
  assert.equal(bucketOf({ status: "APPROVED", dispatchAfter: at(-1) }, NOW), "to_accept");
  assert.equal(bucketOf({ status: "FORM_FAILED", dispatchAfter: null }, NOW), "to_accept");
  assert.equal(bucketOf({ status: "PACKED", dispatchAfter: at(-1) }, NOW), "to_pack");
  assert.equal(bucketOf({ status: "READY_TO_DISPATCH", dispatchAfter: at(-1) }, NOW), "to_dispatch");
  assert.equal(bucketOf({ status: "APPROVED", dispatchAfter: at(30) }, NOW), "upcoming", "dispatch-after in the future is Upcoming");
  assert.equal(bucketOf({ status: "PACKED", dispatchAfter: at(30) }, NOW), "upcoming");
  assert.equal(bucketOf({ status: "PACKING_IN_PROGRESS", dispatchAfter: at(-1) }, NOW), "processing");
  assert.equal(bucketOf({ status: "PACKING_IN_PROGRESS", dispatchAfter: at(30) }, NOW), "processing", "Under Processing whatever its date");
  assert.equal(bucketOf({ status: "CANCELLED", dispatchAfter: null }, NOW), null);
  assert.equal(bucketOf({ status: null, dispatchAfter: null }, NOW), null);
});

test("urgency", () => {
  assert.equal(urgency(at(-1), NOW), "late");
  assert.equal(urgency(at(2), NOW), "today");        // 15:30 IST
  assert.equal(urgency(at(12), NOW), "tomorrow");    // 01:30 IST the next day
  assert.equal(urgency(at(60), NOW), "later");
  assert.equal(urgency(null, NOW), "none");
  assert.equal(urgency("garbage", NOW), "none");
  assert.ok(isRed("late") && isRed("today") && !isRed("tomorrow"));
});

test("counts shipments per warehouse in Seller Hub's tabs; lateness only for Active orders not on hold", () => {
  const wh = [{ id: "w1", name: "Delhi" }, { id: "w2", name: "Pune" }];
  const rows = ordersByWarehouse(
    [
      order({ orderItemId: "1", orderId: "A", shipmentId: "S1", status: "APPROVED", dispatchBy: at(-3) }),
      order({ orderItemId: "2", orderId: "A", shipmentId: "S1", status: "APPROVED", dispatchBy: at(-3) }), // same shipment, second item
      order({ orderItemId: "2b", orderId: "A", shipmentId: "S1b", status: "APPROVED", dispatchBy: at(-3) }), // same order, another shipment
      order({ orderItemId: "3", orderId: "B", status: "PACKED", dispatchBy: at(2) }),
      order({ orderItemId: "4", orderId: "C", status: "READY_TO_DISPATCH", dispatchBy: at(12) }),
      order({ orderItemId: "5", orderId: "D", status: "APPROVED", hold: true, dispatchBy: at(-9) }),
      order({ orderItemId: "6", orderId: "E", status: "PACKING_IN_PROGRESS", dispatchBy: at(-5) }),
      order({ orderItemId: "7", orderId: "F", status: "APPROVED", dispatchAfter: at(40), dispatchBy: at(70) }),
      order({ orderItemId: "8", orderId: "G", status: "CANCELLED" }),
      order({ orderItemId: "9", orderId: "H", warehouseId: null }),
      order({ orderItemId: "10", orderId: "I", warehouseId: "w2", status: "APPROVED", dispatchBy: at(70) }),
    ],
    wh,
    NOW,
    { w1: 12 },
  );
  const delhi = rows.find((r) => r.name === "Delhi");
  assert.deepEqual([delhi?.to_accept, delhi?.to_pack, delhi?.to_dispatch, delhi?.active], [3, 1, 1, 5], "To Accept counts shipments: S1, S1b and the held one");
  assert.deepEqual([delhi?.upcoming, delhi?.processing, delhi?.inTransit, delhi?.held], [1, 1, 12, 1]);
  assert.deepEqual([delhi?.late, delhi?.today, delhi?.tomorrow], [2, 1, 1], "Under Processing and Upcoming are never late; a hold is not late");
  assert.equal(delhi?.nextDue, at(-3), "neither a hold nor Under Processing sets the next deadline");
  assert.equal(rows.find((r) => r.name === "Pune")?.to_accept, 1);
  assert.equal(rows.find((r) => r.name === "Unknown warehouse")?.active, 1);
});

const STOCK = { A: { title: "Steel bottle", units: { w1: 3, w2: 50 } }, B: { title: null, units: { w1: 10, w2: null } } };

test("orders grouped by SKU: units per warehouse, earliest dispatch-by, counts per tab", () => {
  const groups = skuGroups(
    [
      order({ orderItemId: "1", sku: "A", quantity: 2, warehouseId: "w1", dispatchBy: at(30) }),
      order({ orderItemId: "2", sku: "A", quantity: 1, warehouseId: "w2", status: "PACKED", dispatchBy: at(-1) }),
      order({ orderItemId: "3", sku: "A", quantity: 1, warehouseId: "w2", status: "READY_TO_DISPATCH", hold: true, dispatchBy: at(-9) }),
      order({ orderItemId: "4", sku: "B", quantity: 5, warehouseId: "w1", dispatchBy: at(3) }),
      order({ orderItemId: "5", sku: "B", status: "CANCELLED" }),
    ],
    NOW,
  );
  assert.deepEqual(groups.map((g) => g.sku), ["A", "B"], "most urgent first");
  const a = groups[0];
  assert.deepEqual([a.orderCount, a.units, a.unitsByWarehouse.w1, a.unitsByWarehouse.w2], [3, 4, 2, 2]);
  assert.equal(a.earliestDue, at(-1), "a hold does not set the earliest dispatch-by");
  assert.equal(skuGroups([order({ status: "PACKING_IN_PROGRESS", dispatchBy: at(-3) })], NOW)[0].earliestActiveDue, null, "Under Processing can never be late");
  assert.deepEqual([a.counts.to_accept, a.counts.to_pack, a.counts.to_dispatch], [1, 1, 1]);
  assert.equal(groups[1].orders.length, 1, "a cancelled item is left out");
  assert.equal(shortBy(a.unitsByWarehouse.w1, STOCK.A.units.w1), 0);
  assert.equal(shortBy(5, 3), 2);
  assert.equal(shortBy(5, null), 0, "unknown stock is never short");
});

test("pick list: units still to pack at one warehouse, due today or late, or every Active order", () => {
  const orders = [
    order({ orderItemId: "1", sku: "A", quantity: 2, dispatchBy: at(2) }),                       // To Accept, today
    order({ orderItemId: "2", sku: "A", quantity: 1, status: "PACKED", dispatchBy: at(-2) }),     // To Pack, late
    order({ orderItemId: "3", sku: "A", quantity: 4, status: "READY_TO_DISPATCH", dispatchBy: at(2) }), // packed already
    order({ orderItemId: "4", sku: "B", quantity: 3, dispatchBy: at(30) }),                      // tomorrow
    order({ orderItemId: "5", sku: "B", quantity: 9, dispatchAfter: at(10), dispatchBy: at(40) }), // Upcoming
    order({ orderItemId: "6", sku: "A", quantity: 7, warehouseId: "w2", dispatchBy: at(2) }),     // other warehouse
    order({ orderItemId: "7", sku: "A", quantity: 1, status: "PACKING_IN_PROGRESS", dispatchBy: at(2) }),
  ];
  const today = pickList(orders, "w1", NOW, STOCK, TODAY);
  assert.deepEqual(today.map((r) => [r.sku, r.units, r.toAccept, r.toPack, r.orders, r.stock, r.title]), [["A", 3, 2, 1, 2, 3, "Steel bottle"]]);
  const all = pickList(orders, "w1", NOW, STOCK, null);
  assert.deepEqual(all.map((r) => [r.sku, r.units]).sort(), [["A", 3], ["B", 3]]);
});

test("upcoming vs stock: upcoming units per SKU and warehouse against stock, shortfalls first", () => {
  const rows = upcomingVsStock(
    [
      order({ orderItemId: "1", sku: "B", quantity: 4, dispatchAfter: at(20) }),
      order({ orderItemId: "2", sku: "A", quantity: 2, dispatchAfter: at(30) }),
      order({ orderItemId: "3", sku: "A", quantity: 3, dispatchAfter: at(10) }),
      order({ orderItemId: "4", sku: "A", quantity: 6 }), // Active: context only
      order({ orderItemId: "5", sku: "A", quantity: 1, warehouseId: "w2", dispatchAfter: at(10) }),
    ],
    NOW,
    STOCK,
  );
  assert.deepEqual(rows.map((r) => [r.sku, r.warehouseId, r.upcoming, r.stock, r.short, r.active]), [
    ["A", "w1", 5, 3, 2, 6],
    ["A", "w2", 1, 50, 0, 0], // then the soonest to become Active
    ["B", "w1", 4, 10, 0, 0],
  ]);
  assert.equal(rows[0].firstActive, at(10));
});

// --- Needs action ----------------------------------------------------------------------------------------------------

const listing = (sku: string, now: (number | null)[], over: Partial<DeskListing> = {}): DeskListing => ({
  sku, title: null, status: "ACTIVE", listingId: null, inactiveSince: null, beforeTracking: false, dims: null, now, prev: now.map(() => null), prevStatus: null, ...over,
});
const LINKS = { sellerHubOrders: "https://hub.test/orders", sellerHubListings: "https://hub.test/listings" };
const baseInput = {
  now: NOW,
  staff: true,
  warehouses: [{ id: "w1", name: "Delhi" }, { id: "w2", name: "Pune" }],
  orders: [] as PendingOrder[],
  listings: [] as DeskListing[],
  settings: { ...S, newInactiveDays: 2 },
  priceRows: [],
  returnRates: [],
  covers: [],
  newInactive: [],
};

test("needs action: orders about to miss dispatch, most urgent first, with a link to Seller Hub", () => {
  const sections = buildNeedsAction(
    {
      ...baseInput,
      orders: [
        order({ orderId: "A", warehouseId: "w2", dispatchBy: at(2) }),
        order({ orderId: "B", warehouseId: "w1", dispatchBy: at(-2) }),
        order({ orderId: "C", warehouseId: "w1", dispatchBy: at(70) }),
        order({ orderItemId: "P", orderId: "P", warehouseId: "w1", status: "PACKING_IN_PROGRESS", dispatchBy: at(-5) }),
        order({ orderItemId: "U", orderId: "U", warehouseId: "w2", dispatchAfter: at(1), dispatchBy: at(-1) }),
      ],
    },
    LINKS,
  );
  const s = sections.find((x) => x.key === "orders");
  assert.ok(s);
  assert.deepEqual(s.rows.map((r) => r.title), ["Delhi: 1 late", "Pune: 1 due today"], "Under Processing and Upcoming orders are left out");
  assert.ok(s.rows[0].actions.some((a) => a.external && a.href === "https://hub.test/orders"));
});

test("needs action: a SKU empty at a warehouse with orders waiting for it", () => {
  const sections = buildNeedsAction(
    {
      ...baseInput,
      listings: [listing("A", [0, 50]), listing("B", [20, 0])],
      orders: [order({ sku: "A", warehouseId: "w1", orderItemId: "1", quantity: 2 }), order({ sku: "A", warehouseId: "w1", orderItemId: "2" }), order({ sku: "B", warehouseId: "w1", orderItemId: "3" }), order({ sku: "A", warehouseId: "w2", orderItemId: "4" }), order({ sku: "A", warehouseId: "w1", orderItemId: "5", quantity: 9, status: "PACKING_IN_PROGRESS" })],
    },
    LINKS,
  );
  const s = sections.find((x) => x.key === "empty");
  assert.ok(s);
  assert.equal(s.rows.length, 1, "only A at Delhi: B has stock at Delhi, and A has stock at Pune");
  assert.match(s.rows[0].detail, /0 units at Delhi, 2 orders waiting \(3 units\)/);
  assert.ok(s.rows[0].actions[0].href.startsWith("/posts/new?type=restock&sku=A&warehouse="));
});

test("needs action: staff-only sections stay out for a warehouse user", () => {
  const priceRows = buildPriceRows([price({ sku: "P", sellingPrice: 600 })], S, TODAY);
  const input = { ...baseInput, priceRows, newInactive: [listing("X", [0, 0], { status: "INACTIVE", inactiveSince: "2026-10-12" })] };
  const staff = buildNeedsAction(input, LINKS).map((s) => s.key);
  assert.deepEqual(staff, ["prices", "inactive"]);
  const warehouse = buildNeedsAction({ ...input, staff: false }, LINKS).map((s) => s.key);
  assert.deepEqual(warehouse, []);
});

test("needs action: high return rates and running out soon", () => {
  const sections = buildNeedsAction(
    {
      ...baseInput,
      returnRates: buildReturnRates([{ sku: "R", sold: 50, returned: 10 }], S, true),
      covers: [
        { sku: "Q", warehouseId: "w1", units: 20, rate: 10, days: 2, source: "orders" },
        { sku: "Q2", warehouseId: "w1", units: 60, rate: 10, days: 6, source: "stock" },
        { sku: "FINE", warehouseId: "w1", units: 100, rate: 10, days: 10, source: "orders" },
      ],
    },
    LINKS,
  );
  assert.deepEqual(sections.map((s) => s.key), ["returns", "running"]);
  assert.match(sections[0].rows[0].detail, /20% returned: 10 of 50 units/);
  assert.match(sections[0].rows[0].actions[0].href, /issue=wrong_return/);
  assert.deepEqual(sections[1].rows.map((r) => r.title), ["Q", "Q2"], "soonest first, and not the one with plenty of cover");
});

test("needs action is empty when nothing is wrong", () => {
  assert.deepEqual(buildNeedsAction(baseInput, LINKS), []);
});
