import assert from "node:assert/strict";
import { test } from "node:test";
import { claimCounts, claimTicketHref, daysLeftChip, DEFAULT_CLAIM_FILTERS, FLAG_REASONS, filterClaims, groupClaims, isFlagReason, readClaimRows, skusInGroup, weekStart, type ClaimRow } from "./return-claims.ts";

const row = (id: string, daysLeft: number, extra: Partial<ClaimRow> = {}): ClaimRow => ({
  returnId: id,
  orderItemId: `${id}-1`,
  orderId: `OD${id}`,
  sku: `SKU-${id}`,
  title: null,
  source: "customer_return",
  reason: "DAMAGED_PRODUCT",
  subReason: null,
  group: "damaged",
  flagged: false,
  quantity: 1,
  warehouseId: "w1",
  returnedOn: "2026-11-10",
  daysLeft,
  ...extra,
});

test("reads the database rows and skips broken ones", () => {
  const rows = readClaimRows([
    { return_id: "R1", order_item_id: "I1", returned_on: "2026-11-12", source: "courier_return", days_left: 3, quantity: "2", sku: "A", claim_group: "rto_damaged", flagged: true, title: "Bottle" },
    { return_id: "R2", order_item_id: "I2", returned_on: "2026-11-12", source: "something else", days_left: 3, claim_group: "damaged" },
    { return_id: "R4", order_item_id: "I4", returned_on: "2026-11-12", source: "customer_return", days_left: 3, claim_group: "not a group" },
    { order_item_id: "I3" },
    null,
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, 2);
  assert.equal(rows[0].source, "courier_return");
  assert.equal(rows[0].group, "rto_damaged");
  assert.equal(rows[0].flagged, true);
  assert.equal(rows[0].title, "Bottle");
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

test("filters by view, warehouse and search, and sorts by days left, fewest first", () => {
  const rows = [row("a", 5), row("b", 0, { warehouseId: "w2" }), row("c", 2, { title: "Lizard repellent", sku: "LIZ-1" }), row("d", -2)];
  assert.deepEqual(filterClaims(rows, DEFAULT_CLAIM_FILTERS).map((r) => r.returnId), ["b", "c", "a"]);
  assert.deepEqual(filterClaims(rows, { ...DEFAULT_CLAIM_FILTERS, view: "missed" }).map((r) => r.returnId), ["d"]);
  assert.deepEqual(filterClaims(rows, { ...DEFAULT_CLAIM_FILTERS, wh: "w2" }).map((r) => r.returnId), ["b"]);
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

test("one card per reason group with returns, in the fixed order, with units, SKUs and closing counts", () => {
  const rows = [
    row("a", 0, { group: "quality", sku: "X", quantity: 2 }),
    row("b", 5, { group: "wrong_item", sku: "X" }),
    row("c", 1, { group: "wrong_item", sku: "Y", flagged: true }),
    row("d", 6, { group: "wrong_item", sku: "X" }),
  ];
  const g = groupClaims(rows);
  assert.deepEqual(g.map((x) => x.key), ["wrong_item", "quality"]);
  assert.deepEqual({ ...g[0], label: undefined, hint: undefined }, { key: "wrong_item", label: undefined, hint: undefined, returns: 3, units: 3, skus: 2, closing: 1, flagged: 1 });
  assert.equal(g[1].units, 2);
  assert.equal(g[1].closing, 1);
});

test("every SKU in a reason, most returns first, each with its returns fewest days left first", () => {
  const rows = [
    row("a", 4, { group: "damaged", sku: "ONE" }),
    row("b", 2, { group: "damaged", sku: "TWO", warehouseId: "w2" }),
    row("c", 6, { group: "damaged", sku: "TWO", title: "Two pack" }),
    row("d", 1, { group: "damaged", sku: "TWO" }),
    row("e", 0, { group: "damaged", sku: "THREE", quantity: 3 }),
    row("f", 0, { group: "missing", sku: "TWO" }),
    row("g", 3, { group: "damaged", sku: null }),
  ];
  const s = skusInGroup(rows, "damaged");
  assert.deepEqual(s.map((x) => x.sku), ["TWO", "THREE", "ONE", null]); // 3 returns, then 1 return with 3 units, then A-Z, no SKU last
  assert.equal(s[0].returns, 3);
  assert.equal(s[0].title, "Two pack");
  assert.equal(s[0].soonest, 1);
  assert.deepEqual(s[0].rows.map((r) => r.returnId), ["d", "b", "c"]);
  assert.deepEqual(s[0].warehouseIds.sort(), ["w1", "w2"]);
  assert.equal(s.length, 4, "every SKU is listed, not only the top ones");
});

test("Needs claim offers exactly the six reasons the database accepts", () => {
  assert.deepEqual(FLAG_REASONS.map((r) => r.value), ["wrong_item", "damaged", "missing", "used", "empty_box", "other"]);
  assert.ok(isFlagReason("empty_box"));
  assert.ok(!isFlagReason("quality"));
  assert.ok(!isFlagReason(null));
});
