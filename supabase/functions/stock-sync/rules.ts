// Turning Flipkart's listing details into what we save, and leaving FBF listings out.
// Pure functions, no network: easy to test.

export type Location = { id: string; status: string | null; inventory: number | null };

export type Package = {
  id: string | null;
  name: string | null;
  dimensions: { length: number | null; breadth: number | null; height: number | null };
  weight: number | null;
  handling: unknown;
};

/** What the database function stock_apply_batch expects for each listing. */
export type NormalizedListing = {
  sku: string;
  listing_id: string | null;
  product_id: string | null;
  title: string | null;
  product_url: string | null;
  status: string;
  mrp: number | null;
  selling_price: number | null;
  currency: string | null;
  fulfillment_profile: string | null;
  fulfillment: Record<string, unknown> | null;
  packages: Package[];
  archived_status: string | null;
  locations: Location[];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  if (typeof value === "string") return value.trim() === "" ? null : value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function number(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** FBF and FBF_LITE listings are fulfilled by Flipkart: their stock is not ours to track. */
export function isFbf(profile: unknown): boolean {
  return typeof profile === "string" && profile.trim().toUpperCase().startsWith("FBF");
}

export function normalizeListing(sku: string, raw: unknown): NormalizedListing | null {
  if (!isObject(raw)) return null;
  const price = isObject(raw.price) ? raw.price : {};
  const packages = Array.isArray(raw.packages) ? raw.packages : [];
  const locations = Array.isArray(raw.locations) ? raw.locations : [];

  return {
    sku,
    listing_id: text(raw.listing_id),
    product_id: text(raw.product_id),
    title: text(raw.product_title),
    product_url: text(raw.product_url),
    status: (text(raw.listing_status) ?? "UNKNOWN").toUpperCase(),
    mrp: number(price.mrp),
    selling_price: number(price.selling_price),
    currency: text(price.currency),
    fulfillment_profile: text(raw.fulfillment_profile),
    fulfillment: isObject(raw.fulfillment) ? raw.fulfillment : null,
    packages: packages.filter(isObject).map((p) => {
      const d = isObject(p.dimensions) ? p.dimensions : {};
      return {
        id: text(p.id),
        name: text(p.name),
        dimensions: { length: number(d.length), breadth: number(d.breadth), height: number(d.height) },
        weight: number(p.weight),
        handling: p.handling ?? null,
      };
    }),
    archived_status: text(raw.archived_status),
    locations: locations
      .filter(isObject)
      .map((l) => ({ id: text(l.id) ?? "", status: text(l.status), inventory: number(l.inventory) }))
      .filter((l) => l.id !== ""),
  };
}

/**
 * Sorts one batch of Flipkart's answer: listings to save, FBF ones to skip (counted),
 * and ones whose details were missing or unreadable (counted as missing).
 */
export function splitBatch(
  requested: string[],
  available: Record<string, unknown>,
): { items: NormalizedListing[]; fbf: number; missing: number } {
  const items: NormalizedListing[] = [];
  let fbf = 0;
  let missing = 0;
  for (const sku of requested) {
    if (!(sku in available)) {
      missing += 1;
      continue;
    }
    const listing = normalizeListing(sku, available[sku]);
    if (!listing) {
      missing += 1;
    } else if (isFbf(listing.fulfillment_profile)) {
      fbf += 1;
    } else {
      items.push(listing);
    }
  }
  return { items, fbf, missing };
}
