/**
 * Reading the number of written reviews off a Flipkart or Shopsy page. Pure, so it can be tested without the network.
 *
 * Both sites print "134 ratings and 123 reviews" (singular when 1) near the top of a product's page and of its
 * /product-reviews/ page. The second number is the written reviews; the first counts star-only ratings too.
 */

const COUNTS = /([\d,]+)\s*ratings?\s*and\s*([\d,]+)\s*reviews?/i;

/** The /product-reviews/ page for a product link: the same path with /p/ swapped. */
export function reviewsPageUrl(productUrl: string): string {
  return productUrl.replace("/p/", "/product-reviews/");
}

/** Written reviews printed on the page, or null when the page does not say. */
export function readReviewCount(html: string): number | null {
  const m = COUNTS.exec(html);
  if (!m) return null;
  const n = Number(m[2].replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * A product page with no ratings at all prints no counts. It is read as 0 only when the page is clearly this product's
 * own page (its ID is on it) and mentions no ratings anywhere; a block page, a captcha or an error page is not a 0.
 */
export function isUnratedProductPage(html: string, productId: string): boolean {
  if (!productId || !html.includes(productId)) return false;
  return !/\bratings?\b/i.test(html);
}
