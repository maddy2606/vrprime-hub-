// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { isNightIST, normalizeReturns, normalizeShipments, readTopic, requestFor } from "./rules.ts";

/** A shipment the way Flipkart sends it, stuffed with buyer details that must never be kept. */
const SHIPMENT = {
  shipmentId: "SHP123",
  dispatchByDate: "2026-10-12T14:00:00.000+05:30",
  dispatchAfterDate: "2026-10-12T11:01:56.000+05:30",
  updatedAt: "2026-10-12T13:13:16.000+05:30",
  locationId: "LOCabc",
  hold: false,
  buyerName: "SECRET-BUYER-NAME",
  deliveryAddress: { line1: "SECRET-ADDRESS-LINE", phone: "SECRET-PHONE-9876543210", pincode: "SECRET-PIN" },
  subShipments: [{ packages: [{ packageSku: "X", dimensions: { length: 1 } }] }],
  orderItems: [
    {
      orderItemId: "OI1",
      orderId: "OD1",
      orderDate: "2026-10-12T10:56:13.205+05:30",
      status: "APPROVED",
      quantity: 2,
      sku: " RATH2",
      title: "SECRET-TITLE",
      paymentType: "COD",
      priceComponents: { sellingPrice: 499, customerPrice: 987654 },
      hsn: "33012400",
      customerEmail: "secret@example.test",
    },
    { orderItemId: "OI2", orderId: "OD1", status: "APPROVED", quantity: "3", sku: "ABC" },
    { orderItemId: "", orderId: "OD9", sku: "NOID" },
  ],
};

test("keeps only the fields we need from a shipment, and nothing about the buyer", () => {
  const { items, seen } = normalizeShipments([SHIPMENT, "junk", null]);
  assert.equal(seen, 3, "three order items were looked at");
  assert.equal(items.length, 2, "the one without an order item ID is dropped");
  assert.deepEqual(items[0], {
    order_item_id: "OI1",
    order_id: "OD1",
    shipment_id: "SHP123",
    sku: " RATH2",
    quantity: 2,
    order_date: "2026-10-12T10:56:13.205+05:30",
    location_id: "LOCabc",
    status: "APPROVED",
    hold: false,
    dispatch_by: "2026-10-12T14:00:00.000+05:30",
    dispatch_after: "2026-10-12T11:01:56.000+05:30",
    cancelled_at: null,
    cancel_reason: null,
    cancel_sub_reason: null,
    selling_price: 499,
  });
  assert.equal(items[1].quantity, 3, "a quantity sent as text is understood");

  const everything = JSON.stringify(items);
  for (const secret of ["SECRET", "COD", "987654", "secret@example.test", "33012400"]) {
    assert.ok(!everything.includes(secret), `${secret} must not be kept`);
  }
});

test("a SKU keeps its leading and trailing spaces", () => {
  const { items } = normalizeShipments([{ ...SHIPMENT, orderItems: [{ orderItemId: "A", orderId: "B", sku: " RATH2 " }] }]);
  assert.equal(items[0].sku, " RATH2 ");
});

test("cancelled items carry the date and the reason, and no location when Flipkart gives none", () => {
  const { items } = normalizeShipments([
    {
      shipmentId: "S",
      hold: false,
      orderItems: [
        {
          orderItemId: "OI9",
          orderId: "OD9",
          sku: "S1",
          quantity: 1,
          status: "CANCELLED",
          cancellationDate: "2026-09-12T22:45:01.017+05:30",
          cancellationReason: "seller_cancellation",
          cancellationSubReason: "order_over_sla",
        },
      ],
    },
  ]);
  assert.equal(items[0].location_id, null);
  assert.equal(items[0].cancel_reason, "seller_cancellation");
  assert.equal(items[0].cancel_sub_reason, "order_over_sla");
  assert.equal(items[0].cancelled_at, "2026-09-12T22:45:01.017+05:30");
});

test("odd values do not break it", () => {
  const { items } = normalizeShipments([
    { orderItems: [{ orderItemId: 5, orderId: 6, orderDate: "not a date", dispatchByDate: 12, quantity: -4, sku: 42 }] },
  ]);
  assert.equal(items[0].order_item_id, "5");
  assert.equal(items[0].order_date, null);
  assert.equal(items[0].dispatch_by, null);
  assert.equal(items[0].quantity, 1, "a nonsense quantity falls back to 1");
  assert.equal(items[0].sku, null);
});

test("keeps the return reason, not the buyer's comment", () => {
  const rows = normalizeReturns([
    {
      returnId: "R1",
      orderItemId: "OI1",
      orderId: "OD1",
      quantity: 1,
      locationId: "LOCabc",
      status: "created",
      reason: "WRONG_ITEM",
      subReason: "DIFFERENT_PRODUCT",
      shipmentStatus: "in_transit",
      orderDate: "2026-09-01T10:00:00.000+05:30",
      createdDate: "2026-09-12T10:00:00.000+05:30",
      updatedDate: "2026-09-13T10:00:00.000+05:30",
      comments: "SECRET-COMMENT my phone is 9876543210",
      trackingId: "SECRET-TRACK",
      courierName: "SECRET-COURIER",
      sellerId: "SECRET-SELLER",
    },
    { orderItemId: "", returnId: "R2" },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reason, "WRONG_ITEM");
  assert.equal(rows[0].created_at, "2026-09-12T10:00:00.000+05:30");
  const everything = JSON.stringify(rows);
  for (const secret of ["SECRET", "9876543210"]) assert.ok(!everything.includes(secret), `${secret} must not be kept`);
});

test("turns each part of the plan into the request that was shown to work", () => {
  const pre = requestFor({ t: "pre", state: "APPROVED" });
  assert.deepEqual(pre, { kind: "shipments", request: { filter: { type: "preDispatch", states: ["APPROVED"] }, sorted: true } });
  const packing = requestFor({ t: "pre", state: "PACKING_IN_PROGRESS" });
  assert.equal(packing.kind === "shipments" && packing.request.sorted, false, "the one state that fails with the sort is unsorted");

  const post = requestFor({ t: "post", from: "2026-10-05T00:00:00.000Z", to: "2026-10-06T00:00:00.000Z" });
  assert.deepEqual(post.kind === "shipments" && post.request.filter, {
    type: "postDispatch",
    states: ["SHIPPED", "DELIVERED"],
    shipmentTypes: ["NORMAL"],
    orderDate: { from: "2026-10-05T00:00:00.000Z", to: "2026-10-06T00:00:00.000Z" },
  });

  const cancel = requestFor({ t: "cancel", type: "sellerCancellation", from: "2026-09-12T00:00:00.000Z", to: "2026-10-12T00:00:00.000Z" });
  assert.deepEqual(cancel.kind === "shipments" && cancel.request.filter, {
    type: "cancelled",
    states: ["Cancelled"],
    cancellationType: "sellerCancellation",
    cancellationDate: { from: "2026-09-12T00:00:00.000Z", to: "2026-10-12T00:00:00.000Z" },
  });

  const returns = requestFor({ t: "returns", source: "customer_return", since: "modifiedAfter", at: "2026-10-08T00:00:00.000Z" });
  assert.deepEqual(returns, { kind: "returns", request: { source: "customer_return", since: "modifiedAfter", at: "2026-10-08T00:00:00.000Z" } });
});

test("the pending sweep asks only for orders due inside its window", () => {
  const r = requestFor({ t: "pre", state: "READY_TO_DISPATCH", from: "2026-07-14T00:00:00.000Z", to: "2026-10-16T00:00:00.000Z" });
  assert.deepEqual(r.kind === "shipments" && r.request.filter, {
    type: "preDispatch",
    states: ["READY_TO_DISPATCH"],
    dispatchByDate: { from: "2026-07-14T00:00:00.000Z", to: "2026-10-16T00:00:00.000Z" },
  });
});

test("the pending sweep can be asked for one warehouse at a time", () => {
  const r = requestFor({ t: "pre", state: "APPROVED", loc: "LOCabc123", from: "2026-07-14T00:00:00.000Z", to: "2026-10-16T00:00:00.000Z" });
  assert.deepEqual(r.kind === "shipments" && r.request.filter, {
    type: "preDispatch",
    states: ["APPROVED"],
    locationId: "LOCabc123",
    dispatchByDate: { from: "2026-07-14T00:00:00.000Z", to: "2026-10-16T00:00:00.000Z" },
  });
  assert.deepEqual(readTopic({ t: "pre", state: "APPROVED", loc: "bad value!" }), { t: "pre", state: "APPROVED" }, "an odd location is dropped, not sent");
});

test("the nightly In Transit part asks for shipped orders only", () => {
  const topic = readTopic({ t: "post", only: "SHIPPED", day: "2026-10-05", from: "2026-10-05T00:00:00.000Z", to: "2026-10-06T00:00:00.000Z" });
  assert.deepEqual(topic, { t: "post", only: "SHIPPED", from: "2026-10-05T00:00:00.000Z", to: "2026-10-06T00:00:00.000Z" });
  const r = requestFor(topic as NonNullable<typeof topic>);
  assert.deepEqual(r.kind === "shipments" && r.request.filter, {
    type: "postDispatch",
    states: ["SHIPPED"],
    shipmentTypes: ["NORMAL"],
    orderDate: { from: "2026-10-05T00:00:00.000Z", to: "2026-10-06T00:00:00.000Z" },
  });
  assert.deepEqual(readTopic({ t: "post", only: "RETURNED", from: "2026-10-05T00:00:00.000Z", to: "2026-10-06T00:00:00.000Z" }), { t: "post", from: "2026-10-05T00:00:00.000Z", to: "2026-10-06T00:00:00.000Z" }, "any other value is dropped");
});

test("no part of any plan asks for marketplace cancellations (not confirmed to work)", () => {
  assert.equal(readTopic({ t: "cancel", type: "marketplaceCancellation", from: "2026-09-12T00:00:00.000Z", to: "2026-10-12T00:00:00.000Z" }), null);
});

test("a plan part that does not look right is refused", () => {
  assert.equal(readTopic(null), null);
  assert.equal(readTopic({ t: "pre", state: "DELIVERED" }), null);
  assert.equal(readTopic({ t: "post", from: "yesterday", to: "now" }), null);
  assert.equal(readTopic({ t: "returns", source: "other", since: "createdAfter", at: "2026-10-08T00:00:00.000Z" }), null);
  assert.equal(readTopic({ t: "unknown" }), null);
  assert.ok(readTopic({ t: "post", from: "2026-10-05T00:00:00.000Z", to: "2026-10-06T00:00:00.000Z", day: "2026-10-05" }));
  assert.deepEqual(readTopic({ t: "pre", state: "APPROVED", from: "2026-07-14T00:00:00.000Z", to: "2026-10-16T00:00:00.000Z" }), { t: "pre", state: "APPROVED", from: "2026-07-14T00:00:00.000Z", to: "2026-10-16T00:00:00.000Z" });
  assert.deepEqual(readTopic({ t: "pre", state: "APPROVED", from: "nonsense" }), { t: "pre", state: "APPROVED" }, "a bad window is dropped, not trusted");
});

test("night is 22:15 to 06:45 IST", () => {
  const ist = (hh: number, mm: number) => new Date(Date.UTC(2026, 9, 12, hh, mm) - 330 * 60_000);
  assert.equal(isNightIST(ist(22, 14)), false);
  assert.equal(isNightIST(ist(22, 15)), true);
  assert.equal(isNightIST(ist(0, 0)), true);
  assert.equal(isNightIST(ist(6, 44)), true);
  assert.equal(isNightIST(ist(6, 45)), false);
  assert.equal(isNightIST(ist(12, 0)), false);
});
