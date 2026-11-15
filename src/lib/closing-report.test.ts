import assert from "node:assert/strict";
import { test } from "node:test";
import { closingDay, closingTotals, readClosingRows } from "./closing-report.ts";

const raw = (id: string, name: string, sort: number, extra: Record<string, unknown> = {}) => ({
  warehouse_id: id,
  warehouses: { name, sort_order: sort },
  dispatched_units: 10,
  dispatched_orders: 8,
  pending_today: 2,
  late_now: 1,
  pending_total: 5,
  present: 4,
  half_day: 1,
  absent: 0,
  on_leave: 0,
  not_marked: 1,
  returns_to_check: 3,
  ...extra,
});

test("reads rows in the warehouses' order and skips broken ones", () => {
  const rows = readClosingRows([raw("b", "Delhi", 2), raw("a", "Bangalore", 1, { absent: "2" }), { nope: 1 }, null]);
  assert.deepEqual(rows.map((r) => r.warehouse), ["Bangalore", "Delhi"]);
  assert.equal(rows[0].absent, 2);
  assert.equal(rows[0].dispatchedUnits, 10);
  assert.deepEqual(readClosingRows(undefined), []);
});

test("the totals row adds every figure", () => {
  const t = closingTotals(readClosingRows([raw("a", "A", 1), raw("b", "B", 2, { late_now: 4 })]));
  assert.equal(t.dispatchedUnits, 20);
  assert.equal(t.lateNow, 5);
  assert.equal(t.returnsToCheck, 6);
});

test("the day is today unless a valid earlier day is asked for", () => {
  assert.equal(closingDay(null, "2026-11-16"), "2026-11-16");
  assert.equal(closingDay("2026-11-10", "2026-11-16"), "2026-11-10");
  assert.equal(closingDay("2026-11-20", "2026-11-16"), "2026-11-16");
  assert.equal(closingDay("junk", "2026-11-16"), "2026-11-16");
});
