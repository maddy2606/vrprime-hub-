import assert from "node:assert/strict";
import { test } from "node:test";
import { budgetStatus, isLabour, nextMonth, previousMonth, splitByShare, warehouseFor } from "./budget.ts";

const WH = [
  { id: "blr", name: "Bangalore" },
  { id: "bhw", name: "Bhiwandi" },
  { id: "del", name: "Delhi" },
  { id: "kol", name: "Kolkata" },
  { id: "lko", name: "Lucknow" },
];

test("the warehouse a note is about, from the group's real notes", () => {
  assert.equal(warehouseFor("Delhi Pine ka Paani", WH), "del");
  assert.equal(warehouseFor("Lucknow boxes 339 rs", WH), "lko");
  assert.equal(warehouseFor("Bangalore box", WH), "blr");
  assert.equal(warehouseFor("1400 Kokata Inverter", WH), "kol", "a misspelt Kolkata");
  assert.equal(warehouseFor("650 · Bhiwandi Trolley Wheel", WH), "bhw");
  assert.equal(warehouseFor("Mumbai Porter Arihant Sir", WH), "bhw", "Mumbai is the Bhiwandi warehouse");
  assert.equal(warehouseFor("Bhiwandi To Purna Porter ~ Delhi K Liye", WH), "del", "it was for Delhi");
  assert.equal(warehouseFor("Courier Bhiwandi to Lucknow", WH), "bhw", "two named, none marked: the first, where it was paid");
  assert.equal(warehouseFor("Tea for staff, delivery boys", WH), null, "'delivery' is not Delhi");
  assert.equal(warehouseFor(null, WH), null);
});

test("a budget split by orders adds up to the total, in steps of ₹100", () => {
  const s = splitByShare(100_000, { bhw: 4500, del: 3000, kol: 2000, lko: 500, blr: 0 });
  assert.deepEqual(s, { bhw: 45_000, del: 30_000, kol: 20_000, lko: 5_000, blr: 0 });
  const odd = splitByShare(10_000, { a: 1, b: 1, c: 1 });
  assert.equal(Object.values(odd).reduce((n, v) => n + v, 0), 10_000);
  assert.ok(Object.values(odd).every((v) => v % 100 === 0));
  assert.deepEqual(splitByShare(900, { a: 0, b: 0, c: 0 }), { a: 300, b: 300, c: 300 }, "no orders yet: even");
  assert.deepEqual(splitByShare(5000, {}), {});
});

test("where a warehouse stands against its budget", () => {
  assert.deepEqual(budgetStatus(10_000, 4_000), { pct: 40, tone: "ok", left: 6_000 });
  assert.equal(budgetStatus(10_000, 9_000).tone, "warn");
  assert.deepEqual(budgetStatus(10_000, 12_500), { pct: 125, tone: "bad", left: -2_500 });
  assert.deepEqual(budgetStatus(0, 500), { pct: null, tone: "bad", left: -500 }, "spending with no budget");
  assert.equal(budgetStatus(0, 0).tone, "neutral");
});

test("labour or running costs, and months either side", () => {
  assert.ok(isLabour("Staff and labour"));
  assert.ok(!isLabour("Packing material"));
  assert.equal(nextMonth("2026-12"), "2027-01");
  assert.equal(nextMonth("2026-10"), "2026-11");
  assert.equal(previousMonth("2026-01"), "2025-12");
});
