"use client";

import { DataTable, type Column } from "@/components/stock/data-table";
import { CLOSING_FIELDS, closingTotals, type ClosingFigures, type ClosingRow } from "@/lib/closing-report";
import { formatNumber } from "@/lib/format";

type Line = ClosingFigures & { key: string; warehouse: string; total: boolean };

/**
 * The closing report's one table (graphite-spec 12.4): a row per warehouse and a totals row last. Late now and Absent
 * above 0 are in --warn.
 */
export function ClosingTable({ rows }: { rows: ClosingRow[] }) {
  const lines: Line[] = [
    ...rows.map((r) => ({ ...r, key: r.warehouseId, total: false })),
    ...(rows.length > 1 ? [{ ...closingTotals(rows), key: "total", warehouse: "Total", total: true }] : []),
  ];
  const columns: Column<Line>[] = [
    {
      key: "warehouse",
      label: "Warehouse",
      cell: (l) => <span className={l.total ? "font-semibold" : "font-medium"}>{l.warehouse}</span>,
      csv: (l) => l.warehouse,
    },
    ...CLOSING_FIELDS.map<Column<Line>>((f) => ({
      key: f.key,
      label: f.label,
      align: "right",
      cell: (l) => (
        <span className={`tabular-nums ${l.total ? "font-semibold" : ""} ${f.warn && l[f.key] > 0 ? "text-warn" : ""}`}>{formatNumber(l[f.key])}</span>
      ),
      csv: (l) => l[f.key],
    })),
  ];
  return <DataTable columns={columns} rows={lines} sortKey="" sortDir="asc" onSort={() => undefined} rowKey={(l) => l.key} />;
}
