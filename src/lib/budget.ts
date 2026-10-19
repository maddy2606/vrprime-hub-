// Monthly expense budgets per warehouse, as plain functions (no imports, so `node --test` can load them): which warehouse a
// note is about, splitting a total by each warehouse's share of the work, and how a warehouse stands against its budget.

/** Other names and spellings the group uses for each warehouse (keys are warehouse names in lower case). */
const ALIASES: Record<string, string[]> = {
  bangalore: ["bangalore", "bengaluru", "banglore", "bengalore", "blr"],
  bhiwandi: ["bhiwandi", "bhiwndi", "bhivandi", "mumbai", "bombay", "purna", "bhw"],
  delhi: ["delhi", "dilli", "ncr"],
  kolkata: ["kolkata", "kokata", "kolkatta", "calcutta"],
  lucknow: ["lucknow", "lucknw", "lko"],
};

/**
 * The warehouse a note is about. One named: that one. Several: the one the note says it was for ("Delhi k liye",
 * "for Delhi"), else the first named, where the money was spent. None: null (general).
 */
export function warehouseFor(text: string | null | undefined, warehouses: { id: string; name: string }[]): string | null {
  const t = ` ${(text ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ")} `;
  const hits: { id: string; at: number; forIt: boolean }[] = [];
  for (const w of warehouses) {
    const names = ALIASES[w.name.trim().toLowerCase()] ?? [w.name.trim().toLowerCase()];
    for (const n of names) {
      const re = new RegExp(`(?<![a-z0-9])(?:for |to )?${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])( (?:k|ke|ki|ka) (?:liye|lie|liy)| ke liye| wala| wale)?`, "g");
      for (const m of t.matchAll(re)) hits.push({ id: w.id, at: m.index ?? 0, forIt: Boolean(m[1]) || /^for /.test(m[0]) });
    }
  }
  if (!hits.length) return null;
  const marked = hits.find((h) => h.forIt);
  if (marked) return marked.id;
  return hits.sort((a, b) => a.at - b.at)[0].id;
}

/**
 * Splits `total` across keys by their weights (orders, say), in steps of `step` rupees, so the parts add up to the total
 * rounded to the step. With no weights at all it splits evenly.
 */
export function splitByShare(total: number, weights: Record<string, number>, step = 100): Record<string, number> {
  const keys = Object.keys(weights);
  if (!keys.length) return {};
  const whole = Math.max(0, Math.round(total / step));
  const sum = keys.reduce((n, k) => n + Math.max(0, weights[k]), 0);
  const raw = keys.map((k) => ({ k, exact: sum > 0 ? (whole * Math.max(0, weights[k])) / sum : whole / keys.length }));
  const parts = raw.map((r) => ({ ...r, units: Math.floor(r.exact) }));
  let left = whole - parts.reduce((n, p) => n + p.units, 0);
  for (const p of [...parts].sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)) || a.k.localeCompare(b.k))) {
    if (left <= 0) break;
    p.units += 1;
    left -= 1;
  }
  return Object.fromEntries(parts.map((p) => [p.k, p.units * step]));
}

export type BudgetTone = "ok" | "warn" | "bad" | "neutral";

/** Where a warehouse stands: share of its budget spent, a colour, and what is left (negative when over). */
export function budgetStatus(budget: number, spent: number): { pct: number | null; tone: BudgetTone; left: number } {
  if (budget <= 0) return { pct: null, tone: spent > 0 ? "bad" : "neutral", left: -spent };
  const pct = Math.round((spent / budget) * 100);
  return { pct, tone: pct > 100 ? "bad" : pct >= 85 ? "warn" : "ok", left: Math.round((budget - spent) * 100) / 100 };
}

/** Labour is salaries and labour payments; everything else is running costs. */
export const isLabour = (category: string) => category === "Staff and labour";

/** "2026-11": the month after `month`. */
export function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** "2026-09": the month before `month`. */
export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
