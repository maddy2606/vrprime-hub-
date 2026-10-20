// Reads Flipkart Ads' PLA "Consolidated FSN Report" (CSV), as plain functions (no imports, so `node --test` can load them).
// The file starts with two lines giving the period ("Start Time, 2026-09-01 00:00:00" and "End Time, ..."), then a header
// row and one row per campaign, ad group and SKU. "Sku Id" is the seller's own Flipkart SKU.

export type AdSkuRow = { sku: string; spend: number; views: number; clicks: number; direct_units: number; indirect_units: number; revenue: number };
export type AdsReport = { month: string; from: string; to: string; rows: AdSkuRow[]; spend: number; lines: number };

/** The SKU ad spend with no SKU on its line is kept under. */
export const NO_SKU = "(no SKU)";

/** Splits CSV text into rows of fields (quoted fields may hold commas, quotes and new lines). */
export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

const num = (v: string | undefined) => {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Reads the report, adding up each SKU's lines. Returns an error in plain words when the file is not this report. */
export function readAdsReport(text: string): { ok: true; report: AdsReport } | { ok: false; error: string } {
  const rows = csvRows(text);
  const period = (label: string) => rows.find((r) => r[0]?.trim().toLowerCase() === label)?.[1]?.trim().slice(0, 10) ?? "";
  const from = period("start time");
  const to = period("end time");
  const h = rows.findIndex((r) => r.some((f) => f.trim() === "Sku Id") && r.some((f) => f.trim() === "Ad Spend"));
  if (h < 0) return { ok: false, error: "This is not a PLA Consolidated FSN Report: it has no Sku Id and Ad Spend columns. In Flipkart Ads, open Reports, Other Reports, choose PLA and Consolidated FSN Report." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return { ok: false, error: "The report's Start Time and End Time lines are missing, so its month is not known." };
  if (from.slice(0, 7) !== to.slice(0, 7)) return { ok: false, error: `The report runs from ${from} to ${to}. Download it for one calendar month (for example 1 to 30 September) so the spend goes to the right month.` };
  const head = rows[h].map((f) => f.trim());
  const at = (name: string) => head.indexOf(name);
  const i = { sku: at("Sku Id"), spend: at("Ad Spend"), views: at("Views"), clicks: at("Clicks"), direct: at("Direct Units Sold"), indirect: at("Indirect Units Sold"), revenue: at("Total Revenue (Rs.)") };
  const bySku = new Map<string, AdSkuRow>();
  let lines = 0;
  for (const r of rows.slice(h + 1)) {
    if (r.length < head.length - 1) continue;
    lines++;
    const sku = (r[i.sku] ?? "").trim() || NO_SKU;
    const cur = bySku.get(sku) ?? { sku, spend: 0, views: 0, clicks: 0, direct_units: 0, indirect_units: 0, revenue: 0 };
    cur.spend = round2(cur.spend + num(r[i.spend]));
    if (i.views >= 0) cur.views += num(r[i.views]);
    if (i.clicks >= 0) cur.clicks += num(r[i.clicks]);
    if (i.direct >= 0) cur.direct_units += num(r[i.direct]);
    if (i.indirect >= 0) cur.indirect_units += num(r[i.indirect]);
    if (i.revenue >= 0) cur.revenue = round2(cur.revenue + num(r[i.revenue]));
    bySku.set(sku, cur);
  }
  const list = [...bySku.values()];
  return { ok: true, report: { month: from.slice(0, 7), from, to, rows: list, spend: round2(list.reduce((n, r) => n + r.spend, 0)), lines } };
}

// ---- The Ads tracker: the same report, kept per SKU and campaign -----------------------------------------------------

export type AdCampaignRow = { sku: string; campaign_id: string; campaign_name: string; spend: number; views: number; clicks: number; units: number; revenue: number };
export type AdsCampaignReport = { from: string; to: string; days: number; rows: AdCampaignRow[]; spend: number; lines: number };

/** Days from one ISO day to another, both counted (2026-10-01 to 2026-10-07 is 7). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * Days a campaign ran inside a scan's period: from its start date (or the period's start, if later) to the period's end.
 * Without a known start date, the whole period. Never less than 1.
 */
export function daysActive(periodStart: string, periodEnd: string, startDate: string | null | undefined): number {
  const all = daysBetween(periodStart, periodEnd);
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return all;
  if (startDate > periodEnd) return all;
  const from = startDate > periodStart ? startDate : periodStart;
  return Math.max(1, daysBetween(from, periodEnd));
}

/**
 * Reads the report for the Ads tracker: one row per SKU and campaign (ad groups added together), for any period up to
 * 92 days. Returns an error in plain words when the file is not this report.
 */
export function readAdsCampaignReport(text: string): { ok: true; report: AdsCampaignReport } | { ok: false; error: string } {
  const rows = csvRows(text);
  const period = (label: string) => rows.find((r) => r[0]?.trim().toLowerCase() === label)?.[1]?.trim().slice(0, 10) ?? "";
  const from = period("start time");
  const to = period("end time");
  const h = rows.findIndex((r) => r.some((f) => f.trim() === "Sku Id") && r.some((f) => f.trim() === "Ad Spend"));
  if (h < 0) return { ok: false, error: "This is not a PLA Consolidated FSN Report: it has no Sku Id and Ad Spend columns. In Seller Hub open Ads, Reports, Other Reports, choose PLA and Consolidated FSN Report." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return { ok: false, error: "The report's Start Time and End Time lines are missing, so its period is not known." };
  const days = daysBetween(from, to);
  if (days < 1 || days > 92) return { ok: false, error: `The report runs from ${from} to ${to}. Download it for 92 days or fewer (7 days is the usual).` };
  const head = rows[h].map((f) => f.trim());
  const at = (name: string) => head.indexOf(name);
  const i = { id: at("Campaign ID"), name: at("Campaign Name"), sku: at("Sku Id"), spend: at("Ad Spend"), views: at("Views"), clicks: at("Clicks"), direct: at("Direct Units Sold"), indirect: at("Indirect Units Sold"), revenue: at("Total Revenue (Rs.)") };
  if (i.id < 0) return { ok: false, error: "The report has no Campaign ID column. Download the PLA Consolidated FSN Report again from Seller Hub." };
  const byKey = new Map<string, AdCampaignRow>();
  let lines = 0;
  for (const r of rows.slice(h + 1)) {
    if (r.length < head.length - 1) continue;
    const campaign_id = (r[i.id] ?? "").trim().toUpperCase();
    if (!campaign_id) continue;
    lines++;
    const sku = (r[i.sku] ?? "").trim().toUpperCase() || NO_SKU;
    const key = `${sku}\u0000${campaign_id}`;
    const cur = byKey.get(key) ?? { sku, campaign_id, campaign_name: (i.name >= 0 ? r[i.name] : "")?.trim() || campaign_id, spend: 0, views: 0, clicks: 0, units: 0, revenue: 0 };
    cur.spend = round2(cur.spend + num(r[i.spend]));
    if (i.views >= 0) cur.views += num(r[i.views]);
    if (i.clicks >= 0) cur.clicks += num(r[i.clicks]);
    if (i.direct >= 0) cur.units += num(r[i.direct]);
    if (i.indirect >= 0) cur.units += num(r[i.indirect]);
    if (i.revenue >= 0) cur.revenue = round2(cur.revenue + num(r[i.revenue]));
    byKey.set(key, cur);
  }
  const list = [...byKey.values()];
  return { ok: true, report: { from, to, days, rows: list, spend: round2(list.reduce((n, r) => n + r.spend, 0)), lines } };
}
