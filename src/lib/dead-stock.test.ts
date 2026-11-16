import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyDeadStock, deadKind, deadTotals, type DeadInput } from "./dead-stock.ts";

const p = (name: string, stock: number, dispatched: number, cover: number | null, cost: number | null): DeadInput => ({ name, code: null, stock, dispatched, cover, byWarehouse: [], cost });

test("dead: stock and nothing dispatched; slow: over 90 days of cover", () => {
  assert.equal(deadKind({ stock: 10, dispatched: 0, cover: null }), "dead");
  assert.equal(deadKind({ stock: 10, dispatched: 3, cover: 100 }), "slow");
  assert.equal(deadKind({ stock: 10, dispatched: 3, cover: 90 }), null);
  assert.equal(deadKind({ stock: 0, dispatched: 0, cover: null }), null);
});

test("sorted by value, largest first, no cost last; totals", () => {
  const rows = classifyDeadStock([p("A", 10, 0, null, 50), p("B", 100, 0, null, null), p("C", 40, 1, 120, 20), p("D", 5, 9, 2, 10), p("E", 3, 0, null, 400)]);
  assert.deepEqual(rows.map((r) => r.name), ["E", "C", "A", "B"]);
  assert.equal(rows[0].value, 1200);
  assert.deepEqual(deadTotals(rows), { deadValue: 1700, deadProducts: 3, slowValue: 800, slowProducts: 1, noCost: 1 });
});
