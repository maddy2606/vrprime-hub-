"use client";

import { useState, type ReactNode } from "react";
import { ChevronDownIcon } from "@/components/icons";
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
  /** A minor column: not in the table on a wide screen (open the row's arrow to see it), but on every phone card. */
  minor?: boolean;
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
 * The one table of the Flipkart page.
 *
 *  - Wide screens: a table with the key columns, the first column (SKU) pinned and the header pinned while the page
 *    scrolls inside it. Minor columns sit behind each row's arrow. Numbers are right-aligned, in mono, tabular figures.
 *  - Phones (480px and under): no sideways scrolling at all. Each row becomes a card: the first column as its heading,
 *    then label and value pairs, then the buttons.
 */
export function DataTable<T>({ columns, rows, sortKey, sortDir, onSort, rowKey }: Props<T>) {
  const shown = columns.filter((c) => !c.csvOnly);
  const main = shown.filter((c) => !c.minor);
  const minor = shown.filter((c) => c.minor);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const first = shown[0];
  const rest = shown.slice(1);
  const buttons = rest.filter((c) => c.label === "");
  const fields = rest.filter((c) => c.label !== "");
  const sortable = fields.filter((c) => c.sort);

  return (
    <div>
      {/* Phone: cards */}
      <div className="flex flex-col gap-2 min-[481px]:hidden">
        {sortable.length > 0 ? (
          <label className="flex items-center gap-2 text-xs font-semibold text-muted">
            Sort by
            <select
              className="focus-ring min-h-11 flex-1 rounded-lg border border-line bg-surface px-2 text-sm font-semibold text-ink"
              value={sortKey}
              onChange={(e) => onSort(e.target.value)}
            >
              {first.sort ? <option value={first.key}>{first.label}</option> : null}
              {sortable.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => onSort(sortKey)}
              aria-label={sortDir === "asc" ? "Ascending: tap to reverse" : "Descending: tap to reverse"}
              className="focus-ring flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line bg-surface text-sm font-bold text-ink"
            >
              {sortDir === "asc" ? "▲" : "▼"}
            </button>
          </label>
        ) : null}
        {rows.map((row) => (
          <article key={rowKey(row)} className="rounded-xl border border-line bg-surface p-3">
            <div className="min-w-0">{first.cell(row)}</div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
              {fields.map((c) => (
                <div key={c.key} className="min-w-0">
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{c.label}</dt>
                  <dd className="mt-0.5 min-w-0 break-words font-mono text-sm tabular-nums">{c.cell(row)}</dd>
                </div>
              ))}
            </dl>
            {buttons.length ? <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">{buttons.map((c) => <span key={c.key}>{c.cell(row)}</span>)}</div> : null}
          </article>
        ))}
      </div>

      {/* Wider screens: table */}
      <div className="hidden max-h-[75vh] overflow-auto rounded-xl border border-line bg-surface min-[481px]:block">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-20">
            <tr className="border-b border-line bg-surface2">
              {main.map((c, i) => {
                const active = c.sort && c.key === sortKey;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
                    className={`bg-surface2 p-0 font-bold ${i === 0 ? "sticky left-0 z-10" : ""} ${c.align === "right" ? "text-right" : "text-left"}`}
                  >
                    {c.sort ? (
                      <button
                        type="button"
                        onClick={() => onSort(c.key)}
                        className={`focus-ring flex min-h-11 w-full items-center gap-0.5 px-2 text-xs uppercase leading-tight ${
                          c.align === "right" ? "justify-end text-right" : "justify-start text-left"
                        } ${active ? "text-ink" : "text-muted hover:text-ink"}`}
                      >
                        {c.label}
                        <span aria-hidden="true" className={`w-3 text-[10px] ${active ? "text-accent-text" : ""}`}>
                          {active ? (sortDir === "asc" ? "▲" : "▼") : ""}
                        </span>
                      </button>
                    ) : (
                      <span className="flex min-h-11 items-center px-2 text-xs uppercase text-muted">{c.label}</span>
                    )}
                  </th>
                );
              })}
              {minor.length ? <th scope="col" className="w-10 bg-surface2"><span className="sr-only">More</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = rowKey(row);
              const expanded = open.has(key);
              return (
                <RowPair key={key}>
                  <tr className="group border-b border-line last:border-b-0 hover:bg-surface2/60">
                    {main.map((c, i) => (
                      <td
                        key={c.key}
                        className={`px-2 py-2 align-top ${i === 0 ? "sticky left-0 z-10 max-w-[12.5rem] bg-surface group-hover:bg-surface2" : ""} ${
                          c.align === "right" ? "text-right font-mono tabular-nums" : "text-left"
                        }`}
                      >
                        {c.cell(row)}
                      </td>
                    ))}
                    {minor.length ? (
                      <td className="px-1 py-1 align-top">
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-label={expanded ? "Hide details" : "Show details"}
                          onClick={() => toggle(key)}
                          className="focus-ring flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:bg-surface2 hover:text-ink"
                        >
                          <ChevronDownIcon className={`h-4 w-4 transition ${expanded ? "rotate-180" : ""}`} />
                        </button>
                      </td>
                    ) : null}
                  </tr>
                  {expanded && minor.length ? (
                    <tr className="border-b border-line bg-canvas/50">
                      <td colSpan={main.length + 1} className="px-3 py-3">
                        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
                          {minor.map((c) => (
                            <div key={c.key} className="min-w-0">
                              <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{c.label}</dt>
                              <dd className="mt-0.5 break-words font-mono text-sm tabular-nums">{c.cell(row)}</dd>
                            </div>
                          ))}
                        </dl>
                      </td>
                    </tr>
                  ) : null}
                </RowPair>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RowPair({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
