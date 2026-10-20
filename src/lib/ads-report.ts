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
