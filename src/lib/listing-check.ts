/**
 * Listing check (graphite-spec 12.3): whether a Flipkart or Shopsy product page can be bought, and the price the buyer
 * sees. Pure, so it can be tested without the network.
 *
 * Read from five Flipkart product pages saved on 16 Nov 2026:
 * - the page's schema.org Product block carries `"offers":{"price":185,"priceCurrency":"INR","availability":
 *   "https://schema.org/InStock"}` (the slashes are sometimes written /); that price is the one on the
 *   "Buy at ₹185" button, so it is the buyer's price. The page has other "offers" objects; this one has a currency;
 * - the buy controls are `"productActionButtonType":"CART_ADD","text":"Add to cart"` and `"BUY_NOW"` ("Buy at ₹…").
 * None of the five was sold out or removed, so the out-of-stock and unavailable markers below are the spec's words and
 * schema.org's OutOfStock, not seen on a real page (unverified).
 */

export type ListingStatus = "buyable" | "out_of_stock" | "unavailable" | "not_read";

const PRODUCT = /"@type"\s*:\s*"Product"/;
// The offer's first 400 characters: it holds nested objects (shippingDetails), and price, currency and availability come first.
const OFFERS = /"offers"\s*:\s*\{([\s\S]{0,400})/g;
const BUY_CONTROL = /"productActionButtonType"\s*:\s*"(CART_ADD|BUY_NOW)"/;
const SOLD_OUT_TEXT = /\b(sold out|out of stock|currently unavailable)\b/i;
const SOLD_OUT_SCHEMA = /schema\.org\/(OutOfStock|SoldOut|Discontinued)/i;
const NO_PRODUCT = /(page you are looking for|has been moved or deleted|product (is )?(not found|no longer available))/i;

const unescape = (s: string) => s.replace(/\\u002f/gi, "/");

/** The schema.org offer: the first "offers" object with a price currency. */
function schemaOffer(html: string): string | null {
  for (const m of html.matchAll(OFFERS)) if (/"priceCurrency"/.test(m[1])) return m[1];
  return null;
}

/** The buyer's price from the Product block's offer, or null. */
export function readPrice(html: string): number | null {
  const offer = schemaOffer(unescape(html));
  if (!offer) return null;
  const m = /"price"\s*:\s*"?([\d.]+)"?/.exec(offer);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** buyable, out_of_stock, unavailable or not_read (anything else, a blocked request included). */
export function readListing(html: string): { status: ListingStatus; price: number | null } {
  const text = unescape(html ?? "");
  if (!PRODUCT.test(text)) {
    return { status: NO_PRODUCT.test(text) ? "unavailable" : "not_read", price: null };
  }
  const price = readPrice(text);
  const offer = schemaOffer(text) ?? "";
  if (SOLD_OUT_SCHEMA.test(offer) || SOLD_OUT_TEXT.test(text)) return { status: "out_of_stock", price };
  if (price !== null && /schema\.org\/InStock/i.test(offer) && BUY_CONTROL.test(text)) return { status: "buyable", price };
  return { status: "not_read", price };
}
