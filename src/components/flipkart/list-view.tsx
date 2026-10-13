"use client";

import { useMemo, useState, type ReactNode } from "react";
import { DataTable, type Column } from "@/components/stock/data-table";
import { Caption, CsvButton, InfoTip, SearchField, Segmented, Toolbar } from "@/components/flipkart/kit";
import { EmptyState } from "@/components/ui";
import { downloadCsv, toCsv, type CsvCell } from "@/lib/csv";
import { formatNumber } from "@/lib/format";

/** Rows drawn at a time: a phone should not have to draw thousands. */
const PAGE_ROWS = 50;

type Props<T> = {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  defaultSort: { key: string; dir: "asc" | "desc" };
  /** Columns whose first tap sorts A to Z (the others sort biggest first). */
  textKeys?: string[];
  /** The text the search box looks in. */
  searchText: (row: T) => string;
  searchLabel: string;
  csvName: string;
  /** What one row is called, for "12 rows". */
  noun: [string, string];
  /** Extra controls (filter chips, a warehouse picker) shown above the search box. */
  controls?: ReactNode;
  /** Notes under the controls. */
  /** Longer explanation: shown behind the "i" in the toolbar. */
  note?: ReactNode;
  emptyTitle: string;
  emptyBody: string;
  /** Text after the count, for example "Delhi only". */
  scope?: string;
};

/** A searchable, sortable table with a CSV download: the body of most tabs on the Flipkart page. */
export function ListView<T>({
  rows,
  columns,
  rowKey,
  defaultSort,
  textKeys = [],
  searchText,
  searchLabel,
  csvName,
  noun,
  controls,
  note,
  emptyTitle,
  emptyBody,
  scope,
}: Props<T>) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState(defaultSort);
  const [limit, setLimit] = useState(PAGE_ROWS);

  const onSort = (key: string) => {
    setLimit(PAGE_ROWS);
    setSort((current) => ({ key, dir: current.key === key ? (current.dir === "asc" ? "desc" : "asc") : textKeys.includes(key) ? "asc" : "desc" }));
  };

  const column = columns.find((c) => c.key === sort.key && c.sort) ?? columns.find((c) => c.sort);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = needle ? rows.filter((r) => searchText(r).toLowerCase().includes(needle)) : rows;
    const by = column?.sort;
    if (!by) return filtered;
    const sign = sort.dir === "asc" ? 1 : -1;
    // Empty values go last whichever way it is sorted; ties keep a steady order.
    return [...filtered].sort((p, r) => {
      const x = by(p);
      const y = by(r);
      if (x === null && y === null) return rowKey(p).localeCompare(rowKey(r));
      if (x === null) return 1;
      if (y === null) return -1;
      const diff = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "en", { numeric: true, sensitivity: "base" });
      return diff === 0 ? rowKey(p).localeCompare(rowKey(r)) : diff * sign;
    });
  }, [rows, q, column, sort.dir, searchText, rowKey]);

  const exportCsv = () => {
    const cols = columns.filter((c) => !c.screenOnly);
    downloadCsv(
      csvName,
      toCsv(
        cols.map((c) => c.label),
        shown.map((r): CsvCell[] => cols.map((c) => c.csv(r))),
      ),
    );
  };

  return (
    <>
      <Toolbar>
        {controls}
        <SearchField value={q} onChange={(v) => { setQ(v); setLimit(PAGE_ROWS); }} placeholder={searchLabel} />
        <CsvButton onClick={exportCsv} disabled={shown.length === 0} />
        {note ? <InfoTip>{note}</InfoTip> : null}
      </Toolbar>
      <Caption>
        {formatNumber(shown.length)} {shown.length === 1 ? noun[0] : noun[1]}
        {scope ? ` · ${scope}` : ""}
      </Caption>
      {shown.length ? (
        <>
          <DataTable columns={columns} rows={shown.slice(0, limit)} sortKey={column?.key ?? ""} sortDir={sort.dir} onSort={onSort} rowKey={rowKey} />
          {shown.length > limit ? (
            <button type="button" onClick={() => setLimit((n) => n + PAGE_ROWS)} className="focus-ring mt-2 min-h-11 w-full rounded-lg border border-line bg-surface px-4 text-sm font-bold hover:bg-surface2">
              Show {formatNumber(Math.min(PAGE_ROWS, shown.length - limit))} more ({formatNumber(shown.length - limit)} not shown; the CSV has all of them)
            </button>
          ) : null}
        </>
      ) : (
        <EmptyState title={q ? "Nothing matches your search" : emptyTitle} body={q ? "Try a shorter part of the text, or clear the search." : emptyBody} />
      )}
    </>
  );
}

/** The sub-view switch (kept under its old name: every tab uses it). */
export function ChipFilter<K extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { key: K; label: string; count?: number }[];
  value: K;
  onChange: (key: K) => void;
}) {
  return <Segmented label={label} options={options} value={value} onChange={onChange} />;
}
