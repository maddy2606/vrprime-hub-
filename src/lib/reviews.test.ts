import assert from "node:assert/strict";
import { test } from "node:test";
import { byDistanceToTarget, priorityProgress, reviewLines, reviewTotals, sortForAttention, targetProgress, toGo, type ReviewLink } from "./reviews.ts";

// Made-up listings in the shape of the tracker's links.
const link = (rowNo: number, platform: "Flipkart" | "Shopsy", sharesWith: number | null = null): ReviewLink => ({
  rowNo,
  platform,
  product: `Fake product ${rowNo}`,
  sku: `FAKE${rowNo}`,
  url: `https://www.flipkart.com/fake/p/itm${rowNo}`,
  sharesWith,
  priority: 1,
  target: null,
});

test("marks each link dropped, gained, unchanged, not checked or new", () => {
  const links = [link(1, "Flipkart"), link(2, "Flipkart"), link(3, "Shopsy"), link(4, "Shopsy"), link(5, "Flipkart")];
  const now = new Map<number, number | null>([[1, 90], [2, 120], [3, 40], [4, null], [5, 7]]);
  const before = new Map<number, number | null>([[1, 100], [2, 110], [3, 40], [4, 20]]);
  const lines = reviewLines(links, now, before);
  assert.deepEqual(
    lines.map((l) => [l.rowNo, l.status, l.change]),
    [[1, "Dropped", -10], [2, "Gained", 10], [3, "No change", 0], [4, "Not checked", null], [5, "New", null]],
  );
});

test("totals count a shared listing once and leave out links that were not read", () => {
  const links = [link(1, "Flipkart"), link(2, "Flipkart", 1), link(3, "Shopsy"), link(4, "Shopsy")];
  const now = new Map<number, number | null>([[1, 120], [2, 120], [3, 50], [4, null]]);
  const before = new Map<number, number | null>([[1, 100], [2, 100], [3, 45], [4, 30]]);
  const t = reviewTotals(reviewLines(links, now, before));
  assert.equal(t.reviews, 170);
  assert.equal(t.before, 145);
  assert.equal(t.change, 25);
  assert.deepEqual(t.byPlatform.Flipkart, { reviews: 120, before: 100, change: 20 });
  assert.deepEqual(t.byPlatform.Shopsy, { reviews: 50, before: 45, change: 5 });
  assert.equal(t.gained, 3);
  assert.equal(t.notChecked, 1);
  assert.equal(t.dropped, 0);
});

test("opens with the biggest drop, then links not read, then the biggest gain", () => {
  const links = [link(1, "Flipkart"), link(2, "Flipkart"), link(3, "Flipkart"), link(4, "Flipkart"), link(5, "Flipkart")];
  const now = new Map<number, number | null>([[1, 5], [2, 95], [3, 80], [4, null], [5, 130]]);
  const before = new Map<number, number | null>([[1, 5], [2, 100], [3, 100], [4, 10], [5, 100]]);
  assert.deepEqual(sortForAttention(reviewLines(links, now, before)).map((l) => l.rowNo), [3, 2, 4, 5, 1]);
});

test("target progress caps each link at its own target and counts links at target", () => {
  const links = [
    { ...link(1, "Flipkart"), target: 100, priority: 1 },
    { ...link(2, "Shopsy"), target: 100, priority: 1 },
    { ...link(3, "Flipkart"), target: 500, priority: 2 },
    { ...link(4, "Shopsy"), target: null, priority: 2 },
    { ...link(5, "Flipkart"), target: 200, priority: null },
  ];
  const now = new Map<number, number | null>([[1, 130], [2, 40], [3, 0], [4, 70], [5, null]]);
  const lines = reviewLines(links, now, null);
  assert.deepEqual(targetProgress(lines), { have: 140, target: 900, links: 4, atTarget: 1 });
  assert.deepEqual(
    priorityProgress(lines).map((p) => [p.priority, p.have, p.target, p.links, p.atTarget]),
    [[1, 140, 200, 2, 1], [2, 0, 500, 1, 0], [0, 0, 200, 1, 0]],
  );
  assert.deepEqual(lines.map(toGo), [0, 60, 500, null, null]);
});

test("nearest-to-target leaves out links already there, without a target or not read", () => {
  const links = [
    { ...link(1, "Flipkart"), target: 100 },
    { ...link(2, "Shopsy"), target: 100 },
    { ...link(3, "Flipkart"), target: 500 },
    { ...link(4, "Shopsy"), target: null },
    { ...link(5, "Flipkart"), target: 200 },
    { ...link(6, "Shopsy"), target: 100 },
  ];
  const now = new Map<number, number | null>([[1, 130], [2, 94], [3, 0], [4, 70], [5, null], [6, 99]]);
  const lines = reviewLines(links, now, null);
  assert.deepEqual(byDistanceToTarget(lines, "nearest").map((l) => l.rowNo), [6, 2, 3]);
  assert.deepEqual(byDistanceToTarget(lines, "furthest").map((l) => l.rowNo), [3, 2, 6]);
});
