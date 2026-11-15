import assert from "node:assert/strict";
import { test } from "node:test";
import { checkCounts, isProblem, priceDiffers, readCheckRows } from "./listing-view.ts";

const raw = [
  { row_no: 3, status: "buyable", price: "185", expected_price: "185.00", review_links: { product: "Lizard", platform: "Flipkart", priority: 2, url: "https://www.flipkart.com/x/p/1" } },
  { row_no: 1, status: "out_of_stock", price: null, expected_price: 199, review_links: { product: "Pest", platform: "Flipkart", priority: 1, url: "u" } },
  { row_no: 2, status: "buyable", price: 171, expected_price: 186, review_links: { product: "Rat", platform: "Flipkart", priority: null, url: "u" } },
  { row_no: 4, status: "not_read", price: null, expected_price: null, review_links: { product: "Bed bug", platform: "Shopsy", priority: 3, url: "u" } },
  { row_no: 5, status: "weird" },
];

test("reads rows in priority order and skips broken ones", () => {
  const rows = readCheckRows(raw);
  assert.deepEqual(rows.map((r) => r.product), ["Pest", "Lizard", "Bed bug", "Rat"]);
  assert.equal(rows[1].price, 185);
});

test("differs by ₹1 or more only when both prices are known; problems; counts", () => {
  assert.equal(priceDiffers({ price: 185, expectedPrice: 185.5 }), false);
  assert.equal(priceDiffers({ price: 171, expectedPrice: 186 }), true);
  assert.equal(priceDiffers({ price: 171, expectedPrice: null }), false);
  const rows = readCheckRows(raw);
  assert.deepEqual(rows.filter(isProblem).map((r) => r.product), ["Pest", "Bed bug", "Rat"]);
  assert.deepEqual(checkCounts(rows), { buyable: 2, outOfStock: 1, unavailable: 0, differs: 1, notRead: 1 });
});
