import assert from "node:assert/strict";
import { test } from "node:test";
import { claimCounts, claimTicketHref, daysLeftChip, DEFAULT_CLAIM_FILTERS, filterClaims, readClaimRows, weekStart, type ClaimRow } from "./return-claims.ts";

const row = (id: string, daysLeft: number, extra: Partial<ClaimRow> = {}): ClaimRow => ({
  returnId: id,
  orderItemId: `${id}-1`,
  orderId: `OD${id}`,
  sku: `SKU-${id}`,
  source: "customer_return",
  reason: "Damaged",
  subReason: null,
  quantity: 1,
  warehouseId: "w1",
  returnedOn: "2026-11-10",
  daysLeft,
  ...extra,
});

test("reads the database rows and skips broken ones", () => {
  const rows = readClaimRows([
    { return_id: "R1", order_item_id: "I1", returned_on: "2026-11-12", source: "courier_return", days_left: 3, quantity: "2", sku: "A" },
    { return_id: "R2", order_item_id: "I2", returned_on: "2026-11-12", source: "something else", days_left: 3 },
    { order_item_id: "I3" },
    null,
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, 2);
  assert.equal(rows[0].source, "courier_return");
  assert.deepEqual(readClaimRows(null), []);
});

test("counts: to check is 0 or more days left, closing is 0 or 1, missed is below 0", () => {
  const rows = [row("a", 0), row("b", 1), row("c", 2), row("d", 7), row("e", -1), row("f", -5)];
  assert.deepEqual(claimCounts(rows), { toCheck: 4, closing: 2, missed: 2 });
});

test("days left chip: bad at 0 or 1, warn at 2 or 3, neutral above, Missed below 0", () => {
  assert.deepEqual(daysLeftChip(0), { tone: "bad", label: "Today" });
  assert.deepEqual(daysLeftChip(1), { tone: "bad", label: "1 day" });
  assert.equal(daysLeftChip(2).tone, "warn");
  assert.equal(daysLeftChip(3).tone, "warn");
  assert.equal(daysLeftChip(4).tone, "neutral");
  assert.deepEqual(daysLeftChip(-1), { tone: "bad", label: "Missed" });
});

test("filters by view, warehouse, type and search, and sorts by days left, fewest first", () => {
  const rows = [row("a", 5), row("b", 0, { warehouseId: "w2" }), row("c", 2, { source: "courier_return", sku: "LIZARD-1" }), row("d", -2)];
  assert.deepEqual(filterClaims(rows, DEFAULT_CLAIM_FILTERS).map((r) => r.returnId), ["b", "c", "a"]);
  assert.deepEqual(filterClaims(rows, { ...DEFAULT_CLAIM_FILTERS, view: "missed" }).map((r) => r.returnId), ["d"]);
  assert.deepEqual(filterClaims(rows, { ...DEFAULT_CLAIM_FILTERS, wh: "w2" }).map((r) => r.returnId), ["b"]);
  assert.deepEqual(filterClaims(rows, { ...DEFAULT_CLAIM_FILTERS, source: "courier_return" }).map((r) => r.returnId), ["c"]);
  assert.deepEqual(filterClaims(rows, { ...DEFAULT_CLAIM_FILTERS, q: "lizard" }).map((r) => r.returnId), ["c"]);
});

test("the week starts on Monday", () => {
  assert.equal(weekStart("2026-11-16"), "2026-11-16"); // a Monday
  assert.equal(weekStart("2026-11-22"), "2026-11-16"); // the Sunday after
  assert.equal(weekStart("2026-11-15"), "2026-11-09"); // a Sunday
});

test("the ticket link carries the Returns tab's parameters plus the return and item", () => {
  const href = claimTicketHref("SKU 1", "R9", "I9");
  const p = new URL(href, "http://x").searchParams;
  assert.equal(p.get("platform"), "flipkart");
  assert.equal(p.get("issue"), "wrong_return");
  assert.equal(p.get("sku"), "SKU 1");
  assert.equal(p.get("return"), "R9");
  assert.equal(p.get("item"), "I9");
});
