// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildHealthRows, buildNeedsAction, DEFAULT_FLIPKART_SETTINGS } from "./flipkart-analysis.ts";
import { ROLE_HINT, ROLE_LABEL } from "./labels.ts";
import { checkWeight, cleanSku, liveLine, liveState, NOT_FOUND_DAYS, weightWarning, type LiveFields } from "./new-listing.ts";
import { ROLES } from "./types.ts";

// --- Roles ---------------------------------------------------------------------------------------------------

test("there are three roles, and each has a label and a hint", () => {
  assert.deepEqual([...ROLES], ["owner", "admin", "warehouse"]);
  for (const role of ROLES) {
    assert.ok(ROLE_LABEL[role], role);
    assert.ok(ROLE_HINT[role], role);
  }
  assert.deepEqual(Object.keys(ROLE_LABEL).sort(), [...ROLES].sort(), "no label for a role that no longer exists");
});

// --- Weight check ------------------------------------------------------------------------------------------

test("weight check: size multiplied plus weight in grams, against the limit", () => {
  const ok = checkWeight("10", "5", "2", "0.4", 2000);
  assert.ok(ok);
  assert.deepEqual([ok.volume, ok.grams, ok.total, ok.over], [100, 400, 500, false]);

  const heavy = checkWeight(30, 20, 10, 1.25, 2000);
  assert.ok(heavy);
  assert.deepEqual([heavy.total, heavy.over, heavy.overBy], [7250, true, 5250]);
  assert.match(weightWarning(heavy), /7,250.*over the limit of 2,000 by 5,250/);

  const exactly = checkWeight(10, 10, 10, 1, 2000);
  assert.equal(exactly?.over, false, "exactly at the limit is not over it");
});

test("weight check: needs all four numbers", () => {
  assert.equal(checkWeight("", 5, 2, 0.4, 2000), null);
  assert.equal(checkWeight(10, 5, 2, "", 2000), null);
  assert.equal(checkWeight(10, 5, 0, 0.4, 2000), null);
  assert.equal(checkWeight("abc", 5, 2, 0.4, 2000), null);
});

// --- SKU -------------------------------------------------------------------------------------------------------

test("a SKU is trimmed, and must be there", () => {
  assert.deepEqual(cleanSku("  RS-500 \n"), { ok: true, sku: "RS-500" });
  assert.equal(cleanSku("").ok, false);
  assert.equal(cleanSku("    ").ok, false);
  assert.equal(cleanSku(undefined).ok, false);
  assert.equal(cleanSku("A\nB").ok, false, "a line break inside is refused");
  assert.equal(cleanSku("x".repeat(121)).ok, false);
});

// --- Live state ------------------------------------------------------------------------------------------------

const NOW = new Date("2026-10-13T10:00:00Z");
const done = (over: Partial<LiveFields>): LiveFields => ({
  status: "done",
  done_at: "2026-10-12T10:00:00Z",
  sku: "RS-500",
  live_found: null,
  live_status: null,
  live_since: null,
  live_alerted_at: null,
  live_over_weight: null,
  ...over,
});
const fmt = (iso: string) => `D(${iso})`;

test("live state: not checked yet, live, inactive, not found, and not found for long", () => {
  assert.deepEqual(liveState(done({ sku: null }), NOW), { kind: "no_sku" });
  assert.deepEqual(liveState(done({}), NOW), { kind: "not_checked" });
  assert.equal(liveLine(liveState(done({}), NOW), fmt), "Will be checked at the next daily stock sync");

  const live = liveState(done({ live_found: true, live_status: "ACTIVE", live_since: "2026-10-13" }), NOW);
  assert.deepEqual(live, { kind: "live", since: "2026-10-13", active: true, overWeight: false });
  assert.equal(liveLine(live, fmt), "Live on Flipkart ✓ since D(2026-10-13) · Active");

  const inactive = liveState(done({ live_found: true, live_status: "INACTIVE", live_since: "2026-10-13", live_over_weight: true }), NOW);
  assert.equal(liveLine(inactive, fmt), "Live on Flipkart ✓ since D(2026-10-13) · Inactive");
  assert.equal(inactive.kind === "live" && inactive.overWeight, true);

  const missing = liveState(done({ live_found: false }), NOW);
  assert.deepEqual(missing, { kind: "not_found", late: false });
  assert.equal(liveLine(missing, fmt), "Not found on Flipkart yet");
});

test(`not found is late once ${NOT_FOUND_DAYS} days have passed since it was marked done`, () => {
  const two = liveState(done({ live_found: false, done_at: "2026-10-11T10:00:01Z" }), NOW);
  assert.deepEqual(two, { kind: "not_found", late: false }, "2 days and a bit");
  const three = liveState(done({ live_found: false, done_at: "2026-10-10T10:00:00Z" }), NOW);
  assert.deepEqual(three, { kind: "not_found", late: true }, "exactly 3 days");
});

// --- Needs action and Listing health --------------------------------------------------------------------------

const LINKS = { sellerHubOrders: "https://hub.test/orders", sellerHubListings: "https://hub.test/listings" };
const baseInput = {
  now: NOW,
  staff: true,
  warehouses: [],
  cards: [],
  empties: [],
  settings: DEFAULT_FLIPKART_SETTINGS,
  priceRows: [],
  returnRates: [],
  covers: [],
  newInactive: [],
};

test("needs action lists new listings not found after 3 days, for owner and admin only", () => {
  const listingsNotFound = [{ postId: "p1", number: 1030, title: "List rat spray", sku: "RS-500", doneAt: "2026-10-09T10:00:00Z" }];
  const staff = buildNeedsAction({ ...baseInput, listingsNotFound }, LINKS);
  const section = staff.find((s) => s.key === "listings");
  assert.ok(section);
  assert.equal(section.rows[0].title, "VR-1030 · RS-500");
  assert.match(section.rows[0].detail, /4 days ago.*SKU may be wrong/);
  assert.equal(section.rows[0].actions[0].href, "/posts/p1");
  assert.deepEqual(buildNeedsAction({ ...baseInput, staff: false, listingsNotFound }, LINKS), [], "a warehouse user sees nothing new");
  assert.deepEqual(buildNeedsAction(baseInput, LINKS), [], "nothing to show when none are late");
});

test("listing health flags a new listing whose real package is over the limit", () => {
  const rows = buildHealthRows(
    [
      {
        sku: "RS-500",
        title: "Rat spray",
        status: "ACTIVE",
        packages: [{ dimensions: { length: 30, breadth: 20, height: 10 }, weight: 1.25 }],
        fulfillment: null,
        hsn: "1",
        taxCode: "2",
        taxRead: true,
        listingPost: { id: "p1", number: 1030, total: 7250 },
      },
      { sku: "FINE", title: null, status: "ACTIVE", packages: [{ dimensions: { length: 3, breadth: 2, height: 1 }, weight: 0.1 }], fulfillment: null, hsn: "1", taxCode: "2", taxRead: true },
    ],
    DEFAULT_FLIPKART_SETTINGS,
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].problems, ["over_weight"]);
  assert.equal(rows[0].listingPost?.number, 1030);
});
