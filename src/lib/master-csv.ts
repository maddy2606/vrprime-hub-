// Master products: one product (for example "Lint Machine") groups several channel SKUs. The mapping comes from a
// CSV with the columns master_name, channel_sku. Pure functions with relative imports only, so the seed script and
// the tests can load them.
//
// SKUs are kept exactly as written, spaces included: a SKU that starts or ends with a space is a real (wrong)
// listing, and only an exact spelling matches it. Matching a Flipkart SKU to its product is exact first, then the
// same letters in any case.

export type MasterRow = { master: string; sku: string };

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

/**
 * Reads the mapping CSV. The header must name master_name and channel_sku (in either order; other columns are
 * ignored). Every SKU may belong to one product only; the same line twice is fine. Problems come back as plain
 * sentences with the line number, and nothing should be saved while there are any.
 */
export function parseMasterCsv(text: string): { rows: MasterRow[]; errors: string[] } {
  const lines = splitCsv(text);
  const errors: string[] = [];
  if (!lines.length) return { rows: [], errors: ["The file is empty."] };
  const header = lines[0].map((h) => h.trim().toLowerCase());
  const mi = header.indexOf("master_name");
  const si = header.indexOf("channel_sku");
  if (mi < 0 || si < 0) return { rows: [], errors: ["The first line must have the column names master_name and channel_sku."] };
  if (lines.length - 1 > MAX_MASTER_ROWS) return { rows: [], errors: [`The file has more than ${MAX_MASTER_ROWS} lines.`] };

  const bySku = new Map<string, MasterRow>();
  lines.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const master = (cells[mi] ?? "").trim();
    const sku = cells[si] ?? "";
    if (!master || sku.trim() === "") {
      errors.push(`Line ${line}: master_name and channel_sku must both be filled in.`);
      return;
    }
    if (master.length > MAX_LEN || sku.length > MAX_LEN) {
      errors.push(`Line ${line}: longer than ${MAX_LEN} characters.`);
      return;
    }
    const seen = bySku.get(sku);
    if (seen && seen.master !== master) {
      errors.push(`Line ${line}: SKU "${sku}" is already under "${seen.master}"; each SKU can belong to one product only.`);
      return;
    }
    if (!seen) bySku.set(sku, { master, sku });
  });
  return { rows: [...bySku.values()], errors: errors.slice(0, 20) };
}

/**
 * Finds a SKU's product: the exact spelling first, then the same letters in any case. A case-insensitive spelling
 * that two different products share is ambiguous and matches nothing.
 */
export function masterLookup(rows: MasterRow[]): (sku: string) => string | null {
  const exact = new Map<string, string>();
  const folded = new Map<string, string | null>();
  for (const r of rows) {
    exact.set(r.sku, r.master);
    const k = r.sku.toLowerCase();
    const cur = folded.get(k);
    folded.set(k, cur === undefined || cur === r.master ? r.master : null);
  }
  return (sku) => exact.get(sku) ?? folded.get(sku.toLowerCase()) ?? null;
}
