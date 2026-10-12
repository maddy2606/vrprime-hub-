"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CsvCell } from "@/lib/csv";
import type { SortValue } from "@/lib/stock-analysis";

export type Column<T> = {
  key: string;
  label: string;
  align?: "left" | "right";
  /** What to sort by when the header is tapped. Leave out for a column that cannot be sorted. */
  sort?: (row: T) => SortValue;
  cell: (row: T) => ReactNode;
  /** What this column holds in a CSV export. */
  csv: (row: T) => CsvCell;
  /** Only in the CSV, not on screen (for example the title next to the SKU). */
  csvOnly?: boolean;
  /** Only on screen, not in the CSV (for example the Restock link). */
  screenOnly?: boolean;
};

type Props<T> = {
  columns: Column<T>[];
  rows: T[];
  sortKey: string;
  sortDir: "asc" | "desc";
  onSort: (key: string) => void;
  rowKey: (row: T) => string;
};

/**
 * A dense table that scrolls sideways on a phone with the first column (the SKU) kept in view.
 * Tap a column heading to sort by it; tap again to reverse.
 */
export function DataTable<T>({ columns, rows, sortKey, sortDir, onSort, rowKey }: Props<T>) {
  const shown = columns.filter((c) => !c.csvOnly);
  const box = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);

  // Say so when there are more columns than fit, so nobody thinks the table stops at the edge.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setScrolls(el.scrollWidth > el.clientWidth + 1));
    observer.observe(el);
    return () => observer.disconnect();
  }, [shown.length, rows.length]);

  return (
    <div>
      {scrolls ? <p className="mb-1.5 text-xs font-semibold text-muted">Swipe sideways for more columns →</p> : null}
      <div ref={box} className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead>
          <tr className="border-b border-line bg-surface2">
            {shown.map((c, i) => {
              const active = c.sort && c.key === sortKey;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
                  className={`p-0 font-bold ${i === 0 ? "sticky left-0 z-10 bg-surface2" : ""} ${c.align === "right" ? "text-right" : "text-left"}`}
                >
                  {c.sort ? (
                    <button
                      type="button"
                      onClick={() => onSort(c.key)}
                      className={`focus-ring flex min-h-11 w-full max-w-32 items-center gap-1 px-2.5 text-left text-xs uppercase leading-tight tracking-wide ${
                        c.align === "right" ? "justify-end" : "justify-start"
                      } ${active ? "text-accent-text" : "text-muted hover:text-ink"}`}
                    >
                      {c.label}
                      <span aria-hidden="true" className="w-3 text-[10px]">
                        {active ? (sortDir === "asc" ? "▲" : "▼") : ""}
                      </span>
                    </button>
                  ) : (
                    <span className="flex min-h-11 items-center px-2.5 text-xs uppercase tracking-wide text-muted">{c.label}</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="group border-b border-line last:border-b-0 hover:bg-surface2/60">
              {shown.map((c, i) => (
                <td
                  key={c.key}
                  className={`px-2.5 py-2 align-top ${i === 0 ? "sticky left-0 z-10 max-w-[11.5rem] bg-surface group-hover:bg-surface2" : ""} ${
                    c.align === "right" ? "text-right tabular-nums" : "text-left"
                  }`}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
