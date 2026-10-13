// SKU costs: reading and writing the cost CSV (sku, purchase_cost, packaging_cost, freight, effective_from).
// A SKU is never trimmed here: " RATH2" with a space is a real SKU on Flipkart.
import { dateOf, normalizeHeader, ReportError } from "./columns.ts";
import { parseCsvLine } from "./xlsx-stream.ts";

export type CostInput = { sku: string; purchase_cost: number; packaging_cost: number; freight: number; effective_from: string };

export const COST_CSV_HEADERS = ["sku", "purchase_cost", "packaging_cost", "freight", "effective_from"];

function money(v: string | undefined, label: string, line: number, required: boolean): number {
  const t = (v ?? "").replace(/,/g, "").replace(/^₹/, "").trim();
  if (t === "") {
    if (required) throw new ReportError(`Line ${line}: ${label} is empty.`);
    return 0;
  }
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) throw new ReportError(`Line ${line}: ${label} "${t.slice(0, 20)}" is not an amount.`);
  return Math.round(n * 100) / 100;
}

/** Parses the text of a cost CSV. Throws a ReportError naming the line that is wrong; nothing is half-read. */
export function parseCostCsv(text: string, today: string): CostInput[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) throw new ReportError("The file has no rows.");
  const delimiter = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const header = parseCsvLine(lines[0], delimiter).map((h) => normalizeHeader(h).replace(/ /g, "_"));
  const col = (name: string) => header.indexOf(name);
  const need = ["sku", "purchase_cost"];
  const missing = need.filter((n) => col(n) < 0);
  if (missing.length) throw new ReportError(`The file has no column called ${missing.map((m) => `"${m}"`).join(", ")}. Expected: ${COST_CSV_HEADERS.join(", ")}.`);

  const out: CostInput[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i], delimiter);
    const get = (name: string) => (col(name) >= 0 ? cells[col(name)] : undefined);
    const sku = get("sku") ?? "";
    if (sku.trim() === "") throw new ReportError(`Line ${i + 1}: the SKU is empty.`);
    if (sku.length > 120) throw new ReportError(`Line ${i + 1}: the SKU is longer than 120 characters.`);
    const effective = dateOf(get("effective_from"), `Line ${i + 1}, effective_from`) ?? today;
    const key = `${sku}|${effective}`;
    if (seen.has(key)) throw new ReportError(`Line ${i + 1}: ${sku} appears twice with the same effective_from.`);
    seen.add(key);
    out.push({
      sku,
      purchase_cost: money(get("purchase_cost"), "purchase_cost", i + 1, true),
      packaging_cost: money(get("packaging_cost"), "packaging_cost", i + 1, false),
      freight: money(get("freight"), "freight", i + 1, false),
      effective_from: effective,
    });
  }
  return out;
}

/** The unit cost in force on a day: the latest cost row that starts on or before it. */
export function costOn(rows: CostInput[], sku: string, day: string): number | null {
  let best: CostInput | null = null;
  for (const r of rows) {
    if (r.sku === sku && r.effective_from <= day && (!best || r.effective_from > best.effective_from)) best = r;
  }
  return best ? Math.round((best.purchase_cost + best.packaging_cost + best.freight) * 100) / 100 : null;
}
