// Dead stock (graphite-spec 12.1): products holding stock that does not sell. Works on the Forecasting tab's
// "By product" rows (30-day window), so the stock, the units dispatched and the days of cover match that tab.

export type DeadInput = {
  name: string;
  code: string | null;
  /** Stock now in product units (a kit's own stock, not what its parts make). */
  stock: number;
  /** Units dispatched in the 30-day window. */
  dispatched: number;
  /** Days of cover, or null when nothing was dispatched. */
  cover: number | null;
  byWarehouse: { wid: string; pieces: number }[];
  /** master_costs.cost for one unit, or null when not entered. */
  cost: number | null;
};

export type DeadKind = "dead" | "slow";

export type DeadRow = DeadInput & { kind: DeadKind; value: number | null };

/** Dead: stock above 0 and nothing dispatched. Slow: stock above 0, something dispatched, more than 90 days of cover. */
export function deadKind(p: Pick<DeadInput, "stock" | "dispatched" | "cover">): DeadKind | null {
  if (p.stock <= 0) return null;
  if (p.dispatched <= 0) return "dead";
  if (p.cover !== null && p.cover > 90) return "slow";
  return null;
}

/** Sorted by value, largest first; rows with no cost last (by stock, largest first). */
export function sortByValue(rows: DeadRow[]): DeadRow[] {
  return [...rows].sort((a, b) => {
    if (a.value === null || b.value === null) return a.value === null && b.value === null ? b.stock - a.stock || a.name.localeCompare(b.name) : a.value === null ? 1 : -1;
    return b.value - a.value || a.name.localeCompare(b.name);
  });
}

export function classifyDeadStock(products: DeadInput[]): DeadRow[] {
  const rows: DeadRow[] = [];
  for (const p of products) {
    const kind = deadKind(p);
    if (kind) rows.push({ ...p, kind, value: p.cost === null ? null : p.stock * p.cost });
  }
  return sortByValue(rows);
}

export type DeadTotals = { deadValue: number; deadProducts: number; slowValue: number; slowProducts: number; noCost: number };

/** The KPI row. "No cost entered" counts the dead and slow products without a cost (their value is unknown). */
export function deadTotals(rows: DeadRow[]): DeadTotals {
  const t: DeadTotals = { deadValue: 0, deadProducts: 0, slowValue: 0, slowProducts: 0, noCost: 0 };
  for (const r of rows) {
    if (r.kind === "dead") {
      t.deadProducts++;
      t.deadValue += r.value ?? 0;
    } else {
      t.slowProducts++;
      t.slowValue += r.value ?? 0;
    }
    if (r.value === null) t.noCost++;
  }
  return t;
}
