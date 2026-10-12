"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { DataTable, type Column } from "@/components/stock/data-table";
import { SyncBar } from "@/components/stock/sync-bar";
import { SearchIcon } from "@/components/icons";
import { Chip, EmptyState } from "@/components/ui";
import { downloadCsv, toCsv, type CsvCell } from "@/lib/csv";
import { formatDate, formatNumber } from "@/lib/format";
import type { Tone } from "@/lib/labels";
import {
  analyze,
  restockHref,
  restockWarehouse,
  searchRows,
  sortRows,
  warehouseCards,
  weightMetric,
  type DeskData,
  type Row,
} from "@/lib/stock-analysis";
import type { SyncSummary } from "@/lib/stock-sync";
import { VIEW_KEYS, type ViewKey } from "@/lib/stock-views";

const VIEW_LABEL: Record<ViewKey, string> = {
  low: "Low stock",
  location: "By location",
  out: "Out of stock",
  weight: "Weight alerts",
  new: "New inactive",
  inactive: "All inactive",
};

type SortState = { key: string; dir: "asc" | "desc" };
const DEFAULT_SORT: Record<ViewKey, SortState> = {
  low: { key: "empty", dir: "desc" },
  location: { key: "sku", dir: "asc" },
  out: { key: "ranout", dir: "desc" },
  weight: { key: "total", dir: "desc" },
  new: { key: "since", dir: "desc" },
  inactive: { key: "since", dir: "desc" },
};

export type StockDeskProps = {
  data: DeskData;
  latest: SyncSummary | null;
  lastDone: SyncSummary | null;
  canSync: boolean;
  initial: { view: ViewKey; warehouseId: string; q: string; hide: boolean };
};

// --- Small pieces ------------------------------------------------------------------------------

function SkuCell({ row }: { row: Row }) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="break-all font-mono text-[13px] font-bold leading-tight">{row.sku}</span>
        {row.status === "INACTIVE" ? <Chip>Inactive</Chip> : null}
      </div>
      {row.title ? <p className="mt-0.5 line-clamp-2 break-words text-xs leading-snug text-muted">{row.title}</p> : null}
    </div>
  );
}

function Qty({ n, low }: { n: number | null; low: number }) {
  if (n === null) return <span className="text-muted" aria-label="not listed here">—</span>;
  const tone = n === 0 ? "bg-bad-soft text-bad" : n < low ? "bg-warn-soft text-warn" : "";
  return <span className={`inline-block min-w-12 rounded px-1.5 py-0.5 text-right font-semibold ${tone}`}>{formatNumber(n)}</span>;
}

function Chips({ items }: { items: { label: string; tone: Tone }[] }) {
  if (items.length === 0) return <span className="text-muted">—</span>;
  return (
    <div className="flex min-w-36 flex-wrap gap-1">
      {items.map((item) => (
        <Chip key={item.label} tone={item.tone}>
          {item.label}
        </Chip>
      ))}
    </div>
  );
}

function RestockLink({ href }: { href: string }) {
  return (
    <Link
      prefetch={false}
      href={href}
      className="focus-ring inline-flex min-h-9 items-center whitespace-nowrap rounded-lg px-2 text-xs font-bold text-accent-text hover:bg-accent-soft"
    >
      + Restock
    </Link>
  );
}

function Tile({
  label,
  value,
  sub,
  subTone = "text-muted",
  active,
  onClick,
  className = "",
}: {
  label: string;
  value: string;
  sub?: string;
  subTone?: string;
  active: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`focus-ring min-w-0 rounded-xl border p-3 text-left transition ${
        active ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-accent"
      } ${className}`}
    >
      <span className={`block text-xs font-bold leading-tight ${active ? "text-accent-text" : "text-muted"}`}>{label}</span>
      <span className="mt-1 block text-2xl font-extrabold leading-none tracking-tight">{value}</span>
      {sub ? <span className={`mt-1 block text-xs font-semibold ${subTone}`}>{sub}</span> : null}
    </button>
  );
}

// --- The desk ---------------------------------------------------------------------------------------

export function StockDesk({ data, latest, lastDone, canSync, initial }: StockDeskProps) {
  const { warehouses, settings } = data;
  const initialIndex = warehouses.findIndex((w) => w.id === initial.warehouseId);

  const [view, setView] = useState<ViewKey>(initial.view);
  const [selected, setSelected] = useState<number | null>(initialIndex >= 0 ? initialIndex : null);
  const [q, setQ] = useState(initial.q);
  const [hide, setHide] = useState(initial.hide);
  const [sorts, setSorts] = useState<Record<ViewKey, SortState>>(DEFAULT_SORT);

  // Keep the address in step with what is on screen, so a link or a refresh lands in the same place.
  useEffect(() => {
    const params = new URLSearchParams();
    if (view !== "low") params.set("view", view);
    if (selected !== null) params.set("wh", warehouses[selected].id);
    if (q.trim()) params.set("q", q.trim());
    if (hide) params.set("hide", "1");
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [view, selected, q, hide, warehouses]);

  const scope = useMemo(() => (selected !== null ? [selected] : warehouses.map((_, i) => i)), [selected, warehouses]);
  const analysis = useMemo(() => analyze(data, scope, hide), [data, scope, hide]);
  const cards = useMemo(() => warehouseCards(data, hide), [data, hide]);

  if (warehouses.length === 0) {
    return (
      <EmptyState
        title="No warehouse is assigned to you"
        body="Stock is shown per warehouse. Ask the owner to add your warehouse to your account."
      />
    );
  }

  const scopeName = selected !== null ? warehouses[selected].name : data.fullAccess ? null : "your warehouses";
  const where = selected !== null ? ` at ${warehouses[selected].name}` : data.fullAccess ? " everywhere" : " at your warehouses";
  const { tiles } = analysis;
  const change = tiles.unitsChange;
  const sinceLabel = data.previousDate ? `since ${formatDate(data.previousDate, data.today)}` : "";

  const sortState = sorts[view];
  // First tap sorts text columns A to Z and number columns biggest first; a second tap reverses.
  const onSort = (key: string) =>
    setSorts((all) => {
      const current = all[view];
      const dir = current.key === key ? (current.dir === "asc" ? "desc" : "asc") : ["sku", "status", "listing"].includes(key) ? "asc" : "desc";
      return { ...all, [view]: { key, dir } };
    });

  const visibleRows = hide ? analysis.rows.filter((r) => r.status !== "INACTIVE") : analysis.rows;
  const counts: Record<ViewKey, number> = {
    low: analysis.low.length,
    location: visibleRows.length,
    out: analysis.out.length,
    weight: analysis.weight.length,
    new: analysis.newInactive.length,
    inactive: analysis.allInactive.length,
  };

  // Columns -----------------------------------------------------------------------------------------
  const skuColumn: Column<Row>[] = [
    { key: "sku", label: "SKU", sort: (r) => r.sku, cell: (r) => <SkuCell row={r} />, csv: (r) => r.sku },
    { key: "title", label: "Title", csvOnly: true, cell: () => null, csv: (r) => r.title },
  ];
  const restockColumn: Column<Row> = {
    key: "restock",
    label: "",
    screenOnly: true,
    cell: (r) => <RestockLink href={restockHref(r.sku, restockWarehouse(r, data, scope))} />,
    csv: () => null,
  };
  const wn = (i: number) => warehouses[i].name;

  const columns: Record<ViewKey, Column<Row>[]> = {
    low: [
      ...skuColumn,
      {
        key: "empty",
        label: "Empty at",
        sort: (r) => r.empty.length,
        cell: (r) => <Chips items={r.empty.map((i) => ({ label: wn(i), tone: "bad" as Tone }))} />,
        csv: (r) => r.empty.map(wn).join("; "),
      },
      {
        key: "lowAt",
        label: "Low at",
        sort: (r) => r.low.length,
        cell: (r) => <Chips items={r.low.map((i) => ({ label: `${wn(i)} ${formatNumber(r.now[i] as number)}`, tone: "warn" as Tone }))} />,
        csv: (r) => r.low.map((i) => `${wn(i)} ${r.now[i]}`).join("; "),
      },
      {
        key: "ok",
        label: "In stock at",
        sort: (r) => r.ok.length,
        cell: (r) => <Chips items={r.ok.map((i) => ({ label: `${wn(i)} ${formatNumber(r.now[i] as number)}`, tone: "ok" as Tone }))} />,
        csv: (r) => r.ok.map((i) => `${wn(i)} ${r.now[i]}`).join("; "),
      },
      { key: "total", label: "Total", align: "right", sort: (r) => r.total, cell: (r) => <b>{formatNumber(r.total)}</b>, csv: (r) => r.total },
      restockColumn,
    ],
    location: [
      ...skuColumn,
      ...scope.map(
        (i): Column<Row> => ({
          key: `wh${i}`,
          label: wn(i),
          align: "right",
          sort: (r) => r.now[i],
          cell: (r) => <Qty n={r.now[i]} low={settings.low} />,
          csv: (r) => r.now[i],
        }),
      ),
      { key: "total", label: "Total", align: "right", sort: (r) => r.total, cell: (r) => <b>{formatNumber(r.total)}</b>, csv: (r) => r.total },
      ...(data.previousDate
        ? [
            {
              key: "change",
              label: `Change ${sinceLabel}`,
              align: "right" as const,
              sort: (r: Row) => (r.prevTotal === null ? null : r.total - r.prevTotal),
              cell: (r: Row) => {
                const d = r.prevTotal === null ? null : r.total - r.prevTotal;
                if (d === null || d === 0) return <span className="text-muted">{d === 0 ? "0" : "—"}</span>;
                return <span className={d > 0 ? "font-semibold text-ok" : "font-semibold text-bad"}>{d > 0 ? `+${formatNumber(d)}` : `−${formatNumber(-d)}`}</span>;
              },
              csv: (r: Row) => (r.prevTotal === null ? null : r.total - r.prevTotal),
            },
          ]
        : []),
      restockColumn,
    ],
    out: [
      ...skuColumn,
      {
        key: "status",
        label: "Status",
        sort: (r) => r.status,
        cell: (r) => <Chip tone={r.status === "ACTIVE" ? "ok" : "neutral"}>{r.status === "ACTIVE" ? "Active" : r.status === "INACTIVE" ? "Inactive" : r.status}</Chip>,
        csv: (r) => r.status,
      },
      {
        key: "listed",
        label: "Listed at",
        sort: (r) => r.listed.length,
        cell: (r) => (r.listed.length ? <span className="text-xs">{r.listed.map(wn).join(", ")}</span> : <span className="text-muted">Nowhere</span>),
        csv: (r) => r.listed.map(wn).join("; "),
      },
      {
        key: "yesterday",
        label: data.previousDate ? `Units on ${formatDate(data.previousDate, data.today)}` : "Units before",
        align: "right",
        sort: (r) => r.prevTotal,
        cell: (r) => (r.prevTotal === null ? <span className="text-muted">—</span> : formatNumber(r.prevTotal)),
        csv: (r) => r.prevTotal,
      },
      {
        key: "ranout",
        label: "Ran out today",
        sort: (r) => (r.prevTotal !== null && r.prevTotal > 0 ? 1 : 0),
        cell: (r) => (r.prevTotal !== null && r.prevTotal > 0 ? <Chip tone="bad">Ran out today</Chip> : <span className="text-muted">—</span>),
        csv: (r) => (r.prevTotal !== null && r.prevTotal > 0 ? "yes" : ""),
      },
      restockColumn,
    ],
    weight: [
      ...skuColumn,
      {
        key: "size",
        label: "L × B × H (cm)",
        sort: (r) => (r.dims ? weightMetric(r.dims).volume : null),
        cell: (r) => (r.dims ? <span className="whitespace-nowrap">{`${r.dims.l} × ${r.dims.b} × ${r.dims.h}`}</span> : null),
        csv: (r) => (r.dims ? `${r.dims.l} x ${r.dims.b} x ${r.dims.h}` : null),
      },
      {
        key: "grams",
        label: "Weight (g)",
        align: "right",
        sort: (r) => (r.dims ? weightMetric(r.dims).grams : null),
        cell: (r) => (r.dims ? formatNumber(Math.round(weightMetric(r.dims).grams)) : null),
        csv: (r) => (r.dims ? Math.round(weightMetric(r.dims).grams) : null),
      },
      {
        key: "total",
        label: "Total",
        align: "right",
        sort: (r) => (r.dims ? weightMetric(r.dims).total : null),
        cell: (r) => (r.dims ? <b>{formatNumber(Math.round(weightMetric(r.dims).total))}</b> : null),
        csv: (r) => (r.dims ? Math.round(weightMetric(r.dims).total) : null),
      },
      {
        key: "over",
        label: `Over ${formatNumber(settings.weightLimit)} by`,
        align: "right",
        sort: (r) => (r.dims ? weightMetric(r.dims).total - settings.weightLimit : null),
        cell: (r) => (r.dims ? <span className="font-semibold text-bad">{formatNumber(Math.round(weightMetric(r.dims).total - settings.weightLimit))}</span> : null),
        csv: (r) => (r.dims ? Math.round(weightMetric(r.dims).total - settings.weightLimit) : null),
      },
    ],
    new: inactiveColumns(skuColumn, data),
    inactive: inactiveColumns(skuColumn, data),
  };

  const rowsByView: Record<ViewKey, Row[]> = {
    low: analysis.low,
    location: visibleRows,
    out: analysis.out,
    weight: analysis.weight,
    new: analysis.newInactive,
    inactive: analysis.allInactive,
  };

  const cols = columns[view];
  const sortColumn = cols.find((c) => c.key === sortState.key && c.sort) ?? cols.find((c) => c.sort);
  const filtered = searchRows(rowsByView[view], q);
  const sorted = sortColumn?.sort ? sortRows(filtered, sortColumn.sort, sortState.dir) : filtered;

  const exportCsv = () => {
    const exportCols = cols.filter((c) => !c.screenOnly);
    const csv = toCsv(
      exportCols.map((c) => c.label),
      sorted.map((r): CsvCell[] => exportCols.map((c) => c.csv(r))),
    );
    downloadCsv(`vrprime-stock-${view}-${data.snapshotDate}.csv`, csv);
  };

  // Tapping a tile opens its list and brings it into view.
  const choose = (next: ViewKey) => {
    setView(next);
    document.getElementById("stock-table")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      <SyncBar latest={latest} lastDone={lastDone} snapshotDate={data.snapshotDate} previousDate={data.previousDate} canSync={canSync} />

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Tile
          className="col-span-2 sm:col-span-1"
          label="Units in stock (active SKUs)"
          value={formatNumber(tiles.units)}
          sub={change === null ? "no earlier day to compare" : change === 0 ? `no change ${sinceLabel}` : `${change > 0 ? "+" : "−"}${formatNumber(Math.abs(change))} ${sinceLabel}`}
          subTone={change === null || change === 0 ? "text-muted" : change > 0 ? "text-ok" : "text-bad"}
          active={view === "location"}
          onClick={() => choose("location")}
        />
        <Tile label="Low stock SKUs" value={formatNumber(tiles.low)} sub={`under ${formatNumber(settings.low)} units`} subTone={tiles.low ? "text-warn" : "text-muted"} active={view === "low"} onClick={() => choose("low")} />
        <Tile label={`Out of stock${where}`} value={formatNumber(tiles.out)} sub="0 units" subTone={tiles.out ? "text-bad" : "text-muted"} active={view === "out"} onClick={() => choose("out")} />
        <Tile label="Weight alerts" value={formatNumber(tiles.weight)} sub={`over ${formatNumber(settings.weightLimit)}`} subTone={tiles.weight ? "text-warn" : "text-muted"} active={view === "weight"} onClick={() => choose("weight")} />
        <Tile label="New inactive" value={formatNumber(tiles.newInactive)} sub={`last ${settings.newInactiveDays} days`} subTone={tiles.newInactive ? "text-bad" : "text-muted"} active={view === "new"} onClick={() => choose("new")} />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((card) => {
          const on = selected === card.index;
          return (
            <button
              key={card.id}
              type="button"
              aria-pressed={on}
              onClick={() => setSelected(on ? null : card.index)}
              className={`focus-ring min-w-0 rounded-xl border p-3 text-left transition ${on ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-accent"}`}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className={`truncate text-sm font-extrabold ${on ? "text-accent-text" : ""}`}>{card.name}</span>
                <span className="shrink-0 text-xs font-semibold text-muted">{Math.round(card.share * 100)}%</span>
              </span>
              <span className="mt-1 block text-xl font-extrabold leading-none tracking-tight">{formatNumber(card.units)}</span>
              <span className="mt-1.5 flex flex-wrap gap-x-3 text-xs font-semibold">
                <span className={card.empty ? "text-bad" : "text-muted"}>{formatNumber(card.empty)} empty</span>
                <span className={card.low ? "text-warn" : "text-muted"}>{formatNumber(card.low)} low</span>
              </span>
            </button>
          );
        })}
      </div>

      <div id="stock-table" className="mb-3 flex flex-col gap-2">
        <div role="tablist" aria-label="Stock lists" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0">
          {VIEW_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              onClick={() => setView(key)}
              className={`focus-ring flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm font-bold ${
                view === key ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-muted hover:text-ink"
              }`}
            >
              {VIEW_LABEL[key]}
              <span className={`text-xs ${view === key ? "text-accent-ink/80" : "text-muted"}`}>{formatNumber(counts[key])}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
            <label htmlFor="stock-search" className="sr-only">
              Search SKU or title
            </label>
            <input id="stock-search" type="search" className="input pl-10" placeholder="Search SKU or title" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
            <input type="checkbox" className="h-5 w-5 accent-(--accent)" checked={hide} onChange={(e) => setHide(e.target.checked)} />
            Hide inactive listings
          </label>
          <button type="button" onClick={exportCsv} disabled={sorted.length === 0} className="focus-ring min-h-11 rounded-lg border border-line bg-surface px-4 text-sm font-bold hover:bg-surface2 disabled:opacity-50">
            Download CSV
          </button>
        </div>

        <p className="text-xs text-muted">
          {formatNumber(sorted.length)} {sorted.length === 1 ? "SKU" : "SKUs"}
          {scopeName ? ` · ${scopeName} only` : ""}
          {selected !== null ? " (tap the warehouse again to see all)" : ""}
          {view === "weight" ? ` · size in cm multiplied, plus weight in grams, over ${formatNumber(settings.weightLimit)}` : ""}
          {view === "low" ? ` · under ${formatNumber(settings.low)} units at a warehouse, still in stock somewhere` : ""}
        </p>
      </div>

      {sorted.length ? (
        <DataTable columns={cols} rows={sorted} sortKey={sortColumn?.key ?? ""} sortDir={sortState.dir} onSort={onSort} rowKey={(r) => r.sku} />
      ) : (
        <EmptyState title={q ? "No SKU matches your search" : emptyTitle(view)} body={q ? "Try a shorter part of the SKU or title, or clear the search." : emptyBody(view)} />
      )}
    </>
  );
}

function inactiveColumns(skuColumn: Column<Row>[], data: DeskData): Column<Row>[] {
  return [
    ...skuColumn,
    {
      key: "listing",
      label: "Listing ID",
      sort: (r) => r.listingId,
      cell: (r) => <span className="break-all font-mono text-xs">{r.listingId ?? "—"}</span>,
      csv: (r) => r.listingId,
    },
    {
      key: "since",
      label: "Inactive since",
      sort: (r) => r.inactiveSince,
      cell: (r): ReactNode =>
        r.beforeTracking ? (
          <Chip>Before tracking</Chip>
        ) : r.inactiveSince ? (
          <span className="whitespace-nowrap">{formatDate(r.inactiveSince, data.today)}</span>
        ) : (
          <span className="text-muted">—</span>
        ),
      csv: (r) => (r.beforeTracking ? "before tracking" : r.inactiveSince),
    },
    { key: "total", label: "Units", align: "right", sort: (r) => r.total, cell: (r) => formatNumber(r.total), csv: (r) => r.total },
  ];
}

function emptyTitle(view: ViewKey): string {
  switch (view) {
    case "low":
      return "Nothing is running low";
    case "location":
      return "No SKUs to show";
    case "out":
      return "Nothing is out of stock";
    case "weight":
      return "No weight alerts";
    case "new":
      return "Nothing went inactive recently";
    case "inactive":
      return "No inactive listings";
  }
}

function emptyBody(view: ViewKey): string {
  switch (view) {
    case "low":
      return "Every SKU that still has stock is at or above the low-stock level at each warehouse it is listed in.";
    case "location":
      return "Nothing matches the current filters.";
    case "out":
      return "Every SKU has units somewhere.";
    case "weight":
      return "Every listing is under the weight limit, or has no size on Flipkart to check.";
    case "new":
      return "Listings that were already inactive when tracking began are under All inactive.";
    case "inactive":
      return "Every listing Flipkart reports is active.";
  }
}
