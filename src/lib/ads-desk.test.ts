import assert from "node:assert/strict";
import { test } from "node:test";
import { campaigns, DESK_DEFAULTS as S, finish, flow, keywords, negatives, rangeFor, readDeskData, spikes, verdict, weekdays, type DailyRow } from "./ads-desk.ts";

const m = (spend: number, rev: number, units: number, clicks = 50, views = 1000) => ({ spend, rev, units, clicks, views });
const day = (d: string, cid: string, spend: number, rev: number, units: number, clicks = 50): DailyRow => ({ day: d, cid, name: cid, ...m(spend, rev, units, clicks) });

test("results follow the ROI lines (break-even 4, good 7, ₹150, 15 clicks, 3 units)", () => {
  assert.equal(finish(m(1000, 8000, 10), S).v, "winner");
  assert.equal(finish(m(1000, 8000, 2), S).v, "promising", "good ROI but few units");
  assert.equal(finish(m(1000, 5000, 10), S).v, "ok");
  assert.equal(finish(m(1000, 3000, 10), S).v, "losing");
  assert.equal(finish(m(1000, 0, 0), S).v, "zero");
  assert.equal(finish(m(100, 0, 0, 5), S).v, "early", "under ₹150 and under 15 clicks");
  assert.equal(verdict({ ...m(100, 0, 0, 20), roi: 0 }, S), "early", "enough clicks but no sale and little spend");
  const f = finish(m(200, 800, 4, 40, 2000), S);
  assert.deepEqual([f.roi, f.cpc, f.rpc, f.cvr, f.ctr], [4, 5, 20, 0.1, 0.02]);
});

test("dates: the last 10 days leave out today and yesterday, with the same days before", () => {
  const days = Array.from({ length: 42 }, (_, i) => new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10)); // 1 Oct to 11 Nov
  const r = rangeFor(days, "10x", "2026-11-12")!;
  assert.deepEqual([r.from, r.to, r.len, r.pFrom, r.pTo, r.hasPrev], ["2026-11-01", "2026-11-10", 10, "2026-10-22", "2026-10-31", true]);
  const w = rangeFor(days, "7", "2026-11-12")!;
  assert.deepEqual([w.from, w.to, w.pFrom, w.pTo], ["2026-11-05", "2026-11-11", "2026-10-29", "2026-11-04"]);
  assert.equal(rangeFor(days, "all", "2026-11-12")!.hasPrev, false);
  assert.equal(rangeFor([], "7", "2026-11-12"), null);
});

test("campaigns against the days before: worse when ROI falls a quarter or sales stop", () => {
  const daily = [
    day("2026-11-01", "A", 1000, 6000, 20), day("2026-11-02", "A", 1000, 2500, 8), // ROI 6 → 2.5
    day("2026-11-01", "B", 500, 2500, 5), day("2026-11-02", "B", 500, 0, 0), // sales stopped
    day("2026-11-01", "C", 400, 2000, 4), day("2026-11-02", "C", 400, 1900, 4), // steady
    day("2026-11-02", "D", 300, 3000, 6), // new
  ];
  const rows = campaigns(daily, { min: "2026-11-01", max: "2026-11-02", from: "2026-11-02", to: "2026-11-02", len: 1, pFrom: "2026-11-01", pTo: "2026-11-01", hasPrev: true }, S);
  const by = Object.fromEntries(rows.map((r) => [r.cid, r]));
  assert.equal(rows[0].cid, "A", "biggest spend first");
  assert.ok(by.A.worse && by.A.why[0].includes("6.00 → 2.50"));
  assert.ok(by.B.worse && by.B.why[0].startsWith("sales stopped"));
  assert.equal(by.B.v, "zero");
  assert.equal(by.C.worse, false);
  assert.equal(by.D.prev, null);
});

test("bids to cut: a keyword paying more per click than it earns back at break-even", () => {
  const k = keywords(
    [
      { cid: "A", name: "A", kw: "rat spray", mt: "EXACT", ...m(600, 1200, 6, 60) }, // CPC 10, earns 20 a click, break-even bid 5
      { cid: "A", name: "A", kw: "lizard spray", mt: "PHRASE", ...m(300, 0, 0, 30) }, // no sale
      { cid: "A", name: "A", kw: "bed bug", mt: "EXACT", ...m(200, 2000, 5, 40) }, // fine
    ],
    S,
  );
  const by = Object.fromEntries(k.map((x) => [x.kw, x]));
  assert.deepEqual([by["rat spray"].beCpc, by["rat spray"].cut, by["rat spray"].excess], [5, true, 300]);
  assert.deepEqual([by["lizard spray"].cut, by["lizard spray"].excess], [true, 300]);
  assert.equal(by["bed bug"].cut, false);
});

test("negative keywords: ₹150+ with no sale, or under half break-even; decisions are remembered", () => {
  const rows = [
    { cid: "A", name: "A", term: "free sample", ...m(400, 0, 0) },
    { cid: "A", name: "A", term: "cheap spray", ...m(300, 450, 1) }, // ROI 1.5, under 2
    { cid: "A", name: "A", term: "rat spray", ...m(300, 900, 3) }, // ROI 3: losing but not a negative
    { cid: "B", name: "B", term: "free sample", ...m(100, 0, 0) }, // too small
  ];
  const n = negatives(rows, [{ cid: "A", term: "cheap spray", status: "ignored" }], S);
  assert.deepEqual(n.map((x) => [x.term, x.status]), [["free sample", "todo"], ["cheap spray", "ignored"]]);
});

test("spend spikes, the split by result and the weekday picture", () => {
  const daily = ["01", "02", "03", "04", "05"].map((d, i) => day(`2026-11-${d}`, "A", i === 4 ? 2000 : 500, 3000, 6));
  const sp = spikes(daily, { min: "2026-11-01", max: "2026-11-05", from: "2026-11-01", to: "2026-11-05", len: 5, pFrom: "", pTo: "", hasPrev: false }, S);
  assert.deepEqual(sp.map((x) => [x.day, x.ratio]), [["2026-11-05", 4]]);
  const f = flow([finish(m(1000, 8000, 10), S), finish(m(3000, 6000, 10), S)]);
  assert.deepEqual(f.map((g) => [g.v, g.share]), [["winner", 0.25], ["losing", 0.75]]);
  const w = weekdays(daily, "2026-11-01", "2026-11-05", S);
  assert.equal(w[0].name, "Monday");
  assert.deepEqual([w[6].name, w[6].days, w[6].spend], ["Sunday", 1, 500], "1 Nov 2026 is a Sunday");
});

test("the database's answer is read into named rows", () => {
  const d = readDeskData({
    daily: [["2026-11-01", "C1", "Camp", 10.5, 100, 4, 1, 99]],
    fsn: { from: "2026-11-01", to: "2026-11-07", at: "x", rows: [["SKU1", "C1", "Camp", 5, 50, 2, 1, 40]] },
    st: { from: "2026-11-01", to: "2026-11-07", at: "x", lines: 9, rows: [["C1", "Camp", "rat spray", 100, 4, 20, 1, 99]], rest: [["C1", 10, 2, 6, 3]] },
    kw: null,
    pl: null,
    neg: [["C1", "free", "added"]],
  });
  assert.deepEqual(d.daily[0], { day: "2026-11-01", cid: "C1", name: "Camp", spend: 10.5, views: 100, clicks: 4, units: 1, rev: 99 });
  assert.equal(d.fsn?.rows[0].sku, "SKU1");
  assert.deepEqual([d.st?.rows[0].term, d.st?.rest[0].terms, d.st?.lines], ["rat spray", 3, 9]);
  assert.equal(d.kw, null);
  assert.deepEqual(d.neg, [{ cid: "C1", term: "free", status: "added" }]);
  assert.deepEqual(readDeskData(null), { daily: [], fsn: null, st: null, kw: null, pl: null, neg: [] });
});

test("placements: page order, short names, and product-page leaks under break-even", async () => {
  const { placements, productPageLeaks } = await import("./ads-desk.ts");
  const rows = [
    { cid: "A", name: "A", pl: "Product Page", ...m(600, 1200, 4) },
    { cid: "A", name: "A", pl: "Top of Search Listings Page", ...m(400, 4000, 20) },
    { cid: "B", name: "B", pl: "Product Page", ...m(100, 0, 0) },
    { cid: "B", name: "B", pl: "Home Page", ...m(50, 500, 2) },
  ];
  assert.deepEqual(placements(rows, S).map((p) => [p.short, p.spend]), [["Top of search", 400], ["Product pages", 700], ["Home page", 50]]);
  assert.deepEqual(placements(rows, S, "B").map((p) => p.short), ["Product pages", "Home page"]);
  assert.deepEqual(productPageLeaks(rows, S).map((x) => [x.cid, x.roi]), [["A", 2]], "B spent under ₹150 there");
});
