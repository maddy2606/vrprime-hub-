// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultQuery, ordersQuerySchema, readCancelSummary, readCards, readOrderLines, readPickRows, readSkuRows, readStockMap, readUpcomingRows, shortBy } from "./orders-view.ts";

const WH = [{ id: "11111111-1111-4111-8111-111111111111", name: "Delhi" }, { id: "22222222-2222-4222-8222-222222222222", name: "Pune" }];

test("the cards: one per warehouse, with zeros for a warehouse the database has no orders for", () => {
  const cards = readCards(
    [{ warehouse_id: WH[0].id, to_accept: 5, to_pack: 1, to_dispatch: 300, upcoming: 40, processing: 2, active: 306, held: 1, late: 3, today: 4, tomorrow: 50, next_due: "2026-10-13T05:30:00+00:00" }],
    WH,
    { [WH[0].id]: 1612 },
  );
  assert.equal(cards.length, 2);
  assert.deepEqual([cards[0].to_accept, cards[0].to_dispatch, cards[0].active, cards[0].late, cards[0].inTransit], [5, 300, 306, 3, 1612]);
  assert.equal(cards[0].nextDue, "2026-10-13T05:30:00+00:00");
  assert.deepEqual([cards[1].active, cards[1].upcoming, cards[1].nextDue], [0, 0, null]);
});

test("orders with no known warehouse get an Unknown warehouse card only when there is something in it", () => {
  assert.equal(readCards([{ warehouse_id: null, active: 0, upcoming: 0, processing: 0 }], WH).length, 2);
  const cards = readCards([{ warehouse_id: null, active: 2, upcoming: 0, processing: 0 }], WH);
  assert.equal(cards.at(-1)?.name, "Unknown warehouse");
  assert.equal(cards.at(-1)?.warehouseId, null);
});

test("SKU rows are read safely, whatever the database sends", () => {
  const r = readSkuRows({
    total: "143",
    orders: 1748,
    units: 1778,
    rows: [{ sku: "A", title: "Steel", orders: 3, units: 5, due: "2026-10-13T05:30:00+00:00", active_due: null, to_accept: 1, to_pack: "2", to_dispatch: 0, upcoming: 0, processing: 0, by_wh: { w1: 4, w2: "1" } }, "junk", null],
  });
  assert.equal(r.total, 143);
  assert.equal(r.rows.length, 1);
  assert.deepEqual([r.rows[0].to_pack, r.rows[0].by_wh.w2, r.rows[0].active_due], [2, 1, null]);
  assert.deepEqual(readSkuRows(null).rows, []);
});

test("order lines: lines in a tab we do not know are dropped", () => {
  const r = readOrderLines({ total: 2, rows: [{ order_item_id: "1", order_id: "O1", bucket: "to_pack", quantity: 2, hold: true }, { order_item_id: "2", order_id: "O2", bucket: "weird" }] });
  assert.equal(r.total, 2);
  assert.equal(r.rows.length, 1);
  assert.deepEqual([r.rows[0].bucket, r.rows[0].hold, r.rows[0].quantity], ["to_pack", true, 2]);
});

test("pick rows and upcoming rows keep an unknown stock as null, not 0", () => {
  assert.equal(readPickRows({ total: 1, units: 4, rows: [{ sku: "A", units: 4, stock: null }] }).rows[0].stock, null);
  const up = readUpcomingRows({ total: 1, short_count: 7, rows: [{ sku: "A", warehouse_id: "w1", upcoming: 5, stock: 2, short: 3 }] });
  assert.equal(up.shortCount, 7);
  assert.deepEqual([up.rows[0].stock, up.rows[0].short], [2, 3]);
});

test("cancellation summary and the stock map", () => {
  const s = readCancelSummary({ seller_total: 23, buyer_total: 2670, days: [{ day: "2026-10-13", seller: 1, buyer: 5 }] });
  assert.deepEqual([s.seller_total, s.days[0].day, s.days[0].buyer], [23, "2026-10-13", 5]);
  assert.deepEqual(readStockMap({ w1: 3, w2: "5" }), { w1: 3, w2: 5 });
  assert.deepEqual(readStockMap(null), {});
});

test("short by: pending units minus stock, never for unknown stock", () => {
  assert.equal(shortBy(10, 4), 6);
  assert.equal(shortBy(3, 4), 0);
  assert.equal(shortBy(3, null), 0);
  assert.equal(shortBy(3, undefined), 0);
});

test("a request for the Orders tab is checked before it reaches the database", () => {
  assert.ok(ordersQuerySchema.safeParse(defaultQuery("sku")).success);
  assert.ok(ordersQuerySchema.safeParse({ ...defaultQuery("pick"), wh: WH[0].id }).success);
  for (const bad of [{ view: "evil" }, { status: "x" }, { wh: "not-a-uuid" }, { offset: -1 }, { offset: 1.5 }, { dir: "sideways" }, { q: "x".repeat(101) }, { sort: "x".repeat(21) }]) {
    assert.equal(ordersQuerySchema.safeParse({ ...defaultQuery("sku"), ...bad }).success, false, JSON.stringify(bad));
  }
});
