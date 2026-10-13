// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { coverBySku, coversPerWarehouse, daysOfCover, ratePerDay } from "./cover.ts";
import { buildRows, forecastRow, historyNote, readForecast, topMovers } from "./forecast.ts";

test("100 units over 10 days: rate 10, forecasts 10 / 70 / 300", () => {
  const r = forecastRow({ sku: "A", wid: null, title: null, disp: 100, stock: 50 }, 10);
  assert.deepEqual([r.rate, r.f1, r.f7, r.f30], [10, 10, 70, 300]);
  assert.equal(r.cover, 5, "50 units at 10 a day last 5 days");
});

test("rounding, and no history or no sales means no cover", () => {
  const r = forecastRow({ sku: "A", wid: null, title: null, disp: 10, stock: 9 }, 7);
  assert.deepEqual([r.f1, r.f7, r.f30], [1, 10, 43], "10/7 = 1.43 a day");
  assert.equal(forecastRow({ sku: "A", wid: null, title: null, disp: 0, stock: 9 }, 7).cover, null);
  const none = forecastRow({ sku: "A", wid: null, title: null, disp: 5, stock: 9 }, 0);
  assert.deepEqual([none.rate, none.f30, none.cover], [0, 0, null]);
});

const raw = [
  { sku: "A", wid: "w1", title: "Alpha", disp: 60, stock: 10 },
  { sku: "A", wid: "w2", title: null, disp: 40, stock: 40 },
  { sku: "B", wid: "w1", title: "Beta", disp: 10, stock: 0 },
];

test("SKUs are summed over warehouses, or split by warehouse", () => {
  const all = buildRows(raw, 10, false);
  const a = all.find((r) => r.sku === "A");
  assert.deepEqual([a?.dispatched, a?.stock, a?.f30, a?.title], [100, 50, 300, "Alpha"]);
  assert.equal(all.length, 2);
  assert.equal(buildRows(raw, 10, true).length, 3);
  assert.deepEqual(buildRows(raw, 10, true, "w2").map((r) => r.sku), ["A"]);
});

test("the top movers are by 30-day forecast", () => {
  assert.deepEqual(topMovers(buildRows(raw, 10, false), 1).map((r) => r.sku), ["A"]);
});

test("a window longer than the history says so", () => {
  const meta = { today: "2026-10-13", windowStart: "2026-09-13", windowEnd: "2026-10-12", days: 30, asked: 30, historyFrom: "2026-09-13", snapshot: null };
  assert.equal(historyNote(meta), null);
  assert.equal(historyNote({ ...meta, days: 24, asked: 30 }), "Based on 24 days of dispatch history (you asked for 30).");
  assert.match(historyNote({ ...meta, days: 0 }) ?? "", /no dispatch history/);
});

test("rows from the database are read safely", () => {
  assert.equal(readForecast(null), null);
  const f = readForecast({ days: "12", asked: 14, window_start: "2026-10-01", rows: [{ sku: "A", wid: null, disp: "5", stock: 2 }, "junk", { nope: 1 }] });
  assert.equal(f?.raw.length, 1);
  assert.deepEqual([f?.meta.days, f?.raw[0].disp, f?.raw[0].stock], [12, 5, 2]);
});

// --- Days of cover: one calculation for the Stock tab, Forecasting and Needs action --------------------------------------

test("cover = stock / (dispatched / days); no rate, no cover", () => {
  assert.equal(ratePerDay(100, 10), 10);
  assert.equal(ratePerDay(0, 10), 0);
  assert.equal(ratePerDay(5, 0), 0);
  assert.equal(daysOfCover(50, 10), 5);
  assert.equal(daysOfCover(0, 10), 0, "no stock left is 0 days");
  assert.equal(daysOfCover(50, 0), null);
});

test("the Stock tab and Forecasting give the same days of cover for the same scope", () => {
  const forecast = buildRows(raw, 10, false).find((r) => r.sku === "A");
  const stock = coverBySku(raw, 10, null).A;
  assert.equal(forecast?.cover, stock.days, "all warehouses");
  const w2 = buildRows(raw, 10, true, "w2").find((r) => r.sku === "A");
  assert.equal(w2?.cover, coverBySku(raw, 10, ["w2"]).A.days, "one warehouse");
  assert.equal(coverBySku(raw, 10, ["w2"]).A.warehouseId, "w2");
});

test("per warehouse cover skips empty stock and SKUs nobody dispatches", () => {
  const covers = coversPerWarehouse([...raw, { sku: "C", wid: "w1", disp: 0, stock: 99 }], 10);
  assert.deepEqual(covers.map((c) => `${c.sku}@${c.warehouseId}:${c.days}`).sort(), ["A@w1:1.6666666666666667", "A@w2:10"].sort());
});
