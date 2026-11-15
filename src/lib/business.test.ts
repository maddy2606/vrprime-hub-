import assert from "node:assert/strict";
import { test } from "node:test";
import { businessWeekStart, change, changeTone, movers, readTargetValue, readWeekFigures, signedPct, targetView, weekDays, weekFromParam, weekSentence } from "./business.ts";

test("weeks run Monday to Sunday", () => {
  assert.equal(businessWeekStart("2026-11-16"), "2026-11-16");
  assert.equal(businessWeekStart("2026-11-22"), "2026-11-16");
  assert.equal(businessWeekStart("2026-11-15"), "2026-11-09");
});

test("p_days: days so far including today, 7 for a finished week", () => {
  assert.equal(weekDays("2026-11-16", "2026-11-16"), 1);
  assert.equal(weekDays("2026-11-16", "2026-11-19"), 4);
  assert.equal(weekDays("2026-11-09", "2026-11-16"), 7);
  assert.equal(weekDays("2026-11-16", "2026-11-22"), 7);
});

test("the start parameter opens its week, never a future one", () => {
  assert.equal(weekFromParam(null, "2026-11-18"), "2026-11-16");
  assert.equal(weekFromParam("2026-11-11", "2026-11-18"), "2026-11-09");
  assert.equal(weekFromParam("2026-12-01", "2026-11-18"), "2026-11-16");
  assert.equal(weekFromParam("nope", "2026-11-18"), "2026-11-16");
});

test("change, percent and tone by direction", () => {
  assert.deepEqual(change(120, 100), { diff: 20, pct: 20 });
  assert.equal(change(5, 0).pct, null);
  assert.equal(changeTone("orders", 120, 100), "ok");
  assert.equal(changeTone("orders", 80, 100), "bad");
  assert.equal(changeTone("cancelled", 80, 100), "ok");
  assert.equal(changeTone("late", 12, 10), "bad");
  assert.equal(changeTone("adSpend", 200, 100), "muted");
  assert.equal(changeTone("units", 1005, 1000), "muted"); // under 1%
  assert.equal(signedPct(-12.4), "−12%");
  assert.equal(signedPct(null), "new");
});

test("reads business_week's figures", () => {
  const w = readWeekFigures({ orders: 10, units: "14", sales: 2500.5, returns_customer: 2, ads_read_to: "2026-11-15", by_product: [{ id: null, name: "SKU-1", units: 3 }, null] });
  assert.equal(w.units, 14);
  assert.equal(w.returnsCustomer, 2);
  assert.equal(w.adsReadTo, "2026-11-15");
  assert.deepEqual(w.byProduct, [{ id: null, name: "SKU-1", units: 3 }]);
  assert.equal(readWeekFigures(null).orders, 0);
});

test("the subtitle sentence", () => {
  const a = readWeekFigures({ orders: 112, sales: 5000 });
  const b = readWeekFigures({ orders: 100, sales: 4000 });
  const rs = (n: number) => `₹${n}`;
  assert.equal(weekSentence(a, b, rs), "Orders are up 12% on last week; sales ₹5000 against ₹4000.");
  assert.equal(weekSentence(b, a, rs), "Orders are down 11% on last week; sales ₹4000 against ₹5000.");
});

test("rising and falling skip products under 5 units in both weeks", () => {
  const cur = [{ id: "a", name: "A", units: 30 }, { id: "b", name: "B", units: 2 }, { id: null, name: "X", units: 4 }, { id: "c", name: "C", units: 1 }];
  const prev = [{ id: "a", name: "A", units: 20 }, { id: "b", name: "B", units: 3 }, { id: "c", name: "C", units: 9 }];
  const m = movers(cur, prev);
  assert.deepEqual(m.rising.map((x) => [x.name, x.diff]), [["A", 10]]);
  assert.deepEqual(m.falling.map((x) => [x.name, x.units, x.was]), [["C", 1, 9]]);
});

test("targets: blank is not set; pace, marker and needs a day", () => {
  assert.equal(readTargetValue(""), null);
  assert.equal(readTargetValue(null), null);
  assert.equal(readTargetValue("150000"), 150000);
  assert.equal(readTargetValue(0), 0);
  // 30-day month, the 16th, figures to the 15th.
  const t = targetView(300_000, 120_000, "2026-11-16", 15);
  assert.equal(t.expected, 160_000);
  assert.equal(t.pace, 240_000);
  assert.equal(t.gap, -60_000);
  assert.equal(t.daysLeft, 15);
  assert.equal(t.perDay, 12_000);
  assert.equal(Math.round(t.pctOfTarget), 40);
  assert.equal(targetView(100, 150, "2026-11-30", 30).perDay, 0);
});
