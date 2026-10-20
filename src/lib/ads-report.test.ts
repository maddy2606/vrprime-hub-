import assert from "node:assert/strict";
import { test } from "node:test";
import { csvRows, NO_SKU, readAdsReport } from "./ads-report.ts";

// Made-up lines in the shape of Flipkart Ads' PLA Consolidated FSN Report.
const HEAD = "Campaign ID,Campaign Name,AdGroup ID,AdGroup Name,Sku Id,Product Name,Views,Clicks,Direct Units Sold,Indirect Units Sold,Total Revenue (Rs.),Conversion Rate,ROI,Ad Spend";
const report = (from: string, to: string, lines: string[]) => [`Start Time, ${from} 00:00:00`, `End Time, ${to} 23:59:59`, HEAD, ...lines].join("\r\n");

test("adds up each SKU's spend across campaigns, for the report's month", () => {
  const r = readAdsReport(
    report("2026-09-01", "2026-09-30", [
      `AAA,Rat campaign,G1,"Home, Cleaning",FAKE-RAT1,"Fake Rat Spray, 250ml",1000,50,5,1,1200.0000,0.1,3.2,300.5000`,
      `BBB,Growth,G2,Home,FAKE-RAT1,"Fake Rat Spray, 250ml",200,10,1,0,240.0000,0.1,2.0,99.5000`,
      `CCC,Lint,G3,Home,FAKE-LINT2,Fake Lint Remover,500,20,2,0,700.0000,0.1,5.0,140.0000`,
      `DDD,Brand,G4,Home,,Store page,50,1,0,0,0.0000,0,0,10.0000`,
    ]),
  );
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.report.month, "2026-09");
  assert.equal(r.report.lines, 4);
  assert.equal(r.report.spend, 550);
  const rat = r.report.rows.find((x) => x.sku === "FAKE-RAT1")!;
  assert.deepEqual(rat, { sku: "FAKE-RAT1", spend: 400, views: 1200, clicks: 60, direct_units: 6, indirect_units: 1, revenue: 1440 });
  assert.equal(r.report.rows.find((x) => x.sku === NO_SKU)?.spend, 10, "spend with no SKU is kept, not lost");
});

test("refuses other files and reports that span two months", () => {
  assert.equal(readAdsReport("Campaign ID,Date,Ad Spend\nA,2026-09-01,10").ok, false);
  const two = readAdsReport(report("2026-09-15", "2026-10-14", []));
  assert.equal(two.ok, false);
  if (!two.ok) assert.match(two.error, /one calendar month/);
});

test("CSV fields may hold commas, quotes and a byte order mark", () => {
  assert.deepEqual(csvRows('﻿a,"b, c","say ""hi"""\r\n1,2,3'), [["a", "b, c", 'say "hi"'], ["1", "2", "3"]]);
});

test("the Ads tracker keeps each SKU and campaign apart, for any period up to 92 days", async () => {
  const { readAdsCampaignReport } = await import("./ads-report.ts");
  const r = readAdsCampaignReport(
    report("2026-10-13", "2026-10-19", [
      `aaa111,Rat Auto,G1,"Home, Cleaning",fake-rat1,"Fake Rat Spray, 250ml",1000,50,5,1,1200.0000,0.1,3.2,300.5000`,
      `AAA111,Rat Auto,G2,Home,FAKE-RAT1,Fake Rat Spray,500,10,1,0,200.0000,0.1,3.2,99.5000`,
      `BBB222,Kickstart,G1,Home,FAKE-RAT1,Fake Rat Spray,100,2,0,0,0,0,0,10`,
      `BBB222,Kickstart,G1,Home,FAKE-LIZ1,Fake Lizard Spray,100,2,1,0,150,0,0,20`,
    ]),
  );
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.report.days, 7);
  assert.equal(r.report.rows.length, 3);
  const rat = r.report.rows.find((x) => x.sku === "FAKE-RAT1" && x.campaign_id === "AAA111");
  assert.deepEqual(rat, { sku: "FAKE-RAT1", campaign_id: "AAA111", campaign_name: "Rat Auto", spend: 400, views: 1500, clicks: 60, units: 7, revenue: 1400 });
  assert.equal(r.report.spend, 430);
  const long = readAdsCampaignReport(report("2026-01-01", "2026-06-30", []));
  assert.equal(long.ok, false);
});

test("days a campaign ran inside a scan's period", async () => {
  const { daysActive, daysBetween } = await import("./ads-report.ts");
  assert.equal(daysBetween("2026-09-21", "2026-10-19"), 29);
  assert.equal(daysActive("2026-09-21", "2026-10-19", "2026-09-30"), 20);
  assert.equal(daysActive("2026-09-21", "2026-10-19", "2026-09-01"), 29);
  assert.equal(daysActive("2026-09-21", "2026-10-19", null), 29);
  assert.equal(daysActive("2026-09-21", "2026-10-19", "2026-10-19"), 1);
  assert.equal(daysActive("2026-09-21", "2026-10-19", "2026-11-01"), 29);
});
