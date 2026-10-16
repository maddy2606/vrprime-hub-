// Master products: one product (for example "Lint Machine", code "180-LINT") groups several channel SKUs, each with
// how many of the product one order of it uses (a 2pc listing = 2). Pure functions with relative imports only, so
// the seed script and the tests can load them.
//
// SKUs are kept exactly as written, spaces included: a SKU that starts or ends with a space is a real (wrong)
// listing, and only an exact spelling matches it. Matching a Flipkart SKU to its product is exact first, then the
// same letters in any case.

export type MasterRow = { master: string; sku: string; units?: number; code?: string };

export const MAX_MASTER_ROWS = 5000;
const MAX_LEN = 200;

/** Splits CSV text into rows of cells: quoted cells, doubled quotes, commas and new lines inside quotes, CRLF. */
export function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

// The column names a file may use (lower case, spaces and dashes as underscores).
const NAME_COLS = ["master_name", "product", "product_name", "name", "master_sku_name"];
const CODE_COLS = ["master_code", "master_sku", "code", "master_sku_code"];
const SKU_COLS = ["channel_sku", "flipkart_sku", "sku", "listing_sku", "seller_sku"];
const UNITS_COLS = ["units_per_order", "units", "qty", "quantity", "pieces", "multiplier"];

const norm = (h: string) => h.trim().toLowerCase().replace(/[\s-]+/g, "_");
const find = (header: string[], names: string[]) => header.findIndex((h) => names.includes(h));

/** Which column holds what, or null when a column is missing. */
export function masterColumns(header: string[]): { name: number; code: number; sku: number; units: number } {
  const h = header.map(norm);
  return { name: find(h, NAME_COLS), code: find(h, CODE_COLS), sku: find(h, SKU_COLS), units: find(h, UNITS_COLS) };
}

/**
 * Reads a mapping table (the cells of a CSV or of an Excel sheet; the first row is the header). `requireSku` is true
 * for the full list (master_name + channel_sku); a product list for the import may leave the SKU out. Every SKU
 * may belong to one product only; the same line twice is fine. Problems come back as plain sentences with the line
 * number, and nothing should be saved while there are any.
 */
export function parseMasterTable(lines: string[][], requireSku = true): { rows: MasterRow[]; errors: string[] } {
  const errors: string[] = [];
  if (!lines.length) return { rows: [], errors: ["The file is empty."] };
  const col = masterColumns(lines[0]);
  if (col.name < 0 && col.code < 0) return { rows: [], errors: ["The first line must name the columns: master_name (or master_code) and channel_sku."] };
  if (requireSku && (col.name < 0 || col.sku < 0)) return { rows: [], errors: ["The first line must have the column names master_name and channel_sku."] };
  if (lines.length - 1 > MAX_MASTER_ROWS) return { rows: [], errors: [`The file has more than ${MAX_MASTER_ROWS} lines.`] };

  const bySku = new Map<string, MasterRow>();
  const out: MasterRow[] = [];
  lines.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const master = col.name >= 0 ? (cells[col.name] ?? "").trim() : "";
    const code = col.code >= 0 ? (cells[col.code] ?? "").trim() : "";
    const sku = col.sku >= 0 ? (cells[col.sku] ?? "") : "";
    const unitsText = col.units >= 0 ? (cells[col.units] ?? "").trim() : "";
    if (!master && !code && sku.trim() === "") return; // a blank line
    if (!master && !code) {
      errors.push(`Line ${line}: the master SKU name (or code) is empty.`);
      return;
    }
    if (requireSku && (!master || sku.trim() === "")) {
      errors.push(`Line ${line}: master_name and channel_sku must both be filled in.`);
      return;
    }
    if (master.length > MAX_LEN || sku.length > MAX_LEN || code.length > 60) {
      errors.push(`Line ${line}: longer than ${MAX_LEN} characters.`);
      return;
    }
    let units: number | undefined;
    if (unitsText !== "") {
      const n = Number(unitsText);
      if (!Number.isInteger(n) || n < 1 || n > 1000) {
        errors.push(`Line ${line}: units per order must be a whole number from 1 to 1000.`);
        return;
      }
      units = n;
    }
    const row: MasterRow = { master, sku, ...(units ? { units } : {}), ...(code ? { code } : {}) };
    if (sku.trim() === "") {
      out.push(row);
      return;
    }
    const seen = bySku.get(sku);
    const key = master || code;
    if (seen && (seen.master || seen.code) !== key) {
      errors.push(`Line ${line}: SKU "${sku}" is already under "${seen.master || seen.code}"; each SKU can belong to one product only.`);
      return;
    }
    if (!seen) {
      bySku.set(sku, row);
      out.push(row);
    }
  });
  return { rows: out, errors: errors.slice(0, 20) };
}

/** The full list from CSV text (master_name, channel_sku, and optionally units_per_order and master_code). */
export function parseMasterCsv(text: string): { rows: MasterRow[]; errors: string[] } {
  return parseMasterTable(splitCsv(text), true);
}

export type MasterMatch = { master: string; units: number };

/**
 * Finds a SKU's product and units per order: the exact spelling first, then the same letters in any case. A
 * case-insensitive spelling that two different products share is ambiguous and matches nothing.
 */
export function masterLookup(rows: MasterRow[]): (sku: string) => MasterMatch | null {
  const exact = new Map<string, MasterMatch>();
  const folded = new Map<string, MasterMatch | null>();
  for (const r of rows) {
    const m = { master: r.master, units: r.units ?? 1 };
    exact.set(r.sku, m);
    const k = r.sku.toLowerCase();
    const cur = folded.get(k);
    folded.set(k, cur === undefined || (cur !== null && cur.master === r.master) ? (cur ?? m) : null);
  }
  return (sku) => exact.get(sku) ?? folded.get(sku.toLowerCase()) ?? null;
}

/** A SKU reduced for comparing: lower case, channel prefixes (Shopsy_, SH_, S_) and punctuation removed. */
export function skuStem(sku: string): string {
  return sku
    .trim()
    .toLowerCase()
    .replace(/^(shopsy|sh|s)[_-]/, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * A guess for an unlinked SKU: the product of the linked SKU that looks most like it (same stem, or the longest
 * shared start of at least 5 characters covering most of both). Null when nothing is close. Only a suggestion:
 * the page shows it filled in for a person to check before saving.
 */
export function suggestMaster(sku: string, rows: MasterRow[]): string | null {
  const stem = skuStem(sku);
  if (stem.length < 3) return null;
  let best: { master: string; score: number } | null = null;
  for (const r of rows) {
    const other = skuStem(r.sku);
    if (!other) continue;
    let n = 0;
    while (n < stem.length && n < other.length && stem[n] === other[n]) n++;
    const score = other === stem ? 1000 : n >= 5 && n >= 0.7 * Math.min(stem.length, other.length) ? n : 0;
    if (score > 0 && (!best || score > best.score)) best = { master: r.master, score };
  }
  return best?.master ?? null;
}
