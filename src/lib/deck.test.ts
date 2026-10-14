import assert from "node:assert/strict";
import { test } from "node:test";
import { dryAndSelling, heroFor, rankQueue, SEVERITY, urgentCount, warehouseHealth, type QueueItem } from "./deck.ts";

const item = (key: string, kind: QueueItem["kind"], deadline: number | null, title = key): QueueItem => ({ key, kind, severity: SEVERITY[kind], deadline, title, detail: "", actions: [] });

test("the queue is ranked by severity, then the earliest deadline, then the title", () => {
  const ranked = rankQueue([item("w", "work", 5), item("t", "ticket", 1), item("l2", "late", 20), item("l1", "late", 10), item("d", "dry", null), item("o", "overfill", 3), item("r", "risk", 1), item("l3", "late", null)]);
  assert.deepEqual(
    ranked.map((i) => i.key),
    ["l1", "l2", "l3", "o", "d", "r", "t", "w"],
  );
});

test("urgent items are everything except work that is only assigned to me", () => {
  assert.equal(urgentCount([item("w", "work", null), item("t", "ticket", 1), item("r", "risk", 2)]), 2);
  assert.equal(urgentCount([item("w", "work", null)]), 0);
});

test("the headline names the worst thing: late orders, then a SKU that ran dry", () => {
  const h = heroFor({ lateOrders: 1, dry: [{ sku: "VACMAP2" }], overfillSkus: 3, followUpsDue: 2, onTime: 499, active: 500 });
  assert.equal(h.headline, "1 order is late, and VACMAP2 just ran dry");
  assert.equal(h.tone, "bad");
  assert.equal(h.reassurance, "499 of 500 active orders are on time.");
});

test("several dry SKUs are counted, and an amber headline when nothing is late", () => {
  const h = heroFor({ lateOrders: 0, dry: [{ sku: "A" }, { sku: "B" }], overfillSkus: 0, followUpsDue: 0, onTime: 10, active: 10 });
  assert.equal(h.headline, "2 selling SKUs are out of stock");
  assert.equal(h.tone, "warn");
});

test("all caught up when nothing is urgent", () => {
  const h = heroFor({ lateOrders: 0, dry: [], overfillSkus: 0, followUpsDue: 0, onTime: 12, active: 12 });
  assert.equal(h.tone, "ok");
  assert.equal(h.headline, "You're all caught up");
});

test("warehouse health: share of active orders that are not late, with a late, soon or on-time chip", () => {
  const now = new Date("2026-10-14T10:00:00Z");
  assert.deepEqual(warehouseHealth({ active: 100, late: 10, nextDue: null }, now), { pct: 90, tone: "warn", chip: { label: "10 late", tone: "bad" } });
  assert.equal(warehouseHealth({ active: 100, late: 0, nextDue: "2026-10-14T11:00:00Z" }, now).chip.label, "Due soon");
  assert.equal(warehouseHealth({ active: 100, late: 0, nextDue: "2026-10-14T20:00:00Z" }, now).chip.label, "On time");
  assert.equal(warehouseHealth({ active: 0, late: 0, nextDue: null }, now).pct, 100);
  // one late order among 500 is 99.8%: still not shown as all green, because the chip is red
  assert.equal(warehouseHealth({ active: 500, late: 1, nextDue: null }, now).chip.tone, "bad");
});

test("dry and selling: no stock anywhere in scope but dispatched recently, busiest first", () => {
  const out = dryAndSelling([
    { sku: "A", title: "a", disp: 5, stock: 0 },
    { sku: "A", title: "a", disp: 5, stock: 0 },
    { sku: "B", title: null, disp: 3, stock: 0 },
    { sku: "C", title: null, disp: 50, stock: 2 },
    { sku: "D", title: null, disp: 0, stock: 0 },
  ]);
  assert.deepEqual(out.map((r) => [r.sku, r.disp]), [["A", 10], ["B", 3]]);
});
