import assert from "node:assert/strict";
import { test } from "node:test";
import { isUnratedProductPage, readReviewCount, reviewsPageUrl } from "./review-count.ts";

test("reads the written reviews, not the ratings", () => {
  assert.equal(readReviewCount(`<div><span>2,301 Ratings &amp; </span></div><span>2,301 ratings and 239 reviews</span>`), 239);
  assert.equal(readReviewCount("<span>1 rating and 1 review</span>"), 1);
  assert.equal(readReviewCount("<span>7 ratings and 0 reviews</span>"), 0);
  assert.equal(readReviewCount("<span>1,204 Ratings and 1,050 Reviews</span>"), 1050);
});

test("says nothing when the page has no counts", () => {
  assert.equal(readReviewCount("<html><body>503 Service Unavailable</body></html>"), null);
});

test("an unrated product page is 0 only when it is that product's own page", () => {
  assert.equal(isUnratedProductPage(`<html>FAKEPID123 Fake Spray Be the first to review this product</html>`, "FAKEPID123"), true);
  assert.equal(isUnratedProductPage(`<html>FAKEPID123 4.1 ★ 12 Ratings</html>`, "FAKEPID123"), false);
  assert.equal(isUnratedProductPage(`<html>Are you a human? Please verify</html>`, "FAKEPID123"), false);
});

test("the reviews page swaps /p/ in the link", () => {
  assert.equal(reviewsPageUrl("https://www.flipkart.com/x/p/itm1?pid=AB"), "https://www.flipkart.com/x/product-reviews/itm1?pid=AB");
});
