import assert from "node:assert/strict";
import { test } from "node:test";
import { readListing, readPrice } from "./listing-check.ts";

// Short trimmed snippets of the saved Flipkart pages (16 Nov 2026), never whole pages and nothing about buyers.
const OFFER_185 = `"brand":{"name":"VRPRIME","@type":"Brand"},"offers":{"price":185,"priceCurrency":"INR","availability":"https://schema.org/InStock","itemCondition":"https://schema.org/NewCondition","shippingDetails":{"shippingRate":{"value":0,"currency":"INR","@type":"MonetaryAmount"}},"@type":"Offer"}`;
const OFFER_171_ESCAPED = `"offers":{"price":171,"priceCurrency":"INR","availability":"https:\\u002f\\u002fschema.org\\u002fInStock"}`;
const PRODUCT_END = `"@context":"https://schema.org","@type":"Product"}]</script>`;
const CART = `"actionType":"CART_ADD","price":185,"productActionButtonType":"CART_ADD","text":"Add to cart"`;
const BUY = `"productActionButtonType":"BUY_NOW","text":"Buy at ₹185"`;
const PPD = `"ppd":{"fsp":171,"finalPrice":186,"mrp":999}`;

test("a product page with a price and an Add to cart / Buy control is buyable at the offer price", () => {
  assert.deepEqual(readListing(OFFER_185 + PRODUCT_END + CART + BUY), { status: "buyable", price: 185 });
});

test("the buyer's price is the offer price, not finalPrice, and escaped slashes are read", () => {
  assert.equal(readPrice(PPD + OFFER_171_ESCAPED), 171);
  assert.deepEqual(readListing(PPD + OFFER_171_ESCAPED + PRODUCT_END + CART), { status: "buyable", price: 171 });
});

test("no buy control, or no price, is not read", () => {
  assert.equal(readListing(OFFER_185 + PRODUCT_END).status, "not_read");
  assert.equal(readListing(PRODUCT_END + CART).status, "not_read");
});

test("a blocked or empty response is not read", () => {
  assert.deepEqual(readListing(""), { status: "not_read", price: null });
  assert.deepEqual(readListing("<html><body>Access denied</body></html>"), { status: "not_read", price: null });
});

// No saved page was sold out or removed, so these markers are unverified against Flipkart (see the report).
test.todo("a sold-out product page is out_of_stock (needs a real sold-out page)");
test.todo("a removed product page is unavailable (needs a real removed page)");
