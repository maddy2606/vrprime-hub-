// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { csvCell, toCsv } from "./csv.ts";
import {
  analyze,
  buildRows,
  daysBetween,
  isNewInactive,
  pickDims,
  restockHref,
  restockWarehouse,
  searchRows,
  sortRows,
  warehouseCards,
  weightMetric,
  type DeskData,
  type DeskListing,
} from "./stock-analysis.ts";

// Three warehouses: Bangalore (0), Delhi (1), Kolkata (2). Low-stock setting 100.
const WAREHOUSES = [
  { id: "w-blr", name: "Bangalore" },
  { id: "w-del", name: "Delhi" },
  { id: "w-kol", name: "Kolkata" },
];

function listing(sku: string, now: (number | null)[], over: Partial<DeskListing> = {}): DeskListing {
  return {
    sku,
    title: `Fake ${sku}`,
    status: "ACTIVE",
    listingId: `L-${sku}`,
    inactiveSince: null,
    beforeTracking: false,
    dims: null,
    now,
    prev: [null, null, null],
    prevStatus: null,
    ...over,
  };
}

function data(listings: DeskListing[], over: Partial<DeskData> = {}): DeskData {
  return {
    warehouses: WAREHOUSES,
    listings,
    settings: { low: 100, weightLimit: 2000, newInactiveDays: 2 },
    today: "2026-10-12",
    snapshotDate: "2026-10-12",
    previousDate: "2026-10-11",
    fullAccess: true,
    ...over,
  };
}

const ALL = [0, 1, 2];

test("classifies each warehouse as empty, low or ok, and a dash is not listed", () => {
  const [row] = buildRows(data([listing("A", [0, 40, 500])]), ALL);
  assert.deepEqual(row.empty, [0]);
  assert.deepEqual(row.low, [1]);
  assert.deepEqual(row.ok, [2]);
  assert.equal(row.total, 540);

  const [partial] = buildRows(data([listing("B", [100, null, 99])]), ALL);
  assert.deepEqual(partial.listed, [0, 2]);
  assert.deepEqual(partial.ok, [0], "exactly the setting counts as ok");
  assert.deepEqual(partial.low, [2], "one under the setting is low");
});

test("low stock: still has stock somewhere, but is empty or low at a warehouse", () => {
  const d = data([
    listing("EMPTY-SOMEWHERE", [0, 500, 500]),
    listing("LOW-SOMEWHERE", [40, 500, 500]),
    listing("ALL-GOOD", [200, 300, 400]),
    listing("NOTHING-ANYWHERE", [0, 0, 0]),
    listing("NOT-LISTED", [null, null, null]),
  ]);
  const a = analyze(d, ALL, false);
  assert.deepEqual(a.low.map((r) => r.sku).sort(), ["EMPTY-SOMEWHERE", "LOW-SOMEWHERE"]);
  assert.deepEqual(a.out.map((r) => r.sku).sort(), ["NOT-LISTED", "NOTHING-ANYWHERE"], "fully empty and unlisted SKUs are out of stock, not low");
  assert.equal(a.tiles.low, 2);
  assert.equal(a.tiles.out, 2);
});

test("looking at one warehouse only judges that warehouse and drops SKUs not listed there", () => {
  const d = data([
    listing("A", [0, 500, 500]),
    listing("B", [30, 500, 500]),
    listing("C", [null, 500, 500]),
  ]);
  const a = analyze(d, [0], false);
  assert.deepEqual(a.rows.map((r) => r.sku), ["A", "B"], "C is not listed in Bangalore");
  assert.deepEqual(a.out.map((r) => r.sku), ["A"], "empty in Bangalore = out of stock there");
  assert.deepEqual(a.low.map((r) => r.sku), ["B"]);
});

test("a warehouse user (not full access) never sees SKUs that are not at their warehouses", () => {
  const d = data([listing("MINE", [10, null, null]), listing("NOT-MINE", [null, null, null])], { fullAccess: false });
  const a = analyze(d, [0], false);
  assert.deepEqual(a.rows.map((r) => r.sku), ["MINE"]);
});

test("units in stock count active listings only, with the change since the snapshot before", () => {
  const d = data([
    listing("A", [100, 50, null], { prev: [80, 50, null], prevStatus: "ACTIVE" }),
    listing("B", [10, 0, 5], { prev: [20, 0, 5], prevStatus: "ACTIVE" }),
    listing("C", [999, 0, 0], { status: "INACTIVE", prev: [900, 0, 0], prevStatus: "INACTIVE" }),
    listing("D", [30, null, null], { prev: [null, null, null], prevStatus: null }),
  ]);
  const a = analyze(d, ALL, false);
  assert.equal(a.tiles.units, 150 + 15 + 30);
  assert.equal(a.tiles.unitsChange, 195 - (130 + 25 + 0));

  const noPrevious = analyze(data(d.listings, { previousDate: null }), ALL, false);
  assert.equal(noPrevious.tiles.unitsChange, null);
});

test("a listing that was inactive yesterday does not count as lost stock when it comes back active", () => {
  const d = data([listing("A", [100, 0, 0], { prev: [100, 0, 0], prevStatus: "INACTIVE" })]);
  const a = analyze(d, ALL, false);
  assert.equal(a.tiles.unitsChange, 100, "yesterday it was inactive, so it was not in yesterday's active total");
});

test("hiding inactive listings quiets the lists and the counts but not the inactive views", () => {
  const d = data([
    listing("ACTIVE-LOW", [10, 500, 500]),
    listing("INACTIVE-LOW", [10, 500, 500], { status: "INACTIVE", inactiveSince: "2026-10-12" }),
    listing("INACTIVE-OUT", [0, 0, 0], { status: "INACTIVE", inactiveSince: "2026-10-01", beforeTracking: true }),
  ]);
  const shown = analyze(d, ALL, false);
  assert.equal(shown.tiles.low, 2);
  assert.equal(shown.tiles.out, 1);
  const hidden = analyze(d, ALL, true);
  assert.equal(hidden.tiles.low, 1);
  assert.equal(hidden.tiles.out, 0);
  assert.equal(hidden.allInactive.length, 2);
  assert.equal(hidden.newInactive.length, 1);
});

test("new inactive: went inactive within the setting, and not before tracking began", () => {
  const today = "2026-10-12";
  const make = (status: string, since: string | null, before: boolean) => ({ status, inactiveSince: since, beforeTracking: before });
  assert.equal(isNewInactive(make("INACTIVE", "2026-10-12", false), today, 2), true);
  assert.equal(isNewInactive(make("INACTIVE", "2026-10-10", false), today, 2), true, "exactly 2 days ago still counts");
  assert.equal(isNewInactive(make("INACTIVE", "2026-10-09", false), today, 2), false);
  assert.equal(isNewInactive(make("INACTIVE", "2026-10-12", true), today, 2), false, "before tracking is never new");
  assert.equal(isNewInactive(make("ACTIVE", null, false), today, 2), false);
  assert.equal(isNewInactive(make("INACTIVE", null, false), today, 2), false);
  assert.equal(daysBetween("2026-09-30", "2026-10-02"), 2);
});

test("weight alert: L x B x H in cm plus weight in grams, over the limit", () => {
  assert.deepEqual(weightMetric({ l: 10, b: 10, h: 10, kg: 1.5 }), { volume: 1000, grams: 1500, total: 2500 });
  const d = data([
    listing("HEAVY", [5, 5, 5], { dims: { l: 10, b: 10, h: 10, kg: 1.5 } }),
    listing("EXACTLY", [5, 5, 5], { dims: { l: 10, b: 10, h: 10, kg: 1 } }),
    listing("LIGHT", [5, 5, 5], { dims: { l: 5, b: 5, h: 5, kg: 0.2 } }),
    listing("NO-SIZE", [5, 5, 5], { dims: null }),
  ]);
  const a = analyze(d, ALL, false);
  assert.deepEqual(a.weight.map((r) => r.sku), ["HEAVY"], "exactly the limit is not over it");
  assert.equal(a.weight[0].overBy, 500);
  // The limit is a setting: at 1000 the 2000 one is over as well, the light one (325) still is not.
  const stricter = data(d.listings, { settings: { low: 100, weightLimit: 1000, newInactiveDays: 2 } });
  assert.deepEqual(analyze(stricter, ALL, false).weight.map((r) => r.sku).sort(), ["EXACTLY", "HEAVY"]);
});

test("picks the package to judge: ignores incomplete ones, takes the heaviest", () => {
  assert.equal(pickDims(null), null);
  assert.equal(pickDims([]), null);
  assert.equal(pickDims([{ dimensions: { length: 10, breadth: null, height: 5 }, weight: 1 }]), null, "missing breadth means skip");
  assert.equal(pickDims([{ dimensions: { length: 0, breadth: 5, height: 5 }, weight: 1 }]), null, "a zero size counts as missing");
  assert.deepEqual(pickDims([{ dimensions: { length: 10, breadth: 5, height: 2 }, weight: null }]), { l: 10, b: 5, h: 2, kg: 0 });
  assert.deepEqual(
    pickDims([
      { dimensions: { length: 2, breadth: 2, height: 2 }, weight: 0.1 },
      { dimensions: { length: 10, breadth: 10, height: 10 }, weight: 0.5 },
      { dimensions: { length: 5, breadth: null, height: 5 }, weight: 99 },
    ]),
    { l: 10, b: 10, h: 10, kg: 0.5 },
  );
});

test("warehouse cards: units of active listings, share, and how many SKUs are empty or low", () => {
  const d = data([
    listing("A", [0, 300, null]),
    listing("B", [50, 100, 100]),
    listing("C", [1000, 0, 0], { status: "INACTIVE" }),
  ]);
  const cards = warehouseCards(d, false);
  assert.deepEqual(cards.map((c) => c.units), [50, 400, 100], "inactive C's units are not counted");
  assert.equal(Math.round(cards[1].share * 100), 73);
  assert.deepEqual(cards.map((c) => c.empty), [1, 1, 1]);
  assert.deepEqual(cards.map((c) => c.low), [1, 0, 0]);
  assert.deepEqual(warehouseCards(d, true).map((c) => c.empty), [1, 0, 0], "hiding inactive drops C from the counts");
});

test("restock goes to the emptiest warehouse, and the link carries the SKU and warehouse", () => {
  const d = data([listing("A", [300, 20, 0])]);
  const [row] = buildRows(d, ALL);
  assert.equal(restockWarehouse(row, d, ALL), "w-kol");
  assert.equal(restockWarehouse(row, d, [0, 1]), "w-del");
  const unlisted = buildRows(data([listing("B", [null, null, null])]), ALL)[0];
  assert.equal(restockWarehouse(unlisted, d, ALL), null);
  assert.equal(restockWarehouse(unlisted, d, [1]), "w-del", "with one warehouse chosen, restock there");
  assert.equal(restockHref("SKU 1/A", "w-kol"), "/posts/new?type=restock&sku=SKU+1%2FA&warehouse=w-kol");
  assert.equal(restockHref("X", null), "/posts/new?type=restock&sku=X");
});

test("sorts numbers and text, empty values last, ties by SKU", () => {
  const rows = [
    { sku: "B", n: 5 as number | null },
    { sku: "A", n: 5 as number | null },
    { sku: "C", n: null as number | null },
    { sku: "D", n: 9 as number | null },
  ];
  assert.deepEqual(sortRows(rows, (r) => r.n, "desc").map((r) => r.sku), ["D", "A", "B", "C"]);
  assert.deepEqual(sortRows(rows, (r) => r.n, "asc").map((r) => r.sku), ["A", "B", "D", "C"]);
  const text = [{ sku: "x10" }, { sku: "x2" }, { sku: "x1" }];
  assert.deepEqual(sortRows(text, (r) => r.sku, "asc").map((r) => r.sku), ["x1", "x2", "x10"], "numbers inside text sort naturally");
});

test("search finds part of a SKU or title, ignoring case", () => {
  const rows = [
    { sku: "ABC-1", title: "Steel Bottle" },
    { sku: "XYZ-2", title: null },
  ];
  assert.deepEqual(searchRows(rows, "bottle").map((r) => r.sku), ["ABC-1"]);
  assert.deepEqual(searchRows(rows, " xyz ").map((r) => r.sku), ["XYZ-2"]);
  assert.equal(searchRows(rows, "").length, 2);
});

test("CSV quoting, and a guard against spreadsheet formulas", () => {
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell('say "hi", ok'), '"say ""hi"", ok"');
  assert.equal(csvCell("line\nbreak"), '"line\nbreak"');
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(-5), "-5", "a real number stays a number");
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvCell("-2+3"), "'-2+3");
  assert.equal(csvCell("@sum"), "'@sum");
  assert.equal(toCsv(["SKU", "Units"], [["A", 1], ["B", null]]), "SKU,Units\r\nA,1\r\nB,\r\n");
});
