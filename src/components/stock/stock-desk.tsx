"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { DataTable, type Column } from "@/components/stock/data-table";
import { SyncBar } from "@/components/stock/sync-bar";
import { SearchIcon } from "@/components/icons";
import { Chip, EmptyState } from "@/components/ui";
import { formatDate, formatNumber } from "@/lib/format";
import { formatDays, type CoverState } from "@/lib/flipkart-analysis";
import type { Tone } from "@/lib/labels";
import { restockHref, restockWarehouse, weightMetric } from "@/lib/stock-analysis";
import type { SyncSummary } from "@/lib/stock-sync";
import { DEFAULT_STOCK_SORT, STOCK_PAGE_SIZE, type StockMeta, type StockQuery, type StockRow, type StockViewData } from "@/lib/stock-view";
import { VIEW_KEYS, type ViewKey } from "@/lib/stock-views";
import { loadStockViewAction } from "@/server/actions/stock-view";

const VIEW_LABEL: Record<ViewKey, string> = {
  low: "Low stock",
  location: "By location",
  out: "Out of stock",
  weight: "Weight alerts",
  new: "New inactive",
  inactive: "All inactive",
};

/** Columns whose first tap sorts A to Z (the others sort biggest first). */
const TEXT_KEYS = new Set(["sku", "status", "listing"]);

export type StockDeskProps = {
  meta: StockMeta;
  /** The first page of the list the address asked for, read on the server. */
  initialQuery: StockQuery;
  initialData: StockViewData;
  latest: SyncSummary | null;
  lastDone: SyncSummary | null;
  canSync: boolean;
  /** Days of cover per SKU come with each row; this says whether there is enough history yet. */
  cover: { state: CoverState; limit: number; warehouseNames: Record<string, string> } | null;
};

// --- Small pieces ------------------------------------------------------------------------------

function SkuCell({ row }: { row: StockRow }) {
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

const sortable = () => null;

export function exportHref(q: StockQuery): string {
  const params = new URLSearchParams({ view: q.view, sort: q.sort, dir: q.dir });
  if (q.wh) params.set("wh", q.wh);
  if (q.q) params.set("q", q.q);
  if (q.hide) params.set("hide", "1");
  return `/flipkart/stock-export?${params.toString()}`;
}

// --- The desk ---------------------------------------------------------------------------------------

export function StockDesk({ meta, initialQuery, initialData, latest, lastDone, canSync, cover }: StockDeskProps) {
  const { warehouses, settings } = meta;
  const [query, setQuery] = useState<StockQuery>(initialQuery);
  const [qInput, setQInput] = useState(initialQuery.q);
  const [data, setData] = useState<StockViewData>(initialData);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const request = useRef(0);
  const first = useRef(true);

  const load = useCallback((q: StockQuery, append: boolean) => {
    const id = ++request.current;
    setLoading(true);
    setFailed(false);
    void loadStockViewAction(q).then((result) => {
      if (id !== request.current) return; // a newer request has taken over
      setLoading(false);
      if (!result.ok || !result.data) {
        setFailed(true);
        return;
      }
      const next = result.data;
      setData((prev) => (append ? { ...next, rows: [...prev.rows, ...next.rows] } : next));
    });
  }, []);

  // A new list, search, sort or warehouse starts again from the first page.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    load({ ...query, offset: 0 }, false);
  }, [query, load]);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery((q) => (q.q === qInput.trim() ? q : { ...q, q: qInput.trim(), offset: 0 })), 300);
    return () => window.clearTimeout(timer);
  }, [qInput]);

  // Keep the address in step with what is on screen, so a link or a refresh lands in the same place.
  useEffect(() => {
    const params = new URLSearchParams({ tab: "stock" });
    if (query.view !== "low") params.set("view", query.view);
    if (query.wh) params.set("wh", query.wh);
    if (query.q) params.set("q", query.q);
    if (query.hide) params.set("hide", "1");
    window.history.replaceState(null, "", `?${params.toString()}`);
  }, [query.view, query.wh, query.q, query.hide]);

  const patch = (p: Partial<StockQuery>) => setQuery((q) => ({ ...q, ...p, offset: 0 }));
  const choose = (view: ViewKey) => {
    patch({ view, ...DEFAULT_STOCK_SORT[view] });
    document.getElementById("stock-table")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const onSort = (key: string) => setQuery((q) => ({ ...q, offset: 0, sort: key, dir: q.sort === key ? (q.dir === "asc" ? "desc" : "asc") : TEXT_KEYS.has(key) ? "asc" : "desc" }));
  const more = () => load({ ...query, offset: data.rows.length }, true);

  if (warehouses.length === 0) {
    return (
      <EmptyState
        title="No warehouse is assigned to you"
        body="Stock is shown per warehouse. Ask the owner to add your warehouse to your account."
      />
    );
  }

  const selected = query.wh ? warehouses.findIndex((w) => w.id === query.wh) : -1;
  const scope = selected >= 0 ? [selected] : warehouses.map((_, i) => i);
  const scopeName = selected >= 0 ? warehouses[selected].name : meta.fullAccess ? null : "your warehouses";
  const where = selected >= 0 ? ` at ${warehouses[selected].name}` : meta.fullAccess ? " everywhere" : " at your warehouses";
  const { tiles } = data;
  const change = tiles.unitsChange;
  const sinceLabel = meta.previousDate ? `since ${formatDate(meta.previousDate, meta.today)}` : "";
  const view = query.view;

  // Columns -----------------------------------------------------------------------------------------
  const skuColumn: Column<StockRow>[] = [
    { key: "sku", label: "SKU", sort: sortable, cell: (r) => <SkuCell row={r} />, csv: () => null },
  ];
  const restockColumn: Column<StockRow> = {
    key: "restock",
    label: "",
    screenOnly: true,
    cell: (r) => <RestockLink href={restockHref(r.sku, restockWarehouse(r, meta, scope))} />,
    csv: () => null,
  };
  const wn = (i: number) => warehouses[i].name;
  const totalColumn: Column<StockRow> = { key: "total", label: "Total", align: "right", sort: sortable, cell: (r) => <b>{formatNumber(r.total)}</b>, csv: () => null };
  const coverColumn: Column<StockRow>[] = cover
    ? [
        {
          key: "cover",
          label: "Days left",
          align: "right",
          sort: sortable,
          cell: (r) => {
            const c = r.cover;
            if (!c) return <span className="text-muted">{cover.state.state === "collecting" ? "…" : "—"}</span>;
            return (
              <span className={c.days < cover.limit ? "font-semibold text-bad" : ""} title={`${c.units} units at ${cover.warehouseNames[c.warehouseId] ?? ""}, using ${Math.round(c.rate * 10) / 10} a day, from ${c.source === "orders" ? "orders" : "stock drops"}`}>
                {formatDays(c.days)}
                <span className="block text-[11px] font-normal text-muted">{cover.warehouseNames[c.warehouseId] ?? ""}</span>
              </span>
            );
          },
          csv: () => null,
        },
      ]
    : [];

  const columns: Record<ViewKey, Column<StockRow>[]> = {
    low: [
      ...skuColumn,
      { key: "empty", label: "Empty at", sort: sortable, cell: (r) => <Chips items={r.empty.map((i) => ({ label: wn(i), tone: "bad" as Tone }))} />, csv: () => null },
      { key: "lowAt", label: "Low at", sort: sortable, cell: (r) => <Chips items={r.low.map((i) => ({ label: `${wn(i)} ${formatNumber(r.now[i] as number)}`, tone: "warn" as Tone }))} />, csv: () => null },
      { key: "ok", label: "In stock at", sort: sortable, cell: (r) => <Chips items={r.ok.map((i) => ({ label: `${wn(i)} ${formatNumber(r.now[i] as number)}`, tone: "ok" as Tone }))} />, csv: () => null },
      totalColumn,
      ...coverColumn,
      restockColumn,
    ],
    location: [
      ...skuColumn,
      ...scope.map(
        (i): Column<StockRow> => ({
          key: `wh${i}`,
          label: wn(i),
          align: "right",
          sort: sortable,
          cell: (r) => <Qty n={r.now[i]} low={settings.low} />,
          csv: () => null,
        }),
      ),
      totalColumn,
      ...(meta.previousDate
        ? [
            {
              key: "change",
              label: `Change ${sinceLabel}`,
              align: "right" as const,
              sort: sortable,
              cell: (r: StockRow) => {
                const d = r.prevTotal === null ? null : r.total - r.prevTotal;
                if (d === null || d === 0) return <span className="text-muted">{d === 0 ? "0" : "—"}</span>;
                return <span className={d > 0 ? "font-semibold text-ok" : "font-semibold text-bad"}>{d > 0 ? `+${formatNumber(d)}` : `−${formatNumber(-d)}`}</span>;
              },
              csv: () => null,
            },
          ]
        : []),
      ...coverColumn,
      restockColumn,
    ],
    out: [
      ...skuColumn,
      {
        key: "status",
        label: "Status",
        sort: sortable,
        cell: (r) => <Chip tone={r.status === "ACTIVE" ? "ok" : "neutral"}>{r.status === "ACTIVE" ? "Active" : r.status === "INACTIVE" ? "Inactive" : r.status}</Chip>,
        csv: () => null,
      },
      {
        key: "listed",
        label: "Listed at",
        sort: sortable,
        cell: (r) => (r.listed.length ? <span className="text-xs">{r.listed.map(wn).join(", ")}</span> : <span className="text-muted">Nowhere</span>),
        csv: () => null,
      },
      {
        key: "yesterday",
        label: meta.previousDate ? `Units on ${formatDate(meta.previousDate, meta.today)}` : "Units before",
        align: "right",
        sort: sortable,
        cell: (r) => (r.prevTotal === null ? <span className="text-muted">—</span> : formatNumber(r.prevTotal)),
        csv: () => null,
      },
      {
        key: "ranout",
        label: "Ran out today",
        sort: sortable,
        cell: (r) => (r.prevTotal !== null && r.prevTotal > 0 ? <Chip tone="bad">Ran out today</Chip> : <span className="text-muted">—</span>),
        csv: () => null,
      },
      restockColumn,
    ],
    weight: [
      ...skuColumn,
      { key: "size", label: "L × B × H (cm)", sort: sortable, cell: (r) => (r.dims ? <span className="whitespace-nowrap">{`${r.dims.l} × ${r.dims.b} × ${r.dims.h}`}</span> : null), csv: () => null },
      { key: "grams", label: "Weight (g)", align: "right", sort: sortable, cell: (r) => (r.dims ? formatNumber(Math.round(weightMetric(r.dims).grams)) : null), csv: () => null },
      { key: "total", label: "Total", align: "right", sort: sortable, cell: (r) => (r.dims ? <b>{formatNumber(Math.round(weightMetric(r.dims).total))}</b> : null), csv: () => null },
      {
        key: "over",
        label: `Over ${formatNumber(settings.weightLimit)} by`,
        align: "right",
        sort: sortable,
        cell: (r) => (r.dims ? <span className="font-semibold text-bad">{formatNumber(Math.round(weightMetric(r.dims).total - settings.weightLimit))}</span> : null),
        csv: () => null,
      },
    ],
    new: inactiveColumns(skuColumn, meta),
    inactive: inactiveColumns(skuColumn, meta),
  };

  const cols = columns[view];
  const sortKnown = cols.some((c) => c.key === query.sort);
  const tileSub = (n: number | null) => (n === null ? "no earlier day to compare" : n === 0 ? `no change ${sinceLabel}` : `${n > 0 ? "+" : "−"}${formatNumber(Math.abs(n))} ${sinceLabel}`);
  const body: ReactNode =
    data.rows.length === 0 ? (
      <EmptyState title={query.q ? "No SKU matches your search" : emptyTitle(view)} body={query.q ? "Try a shorter part of the SKU or title, or clear the search." : emptyBody(view)} />
    ) : (
      <>
        <div className={loading ? "opacity-60 transition" : "transition"}>
          <DataTable columns={cols} rows={data.rows} sortKey={sortKnown ? query.sort : ""} sortDir={query.dir} onSort={onSort} rowKey={(r) => r.sku} />
        </div>
        {data.rows.length < data.total ? (
          <button type="button" onClick={more} disabled={loading} className="focus-ring mt-2 min-h-11 w-full rounded-lg border border-line bg-surface px-4 text-sm font-bold hover:bg-surface2 disabled:opacity-60">
            {loading ? "Loading…" : `Show ${formatNumber(Math.min(STOCK_PAGE_SIZE, data.total - data.rows.length))} more (${formatNumber(data.total - data.rows.length)} not shown; the CSV has all of them)`}
          </button>
        ) : null}
      </>
    );

  return (
    <>
      <SyncBar latest={latest} lastDone={lastDone} snapshotDate={meta.snapshotDate} previousDate={meta.previousDate} canSync={canSync} />

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Tile
          className="col-span-2 sm:col-span-1"
          label="Units in stock (active SKUs)"
          value={formatNumber(tiles.units)}
          sub={tileSub(change)}
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
        {data.cards.map((card) => {
          const on = selected === card.index;
          return (
            <button
              key={card.id}
              type="button"
              aria-pressed={on}
              onClick={() => patch({ wh: on ? "" : card.id })}
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
              onClick={() => patch({ view: key, ...DEFAULT_STOCK_SORT[key] })}
              className={`focus-ring flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm font-bold ${
                view === key ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-muted hover:text-ink"
              }`}
            >
              {VIEW_LABEL[key]}
              <span className={`text-xs ${view === key ? "text-accent-ink/80" : "text-muted"}`}>{formatNumber(data.counts[key])}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
            <label htmlFor="stock-search" className="sr-only">
              Search SKU or title
            </label>
            <input id="stock-search" type="search" className="input pl-10" placeholder="Search SKU or title" value={qInput} onChange={(e) => setQInput(e.target.value)} autoComplete="off" />
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
            <input type="checkbox" className="h-5 w-5 accent-(--accent)" checked={query.hide} onChange={(e) => patch({ hide: e.target.checked })} />
            Hide inactive listings
          </label>
          <a href={exportHref(query)} download className="focus-ring inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-bold hover:bg-surface2">
            Download CSV
          </a>
        </div>

        <p className="text-xs text-muted">
          {formatNumber(data.total)} {data.total === 1 ? "SKU" : "SKUs"}
          {scopeName ? ` · ${scopeName} only` : ""}
          {selected >= 0 ? " (tap the warehouse again to see all)" : ""}
          {view === "weight" ? ` · size in cm multiplied, plus weight in grams, over ${formatNumber(settings.weightLimit)}` : ""}
          {view === "low" ? ` · under ${formatNumber(settings.low)} units at a warehouse, still in stock somewhere` : ""}
        </p>
        {cover && (view === "low" || view === "location") ? (
          <p className="text-xs text-muted">
            {cover.state.state === "collecting"
              ? `Days left: collecting data${cover.state.readyOn ? `, ready on ${formatDate(cover.state.readyOn, meta.today)}` : ""}. It needs 7 days of stock history or of shipped orders.`
              : `Days left = units ÷ units used per day at the warehouse that runs out first (red under ${cover.limit} days). It uses real orders where there are some, stock drops otherwise.`}
          </p>
        ) : null}
        {failed ? (
          <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm font-semibold text-bad">
            Could not load this list. Check your connection and try again.
          </p>
        ) : null}
      </div>

      {body}
    </>
  );
}

function inactiveColumns(skuColumn: Column<StockRow>[], meta: StockMeta): Column<StockRow>[] {
  return [
    ...skuColumn,
    { key: "listing", label: "Listing ID", sort: sortable, cell: (r) => <span className="break-all font-mono text-xs">{r.listingId ?? "—"}</span>, csv: () => null },
    {
      key: "since",
      label: "Inactive since",
      sort: sortable,
      cell: (r): ReactNode =>
        r.beforeTracking ? (
          <Chip>Before tracking</Chip>
        ) : r.inactiveSince ? (
          <span className="whitespace-nowrap">{formatDate(r.inactiveSince, meta.today)}</span>
        ) : (
          <span className="text-muted">—</span>
        ),
      csv: () => null,
    },
    { key: "total", label: "Units", align: "right", sort: sortable, cell: (r) => formatNumber(r.total), csv: () => null },
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
