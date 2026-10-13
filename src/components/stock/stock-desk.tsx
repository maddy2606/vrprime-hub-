"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { DataTable, type Column } from "@/components/stock/data-table";
import { SyncBar } from "@/components/stock/sync-bar";
import { Caption, CsvButton, Dropdown, InfoTip, SearchField, Segmented, Toolbar } from "@/components/flipkart/kit";
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
  const { tiles } = data;
  const change = tiles.unitsChange;
  const sinceLabel = meta.previousDate ? `since ${formatDate(meta.previousDate, meta.today)}` : "";
  const view = selected >= 0 && query.view !== "low" && query.view !== "out" ? ("out" as ViewKey) : query.view;

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
              <span
                className={c.days < cover.limit ? "font-bold text-bad" : ""}
                title={`${formatNumber(c.units)} units at ${formatNumber(Math.round(c.rate * 10) / 10)} dispatched a day`}
              >
                {formatDays(c.days)}
              </span>
            );
          },
          csv: () => null,
        },
      ]
    : [];

  // One warehouse picked: two plain lists, what is out of stock there and what is low there.
  const oneWarehouse = selected >= 0;
  const hereIndex = selected;
  const here = (r: StockRow) => (hereIndex >= 0 ? r.now[hereIndex] : null);
  const whOutColumns: Column<StockRow>[] = [
    ...skuColumn,
    { key: "ranout", label: "Ran out", sort: sortable, cell: (r) => (r.prevTotal !== null && r.prevTotal > 0 ? <Chip tone="bad">Today</Chip> : <span className="text-muted">Before</span>), csv: () => null },
    { key: "yesterday", label: meta.previousDate ? `Units on ${formatDate(meta.previousDate, meta.today)}` : "Units before", align: "right", sort: sortable, cell: (r) => (r.prevTotal === null ? <span className="text-muted">—</span> : formatNumber(r.prevTotal)), csv: () => null, minor: true },
    restockColumn,
  ];
  const whLowColumns: Column<StockRow>[] = [
    ...skuColumn,
    { key: "total", label: "Units here", align: "right", sort: sortable, cell: (r) => <Qty n={here(r)} low={settings.low} />, csv: () => null },
    ...coverColumn,
    restockColumn,
  ];

  const columns: Record<ViewKey, Column<StockRow>[]> = {
    low: [
      ...skuColumn,
      { key: "empty", label: "Empty at", sort: sortable, cell: (r) => <Chips items={r.empty.map((i) => ({ label: wn(i), tone: "bad" as Tone }))} />, csv: () => null },
      { key: "lowAt", label: "Low at", sort: sortable, cell: (r) => <Chips items={r.low.map((i) => ({ label: `${wn(i)} ${formatNumber(r.now[i] as number)}`, tone: "warn" as Tone }))} />, csv: () => null },
      { key: "ok", label: "In stock at", sort: sortable, cell: (r) => <Chips items={r.ok.map((i) => ({ label: `${wn(i)} ${formatNumber(r.now[i] as number)}`, tone: "ok" as Tone }))} />, csv: () => null, minor: true },
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
              minor: true,
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

  const cols = oneWarehouse ? (view === "low" ? whLowColumns : whOutColumns) : columns[view];
  const sortKnown = cols.some((c) => c.key === query.sort);
  const body: ReactNode =
    data.rows.length === 0 ? (
      <EmptyState
        title={query.q ? "No SKU matches your search" : oneWarehouse ? (view === "low" ? `Nothing is low at ${warehouses[selected].name}` : `Nothing is out of stock at ${warehouses[selected].name}`) : emptyTitle(view)}
        body={query.q ? "Try a shorter part of the SKU or title, or clear the search." : oneWarehouse ? "Pick another warehouse, or all warehouses, from the list above." : emptyBody(view)}
      />
    ) : (
      <>
        <div className={loading ? "opacity-60 transition" : "transition"}>
          <DataTable columns={cols} rows={data.rows} sortKey={sortKnown ? query.sort : ""} sortDir={query.dir} onSort={onSort} rowKey={(r) => r.sku} />
        </div>
        {data.rows.length < data.total ? (
          <button type="button" onClick={more} disabled={loading} className="focus-ring mt-2 min-h-11 w-full rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-surface2 disabled:opacity-60">
            {loading ? "Loading…" : `Show ${formatNumber(Math.min(STOCK_PAGE_SIZE, data.total - data.rows.length))} more (${formatNumber(data.total - data.rows.length)} not shown; the CSV has all of them)`}
          </button>
        ) : null}
      </>
    );

  const pickWarehouse = (id: string) => {
    if (!id) return patch({ wh: "" });
    // A warehouse shows its two problem lists. Keep Low if that is what was open, otherwise start at Out of stock.
    const nextView: ViewKey = query.view === "low" ? "low" : "out";
    patch({ wh: id, view: nextView, ...DEFAULT_STOCK_SORT[nextView] });
  };

  return (
    <>
      <SyncBar latest={latest} lastDone={lastDone} snapshotDate={meta.snapshotDate} previousDate={meta.previousDate} canSync={canSync} />

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {data.cards.map((card) => {
          const on = selected === card.index;
          return (
            <button
              key={card.id}
              type="button"
              aria-pressed={on}
              onClick={() => pickWarehouse(on ? "" : card.id)}
              className={`focus-ring min-w-0 rounded-xl border p-3 text-left transition ${on ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-ink/30"}`}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-extrabold">{card.name}</span>
                <span className="shrink-0 text-xs font-semibold text-muted">{Math.round(card.share * 100)}%</span>
              </span>
              <span className="mt-1 block font-mono text-xl font-bold leading-none tabular-nums">{formatNumber(card.units)}</span>
              <span className="mt-2 flex flex-wrap gap-x-3 text-xs font-semibold">
                <span className={card.empty ? "text-bad" : "text-muted"}>{formatNumber(card.empty)} out</span>
                <span className={card.low ? "text-warn" : "text-muted"}>{formatNumber(card.low)} low</span>
              </span>
            </button>
          );
        })}
      </div>

      <div id="stock-table" />
      <Toolbar>
        {oneWarehouse ? (
          <Segmented<"out" | "low">
            label={`Stock problems at ${warehouses[selected].name}`}
            value={view === "low" ? "low" : "out"}
            onChange={(k) => patch({ view: k, ...DEFAULT_STOCK_SORT[k] })}
            options={[
              { key: "out", label: `Out of stock at ${warehouses[selected].name}`, count: data.counts.out },
              { key: "low", label: `Low at ${warehouses[selected].name}`, count: data.counts.low },
            ]}
          />
        ) : (
          <Segmented<ViewKey>
            label="Stock lists"
            value={view}
            onChange={(key) => patch({ view: key, ...DEFAULT_STOCK_SORT[key] })}
            options={VIEW_KEYS.map((key) => ({ key, label: VIEW_LABEL[key], count: data.counts[key] }))}
          />
        )}
        {warehouses.length > 1 ? (
          <Dropdown label="Warehouse" value={query.wh} onChange={pickWarehouse} options={[{ value: "", label: meta.fullAccess ? "All warehouses" : "All mine" }, ...warehouses.map((w) => ({ value: w.id, label: w.name }))]} />
        ) : null}
        <SearchField value={qInput} onChange={setQInput} placeholder="Search SKU or title" />
        <label className="flex min-h-11 items-center gap-2 whitespace-nowrap rounded-lg border border-line bg-surface px-3 text-sm font-semibold sm:min-h-9">
          <input type="checkbox" className="h-4 w-4 accent-(--accent)" checked={query.hide} onChange={(e) => patch({ hide: e.target.checked })} />
          Hide inactive
        </label>
        <CsvButton href={exportHref(query)} />
        <InfoTip>
          <p>
            {oneWarehouse
              ? `Out of stock = 0 units at ${warehouses[selected].name}. Low = under ${formatNumber(settings.low)} units there but not 0. Tap the warehouse again, or choose All warehouses, to see every SKU.`
              : `Low stock = still in stock somewhere, but 0 or under ${formatNumber(settings.low)} units at a warehouse. Pick a warehouse to see just what is out of stock or low there.`}
          </p>
          {cover ? (
            <p className="mt-2">
              {cover.state.state === "collecting"
                ? `Days left: collecting data${cover.state.readyOn ? `, ready on ${formatDate(cover.state.readyOn, meta.today)}` : ""}. It needs 7 days of dispatch history.`
                : `Days left = stock ÷ units dispatched per day over the last 30 days (by dispatch day), the same as Forecasting. Red under ${cover.limit} days.`}
            </p>
          ) : null}
          {view === "weight" ? <p className="mt-2">Weight alert: size in cm multiplied, plus weight in grams, over {formatNumber(settings.weightLimit)}.</p> : null}
        </InfoTip>
      </Toolbar>
      <Caption>
        {formatNumber(data.total)} {data.total === 1 ? "SKU" : "SKUs"}
        {scopeName ? ` · ${scopeName}` : ""}
        {!oneWarehouse ? ` · ${formatNumber(tiles.units)} units in stock${change === null ? "" : change === 0 ? ` (no change ${sinceLabel})` : ` (${change > 0 ? "+" : "−"}${formatNumber(Math.abs(change))} ${sinceLabel})`}` : ""}
      </Caption>
      {failed ? (
        <p role="alert" className="mb-3 rounded-lg bg-bad-soft px-3 py-2 text-sm font-semibold text-bad">
          Could not load this list. Check your connection and try again.
        </p>
      ) : null}

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
