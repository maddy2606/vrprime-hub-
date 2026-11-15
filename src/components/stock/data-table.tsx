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
  /** A fixed width on a wide screen (a Tailwind class such as "w-40"). Columns without one share the rest, so tables
   *  stacked one under another line up. */
  width?: string;
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
 * The one table of the Flipkart page, as a glass ledger (glass-spec section 4): a Card with no padding, a sticky header,
 * rows divided by hairlines, numbers right-aligned in Geist Mono. Minor columns sit behind each row's arrow. On a phone
 * the same table scrolls sideways with its first column pinned, and a Sort by control sits above it.
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
  const fields = rest.filter((c) => c.label !== "");
  const sortable = fields.filter((c) => c.sort);

  return (
    <div>
      {/* Phone: a Sort by control above the table. */}
      <div className="mb-2 flex flex-col gap-2 min-[700px]:hidden">
        {sortable.length > 0 ? (
          <label className="toolbar-ctl t-label">
            Sort by
            <select
              className="focus-ring h-[38px] min-w-0 flex-1 bg-transparent pr-2 text-[13px] font-semibold normal-case tracking-normal text-ink"
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
              className="g-btn g-btn-secondary focus-ring !h-[34px] !min-h-[34px] !px-3"
            >
              {sortDir === "asc" ? "▲" : "▼"}
            </button>
          </label>
        ) : null}
      </div>

      <div className="sp-card ledger-card max-h-[75vh]">
        <table className="ledger">
          <thead>
            <tr>
              {main.map((c, i) => {
                const active = c.sort && c.key === sortKey;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
                    className={`!p-0 ${i === 0 ? "min-[700px]:sticky min-[700px]:left-0 min-[700px]:z-[3]" : ""} ${c.align === "right" ? "text-right" : "text-left"} ${c.width ?? ""}`}
                  >
                    {c.sort ? (
                      <button
                        type="button"
                        onClick={() => onSort(c.key)}
                        className={`focus-ring flex h-[43px] w-full items-center gap-0.5 px-3 uppercase tracking-[0.08em] transition-colors duration-160 ${
                          c.align === "right" ? "justify-end text-right" : "justify-start text-left"
                        } ${active ? "text-ink" : "hover:text-ink"}`}
                      >
                        {c.label}
                        <span aria-hidden="true" className={`w-3 text-[10px] ${active ? "text-accent-text" : ""}`}>
                          {active ? (sortDir === "asc" ? "▲" : "▼") : ""}
                        </span>
                      </button>
                    ) : (
                      <span className={`flex h-[43px] items-center px-3 ${c.align === "right" ? "justify-end text-right" : ""}`}>{c.label}</span>
                    )}
                  </th>
                );
              })}
              {minor.length ? <th scope="col" className="w-10"><span className="sr-only">More</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = rowKey(row);
              const expanded = open.has(key);
              return (
                <RowPair key={key}>
                  <tr className={expanded ? "is-expanded" : ""}>
                    {main.map((c, i) => (
                      <td
                        key={c.key}
                        className={`${i === 0 ? "max-w-[12.5rem]" : ""} ${
                          c.align === "right" ? "num" : "text-left"
                        }`}
                      >
                        {c.cell(row)}
                      </td>
                    ))}
                    {minor.length ? (
                      <td className="!px-1 !py-0.5">
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-label={expanded ? "Hide details" : "Show details"}
                          onClick={() => toggle(key)}
                          className="focus-ring flex h-10 w-10 items-center justify-center rounded-[var(--radius)] text-muted transition-colors duration-160 hover:bg-surface2 hover:text-ink"
                        >
                          <ChevronDownIcon className={`h-4 w-4 transition-transform duration-160 ${expanded ? "rotate-180" : ""}`} />
                        </button>
                      </td>
                    ) : null}
                  </tr>
                  {expanded && minor.length ? (
                    <tr className="is-expanded">
                      <td colSpan={main.length + 1} className="!px-3 !py-3">
                        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
                          {minor.map((c) => (
                            <div key={c.key} className="min-w-0">
                              <dt className="t-label">{c.label}</dt>
                              <dd className="mt-1 break-words font-mono text-[13px] font-medium tabular-nums">{c.cell(row)}</dd>
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
