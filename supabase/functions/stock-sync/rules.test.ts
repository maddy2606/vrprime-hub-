// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { isFbf, normalizeListing, splitBatch } from "./rules.ts";

// Shaped like the answer Flipkart gives (fake values).
const sample = {
  listing_id: "LSTFAKE1",
  product_id: "PRODFAKE1",
  product_title: "  Fake Steel Bottle 750 ml  ",
  product_url: "https://example.test/p/fake",
  listing_status: "active",
  price: { mrp: 999, selling_price: "599.50", currency: "INR" },
  fulfillment_profile: "NON_FBF",
  fulfillment: { dispatch_sla: 2, shipping_provider: "FLIPKART", procurement_type: "REGULAR" },
  packages: [{ id: "PK1", name: "Box", dimensions: { length: 20, breadth: 10, height: 5 }, weight: 0.5, handling: { fragile: false } }],
  locations: [
    { id: "LOC-A", status: "ACTIVE", inventory: 120 },
    { id: "LOC-B", status: "ACTIVE", inventory: "35" },
    { id: "", status: "ACTIVE", inventory: 3 },
    { id: "LOC-C", status: "INACTIVE" },
  ],
  archived_status: "NOT_ARCHIVED",
};

test("FBF and FBF_LITE are skipped, NON_FBF and missing profiles are kept", () => {
  assert.equal(isFbf("FBF"), true);
  assert.equal(isFbf("FBF_LITE"), true);
  assert.equal(isFbf(" fbf_lite "), true);
  assert.equal(isFbf("NON_FBF"), false);
  assert.equal(isFbf(null), false);
  assert.equal(isFbf(undefined), false);
  assert.equal(isFbf(""), false);
});

test("normalises a Flipkart listing", () => {
  const n = normalizeListing("SKU1", sample);
  assert.ok(n);
  assert.equal(n.sku, "SKU1");
  assert.equal(n.title, "Fake Steel Bottle 750 ml");
  assert.equal(n.status, "ACTIVE");
  assert.equal(n.mrp, 999);
  assert.equal(n.selling_price, 599.5);
  assert.equal(n.currency, "INR");
  assert.equal(n.fulfillment_profile, "NON_FBF");
  assert.deepEqual(n.packages[0].dimensions, { length: 20, breadth: 10, height: 5 });
  assert.equal(n.packages[0].weight, 0.5);
  assert.deepEqual(n.locations, [
    { id: "LOC-A", status: "ACTIVE", inventory: 120 },
    { id: "LOC-B", status: "ACTIVE", inventory: 35 },
    { id: "LOC-C", status: "INACTIVE", inventory: null },
  ]);
});

test("copes with odd or empty answers", () => {
  assert.equal(normalizeListing("X", null), null);
  assert.equal(normalizeListing("X", "nope"), null);
  assert.equal(normalizeListing("X", []), null);
  const bare = normalizeListing("X", {});
  assert.ok(bare);
  assert.equal(bare.status, "UNKNOWN");
  assert.deepEqual(bare.packages, []);
  assert.deepEqual(bare.locations, []);
  const odd = normalizeListing("Y", { packages: [{ dimensions: { length: "x", breadth: null } }, 5], price: "free" });
  assert.ok(odd);
  assert.deepEqual(odd.packages[0].dimensions, { length: null, breadth: null, height: null });
  assert.equal(odd.mrp, null);
});

test("sorts a batch into listings to save, FBF skipped and missing", () => {
  const available = {
    A: { ...sample, listing_id: "A" },
    B: { ...sample, listing_id: "B", fulfillment_profile: "FBF" },
    C: { ...sample, listing_id: "C", fulfillment_profile: "FBF_LITE" },
    D: "unreadable",
  };
  const { items, fbf, missing } = splitBatch(["A", "B", "C", "D", "E"], available);
  assert.deepEqual(items.map((i) => i.sku), ["A"]);
  assert.equal(fbf, 2);
  assert.equal(missing, 2); // D could not be read, E was not in the answer
});
