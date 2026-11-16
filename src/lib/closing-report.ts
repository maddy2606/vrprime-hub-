// Closing report (graphite-spec 12.4): one row per warehouse for a day, written by private.closing_report() at 21:50
// India time. This file reads the rows, orders them and adds the totals row.

export type ClosingFigures = {
  dispatchedUnits: number;
  dispatchedOrders: number;
  pendingToday: number;
  lateNow: number;
  pendingTotal: number;
  present: number;
  halfDay: number;
  absent: number;
  onLeave: number;
  notMarked: number;
  returnsToCheck: number;
};

export type ClosingRow = ClosingFigures & { warehouseId: string; warehouse: string; sortOrder: number };

export const CLOSING_FIELDS: { key: keyof ClosingFigures; column: string; label: string; warn?: boolean }[] = [
  { key: "dispatchedUnits", column: "dispatched_units", label: "Units out" },
  { key: "dispatchedOrders", column: "dispatched_orders", label: "Orders out" },
  { key: "pendingToday", column: "pending_today", label: "Pending for today" },
  { key: "lateNow", column: "late_now", label: "Late now", warn: true },
  { key: "pendingTotal", column: "pending_total", label: "Pending in all" },
  { key: "present", column: "present", label: "Present" },
  { key: "halfDay", column: "half_day", label: "Half day" },
  { key: "absent", column: "absent", label: "Absent", warn: true },
  { key: "onLeave", column: "on_leave", label: "On leave" },
  { key: "notMarked", column: "not_marked", label: "Not marked" },
  { key: "returnsToCheck", column: "returns_to_check", label: "Returns to check" },
];

const count = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
};

/** Reads closing_reports rows (with the warehouse's name and sort order joined in), in the warehouses' order. */
export function readClosingRows(raw: unknown): ClosingRow[] {
  if (!Array.isArray(raw)) return [];
  const out: ClosingRow[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.warehouse_id !== "string") continue;
    const w = (Array.isArray(o.warehouses) ? o.warehouses[0] : o.warehouses) as Record<string, unknown> | null | undefined;
    const row = {
      warehouseId: o.warehouse_id,
      warehouse: typeof w?.name === "string" ? w.name : "—",
      sortOrder: count(w?.sort_order),
    } as ClosingRow;
    for (const f of CLOSING_FIELDS) row[f.key] = count(o[f.column]);
    out.push(row);
  }
  return out.sort((a, b) => a.sortOrder - b.sortOrder || a.warehouse.localeCompare(b.warehouse));
}

/** The totals row: every figure added up across the warehouses. */
export function closingTotals(rows: ClosingRow[]): ClosingFigures {
  const t = Object.fromEntries(CLOSING_FIELDS.map((f) => [f.key, 0])) as ClosingFigures;
  for (const r of rows) for (const f of CLOSING_FIELDS) t[f.key] += r[f.key];
  return t;
}

/** The day to show: a valid yyyy-mm-dd no later than today, else today. */
export function closingDay(param: string | null | undefined, today: string): string {
  if (!param || !/^\d{4}-\d{2}-\d{2}$/.test(param) || Number.isNaN(Date.parse(`${param}T00:00:00Z`))) return today;
  return param > today ? today : param;
}
