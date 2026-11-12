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

// ---- The Consolidated Daily Report: every campaign, day by day (the true spend) ---------------------------------------

export type AdDailyRow = { day: string; campaign_id: string; campaign_name: string; spend: number; views: number; clicks: number; units: number; revenue: number };
export type AdsDailyReport = { from: string; to: string; days: number; rows: AdDailyRow[]; spend: number };

/** Which Seller Hub ads report a file is: the per-SKU FSN report, the per-day campaign report, or neither. */
export function adsReportKind(text: string): "fsn" | "daily" | null {
  const head = csvRows(text.slice(0, 4000)).find((r) => r.some((f) => f.trim() === "Campaign ID"))?.map((f) => f.trim()) ?? [];
  if (head.includes("Sku Id") && head.includes("Ad Spend")) return "fsn";
  if (head.includes("Date") && head.includes("Ad Spend")) return "daily";
  return null;
}

/** Reads the PLA Consolidated Daily Report: one row per campaign per day. Lines outside the report's own dates are left out. */
export function readAdsDailyReport(text: string): { ok: true; report: AdsDailyReport } | { ok: false; error: string } {
  const rows = csvRows(text);
  const period = (label: string) => rows.find((r) => r[0]?.trim().toLowerCase() === label)?.[1]?.trim().slice(0, 10) ?? "";
  const from = period("start time");
  const to = period("end time");
  const h = rows.findIndex((r) => r.some((f) => f.trim() === "Campaign ID") && r.some((f) => f.trim() === "Date") && r.some((f) => f.trim() === "Ad Spend"));
  if (h < 0) return { ok: false, error: "This is not a PLA Consolidated Daily Report: it has no Campaign ID, Date and Ad Spend columns." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return { ok: false, error: "The report's Start Time and End Time lines are missing, so its period is not known." };
  const days = daysBetween(from, to);
  if (days < 1 || days > 92) return { ok: false, error: `The report runs from ${from} to ${to}. Download it for one month or less.` };
  const head = rows[h].map((f) => f.trim());
  const at = (name: string) => head.indexOf(name);
  const i = { id: at("Campaign ID"), name: at("Campaign Name"), day: at("Date"), spend: at("Ad Spend"), views: at("Views"), clicks: at("Clicks"), units: at("Total converted units"), revenue: at("Total Revenue (Rs.)") };
  const out: AdDailyRow[] = [];
  for (const r of rows.slice(h + 1)) {
    const campaign_id = (r[i.id] ?? "").trim().toUpperCase();
    const d = (r[i.day] ?? "").trim().slice(0, 10);
    if (!campaign_id || !/^\d{4}-\d{2}-\d{2}$/.test(d) || d < from || d > to) continue;
    out.push({
      day: d,
      campaign_id,
      campaign_name: (i.name >= 0 ? r[i.name] : "")?.trim() || campaign_id,
      spend: round2(num(r[i.spend])),
      views: i.views >= 0 ? num(r[i.views]) : 0,
      clicks: i.clicks >= 0 ? num(r[i.clicks]) : 0,
      units: i.units >= 0 ? num(r[i.units]) : 0,
      revenue: i.revenue >= 0 ? round2(num(r[i.revenue])) : 0,
    });
  }
  return { ok: true, report: { from, to, days, rows: out, spend: round2(out.reduce((n, r) => n + r.spend, 0)) } };
}

/**
 * Whether an FSN (per-SKU) report holds all the spend: its total against the daily report's for the same days. Null when the
 * daily record does not cover those days. A report under 95% of the true spend is called incomplete.
 */
export function fsnCoverage(fsnSpend: number, dailySpend: number | null): { pct: number; complete: boolean } | null {
  if (dailySpend === null || dailySpend <= 0) return null;
  const pct = Math.round((fsnSpend / dailySpend) * 100);
  return { pct, complete: pct >= 95 };
}

// ---- The Search Term and Keyword reports (Ads Desk) --------------------------------------------------------------------

export type AdTermRow = { campaign_id: string; campaign_name: string; term: string; match_type: string; views: number; clicks: number; spend: number; units: number; revenue: number };
export type AdsTermReport = { kind: "st" | "kw"; from: string; to: string; rows: AdTermRow[]; spend: number; lines: number };

/** Which of the four Seller Hub ads reports a file is. */
export function adsFileKind(text: string): "fsn" | "daily" | "st" | "kw" | null {
  const head = csvRows(text.slice(0, 6000)).find((r) => r.some((f) => f.trim() === "Campaign ID"))?.map((f) => f.trim()) ?? [];
  if (head.includes("Query")) return "st";
  if (head.includes("attributed_keyword")) return "kw";
  return adsReportKind(text);
}

/**
 * Reads a Search Term or Keyword report, added up per campaign and term (keywords: per match type too). Lines with no
 * click, no spend and no sale are left out: a Search Term report is mostly those.
 */
export function readAdsTermReport(text: string): { ok: true; report: AdsTermReport } | { ok: false; error: string } {
  const rows = csvRows(text);
  const period = (label: string) => rows.slice(0, 6).find((r) => r[0]?.trim().toLowerCase() === label)?.[1]?.trim().slice(0, 10) ?? "";
  const from = period("start time");
  const to = period("end time");
  const h = rows.findIndex((r) => r.some((f) => f.trim() === "Campaign ID") && r.some((f) => f.trim() === "Clicks"));
  const head = h < 0 ? [] : rows[h].map((f) => f.trim());
  const at = (name: string) => head.indexOf(name);
  const kind = head.includes("Query") ? "st" : head.includes("attributed_keyword") ? "kw" : null;
  if (!kind) return { ok: false, error: "This is not a Search Term or Keyword report: it has no Query or attributed_keyword column." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return { ok: false, error: "The report's Start Time and End Time lines are missing, so its period is not known." };
  const i = {
    id: at("Campaign ID"), name: at("Campaign Name"), term: kind === "st" ? at("Query") : at("attributed_keyword"), mt: at("keyword_match_type"),
    views: at("Views"), clicks: at("Clicks"), spend: at("SUM(cost)") >= 0 ? at("SUM(cost)") : at("Ad Spend"),
    du: at("Direct Units Sold"), iu: at("Indirect Units Sold"), dr: at("Direct Revenue"), ir: at("Indirect Revenue"),
  };
  if (i.id < 0 || i.term < 0 || i.spend < 0) return { ok: false, error: "The report is missing its Campaign ID, term or cost column. Download it again from Seller Hub." };
  const by = new Map<string, AdTermRow>();
  let lines = 0;
  for (let n = h + 1; n < rows.length; n++) {
    const r = rows[n];
    const campaign_id = (r[i.id] ?? "").trim().toUpperCase();
    const term = (r[i.term] ?? "").trim().toLowerCase().slice(0, 200);
    if (!campaign_id || !term) continue;
    lines++;
    const clicks = num(r[i.clicks]);
    const spend = num(r[i.spend]);
    const units = num(r[i.du]) + num(r[i.iu]);
    if (clicks <= 0 && spend <= 0 && units <= 0) continue;
    const match_type = i.mt >= 0 ? (r[i.mt] ?? "").trim().toUpperCase() : "";
    const key = `${campaign_id}\u0000${term}\u0000${match_type}`;
    const cur = by.get(key) ?? { campaign_id, campaign_name: (i.name >= 0 ? r[i.name] : "")?.trim() || campaign_id, term, match_type, views: 0, clicks: 0, spend: 0, units: 0, revenue: 0 };
    cur.views += num(r[i.views]);
    cur.clicks += clicks;
    cur.spend = round2(cur.spend + spend);
    cur.units += units;
    cur.revenue = round2(cur.revenue + num(r[i.dr]) + num(r[i.ir]));
    by.set(key, cur);
  }
  const list = [...by.values()];
  return { ok: true, report: { kind, from, to, rows: list, spend: round2(list.reduce((n, r) => n + r.spend, 0)), lines } };
}
