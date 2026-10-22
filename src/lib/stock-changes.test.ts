// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import type { DeskData, DeskListing } from "./stock-analysis.ts";
import { stockChanges } from "./stock-changes.ts";

// Two warehouses: Bangalore (0), Delhi (1).
const WAREHOUSES = [
  { id: "w-blr", name: "Bangalore" },
  { id: "w-del", name: "Delhi" },
];

function listing(sku: string, prev: (number | null)[], now: (number | null)[], over: Partial<DeskListing> = {}): DeskListing {
  return { sku, title: `Title ${sku}`, status: "ACTIVE", listingId: null, inactiveSince: null, beforeTracking: false, dims: null, now, prev, prevStatus: "ACTIVE", ...over };
}

function desk(listings: DeskListing[], previousDate: string | null = "2026-10-21"): Pick<DeskData, "warehouses" | "listings" | "previousDate"> {
  return { warehouses: WAREHOUSES, listings, previousDate };
}

test("a SKU that had units and now has 0 at a warehouse stocked out there", () => {
  const changes = stockChanges(desk([listing("A", [12, 5], [0, 5])]));
  assert.deepEqual(changes, [{ sku: "A", title: "Title A", status: "ACTIVE", warehouseId: "w-blr", kind: "out", before: 12, after: 0 }]);
});

test("a SKU that had 0 and now has units at a warehouse is back in stock there", () => {
  const changes = stockChanges(desk([listing("B", [3, 0], [3, 40])]));
  assert.deepEqual(changes, [{ sku: "B", title: "Title B", status: "ACTIVE", warehouseId: "w-del", kind: "in", before: 0, after: 40 }]);
});

test("each warehouse counts on its own: one SKU can stock out at one and come back at another", () => {
  const changes = stockChanges(desk([listing("C", [8, 0], [0, 2])]));
  assert.deepEqual(
    changes.map((c) => [c.warehouseId, c.kind]),
    [
      ["w-blr", "out"],
      ["w-del", "in"],
    ],
  );
});

test("no change, still 0, a drop that is not to 0, and a rise from more than 0 are all left out", () => {
  const changes = stockChanges(desk([listing("D", [5, 0], [5, 0]), listing("E", [50, 9], [1, 30])]));
  assert.deepEqual(changes, []);
});

test("a warehouse where the SKU was not listed in one of the two reads is neither stocked out nor back in stock", () => {
  const changes = stockChanges(desk([listing("F", [null, 7], [0, null]), listing("G", [0, null], [null, 4])]));
  assert.deepEqual(changes, []);
});

test("with no read before there is nothing to compare", () => {
  assert.deepEqual(stockChanges(desk([listing("H", [null, null], [0, 0])], null)), []);
});

test("inactive listings are kept, with their status", () => {
  const [change] = stockChanges(desk([listing("I", [4, 0], [0, 0], { status: "INACTIVE" })]));
  assert.equal(change.status, "INACTIVE");
  assert.equal(change.kind, "out");
});

test("sorted by warehouse, then stocked out before back in stock, then by SKU in natural order", () => {
  const changes = stockChanges(
    desk([
      listing("SKU-10", [0, 6], [9, 0]),
      listing("SKU-2", [0, 0], [1, 2]),
      listing("SKU-1", [5, 0], [0, 3]),
    ]),
  );
  assert.deepEqual(
    changes.map((c) => `${c.warehouseId} ${c.kind} ${c.sku}`),
    ["w-blr out SKU-1", "w-blr in SKU-2", "w-blr in SKU-10", "w-del out SKU-10", "w-del in SKU-1", "w-del in SKU-2"],
  );
});
