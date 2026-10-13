// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultReturnsQuery, readReturnsPage, readReturnsSummary, returnsQuerySchema } from "./returns-view.ts";

test("a page of returns is read safely; a return of an unknown kind is dropped", () => {
  const page = readReturnsPage({
    total: "5831",
    rows: [
      { return_id: "R1", order_item_id: "OI1", order_id: "O1", sku: "A", quantity: 2, warehouse_id: "w1", source: "customer_return", return_status: "created", reason: "DAMAGED", sub_reason: null, created_date: "2026-10-12" },
      { return_id: "R2", source: "mystery" },
      "junk",
    ],
  });
  assert.equal(page.total, 5831);
  assert.equal(page.rows.length, 1);
  assert.deepEqual([page.rows[0].sku, page.rows[0].quantity, page.rows[0].sub_reason], ["A", 2, null]);
  assert.deepEqual(readReturnsPage(null), { total: 0, rows: [] });
});

test("the totals", () => {
  assert.deepEqual(readReturnsSummary({ courier_units: 3967, customer_units: "1972", courier_lines: 3859, customer_lines: 1972 }), {
    courier_units: 3967,
    customer_units: 1972,
    courier_lines: 3859,
    customer_lines: 1972,
  });
  assert.equal(readReturnsSummary(undefined).courier_units, 0);
});

test("a request for the Returns tab is checked before it reaches the database", () => {
  assert.ok(returnsQuerySchema.safeParse(defaultReturnsQuery()).success);
  for (const bad of [{ source: "other" }, { wh: "nope" }, { offset: -1 }, { dir: "up" }, { q: "x".repeat(101) }]) {
    assert.equal(returnsQuerySchema.safeParse({ ...defaultReturnsQuery(), ...bad }).success, false, JSON.stringify(bad));
  }
});
