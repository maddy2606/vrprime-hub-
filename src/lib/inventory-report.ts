// The VR Prime inventory report (inventory.vrprime.in → Reports → .xlsx). Forecasting takes its stock from here.
//
// The "Products" sheet has one line per product: SKU (the product code), Product (its name), Total Stock (cartons),
// Loose, Returns, Total Pieces, then per warehouse "<Warehouse> Current" (cartons), "<Warehouse> Loose" and
// "<Warehouse> Returns". Pieces per carton is not a column, so it comes from the totals:
// (Total Pieces − Loose − Returns) ÷ Total Stock. A warehouse's pieces = Current × pieces per carton + its loose + its
// returns, which adds up to Total Pieces.

export type InventoryLine = { code: string; name: string; wid: string; pieces: number };

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

function num(v: string | undefined): number {
  const n = Number(String(v ?? "").replace(/,/g, "").trim() || 0);
  return Number.isFinite(n) ? n : NaN;
}

/** The report month from the Summary sheet ("Month", "2026-10"), if there. */
export function reportMonth(summary: string[][] | undefined): string | null {
  const row = summary?.find((r) => norm(r[0] ?? "") === "month");
  const v = row?.[1]?.trim();
  return v ? v.slice(0, 20) : null;
}

/**
 * Reads the Products sheet into pieces per product and warehouse. Warehouses are matched to the app's by name; a
 * warehouse in the report that the app does not have is an error, so no stock is silently lost.
 */
export function parseInventoryReport(table: string[][], warehouses: { id: string; name: string }[]): { lines: InventoryLine[]; errors: string[] } {
  const errors: string[] = [];
  const header = (table[0] ?? []).map((h) => norm(h ?? ""));
  const col = (name: string) => header.indexOf(norm(name));
  const need = ["SKU", "Product", "Total Stock", "Loose", "Returns", "Total Pieces"];
  const missing = need.filter((n) => col(n) < 0);
  if (missing.length) return { lines: [], errors: [`This is not the inventory report's Products sheet: no ${missing.join(", ")} column.`] };

  // Warehouses: every "<name> current" column.
  const found = header.flatMap((h) => (h.endsWith(" current") ? [h.slice(0, -" current".length)] : []));
  if (!found.length) return { lines: [], errors: ["The report has no warehouse columns (\"<Warehouse> Current\")."] };
  const byName = new Map(warehouses.map((w) => [norm(w.name), w.id]));
  const unknown = found.filter((w) => !byName.has(w));
  if (unknown.length) return { lines: [], errors: [`The report has warehouses the app does not know: ${unknown.join(", ")}.`] };

  const lines: InventoryLine[] = [];
  const seen = new Set<string>();
  table.slice(1).forEach((r, i) => {
    const line = i + 2;
    const code = (r[col("SKU")] ?? "").trim();
    const name = (r[col("Product")] ?? "").trim();
    if (!code && !name) return;
    if (!code || !name) return errors.push(`Line ${line}: the product code and name must both be filled.`);
    if (seen.has(code.toLowerCase())) return errors.push(`Line ${line}: ${code} is in the report twice.`);
    seen.add(code.toLowerCase());
    const [cartons, loose, returns, total] = ["Total Stock", "Loose", "Returns", "Total Pieces"].map((c) => num(r[col(c)]));
    if ([cartons, loose, returns, total].some((v) => !Number.isFinite(v) || v < 0)) return errors.push(`Line ${line}: ${code} has a number that is not understood.`);
    const perCarton = cartons > 0 ? (total - loose - returns) / cartons : 1;
    let sum = 0;
    const mine: InventoryLine[] = [];
    for (const w of found) {
      const v = (c: string) => num(r[header.indexOf(`${w} ${c}`)]);
      const pieces = Math.round((v("current") || 0) * perCarton + (v("loose") || 0) + (v("returns") || 0));
      if (!Number.isFinite(pieces) || pieces < 0) return errors.push(`Line ${line}: ${code} has a warehouse number that is not understood.`);
      sum += pieces;
      mine.push({ code, name, wid: byName.get(w)!, pieces });
    }
    if (Math.abs(sum - total) > 1) return errors.push(`Line ${line}: ${code}'s warehouses add up to ${sum} pieces, not the ${total} in Total Pieces.`);
    lines.push(...mine);
  });
  if (!lines.length && !errors.length) errors.push("The report has no products.");
  return { lines, errors };
}

/**
 * Each master product's pieces per warehouse. A report product belongs to the master product with the same code, or
 * else the same name (in any case). Report products that match none come back in `unmatched`.
 */
export function inventoryByProduct(
  stock: InventoryLine[],
  products: { name: string; code: string | null }[],
): { byProduct: Map<string, Map<string, number>>; unmatched: string[] } {
  const byCode = new Map(products.flatMap((p) => (p.code ? [[norm(p.code), p.name] as const] : [])));
  const byName = new Map(products.map((p) => [norm(p.name), p.name] as const));
  const byProduct = new Map<string, Map<string, number>>();
  const unmatched = new Set<string>();
  for (const s of stock) {
    const product = byCode.get(norm(s.code)) ?? byName.get(norm(s.name));
    if (!product) {
      if (s.pieces > 0) unmatched.add(s.name);
      continue;
    }
    const per = byProduct.get(product) ?? new Map<string, number>();
    per.set(s.wid, (per.get(s.wid) ?? 0) + s.pieces);
    byProduct.set(product, per);
  }
  return { byProduct, unmatched: [...unmatched].sort() };
}
