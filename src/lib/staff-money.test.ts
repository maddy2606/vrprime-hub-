import assert from "node:assert/strict";
import { test } from "node:test";
import { staffMoneyByMonth, staffMoneySummary, type StaffMoneyEntry } from "./staff-money.ts";

const e = (id: string, kind: StaffMoneyEntry["kind"], day: string, amount: number): StaffMoneyEntry => ({ id, staffId: "s", kind, day, amount, note: null });
const LIST = [e("1", "advance", "2026-10-05", 5000), e("2", "recovered", "2026-10-31", 2000), e("3", "advance", "2026-11-03", 1000), e("4", "expense", "2026-11-04", 350), e("5", "recovered", "2026-11-10", 500)];

test("advance still due counts every month; this month's totals only this month", () => {
  assert.deepEqual(staffMoneySummary(LIST, "2026-11"), { due: 3500, thisMonth: { advance: 1000, expense: 350, recovered: 500 } });
  assert.deepEqual(staffMoneySummary([], "2026-11"), { due: 0, thisMonth: { advance: 0, expense: 0, recovered: 0 } });
});

test("history is newest first, grouped by month with totals", () => {
  const g = staffMoneyByMonth(LIST);
  assert.deepEqual(g.map((m) => m.month), ["2026-11", "2026-10"]);
  assert.deepEqual(g[0].entries.map((x) => x.id), ["5", "4", "3"]);
  assert.deepEqual(g[1].totals, { advance: 5000, expense: 0, recovered: 2000 });
});
