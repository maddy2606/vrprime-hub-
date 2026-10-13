"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SearchIcon } from "@/components/icons";
import { ChipFilter } from "@/components/flipkart/list-view";
import { OrdersSyncBar } from "@/components/flipkart/orders-sync-bar";
import { BUCKET_TONE, SkuGroups } from "@/components/flipkart/sku-groups";
import { DataTable, type Column } from "@/components/stock/data-table";
import { Chip, EmptyState } from "@/components/ui";
import { formatDue, isRed, urgency } from "@/lib/flipkart-analysis";
import { formatDate, formatNumber, todayIST } from "@/lib/format";
import {
  ACTIVE_BUCKETS,
  BUCKET_LABEL,
  DEFAULT_SORT,
  ORDER_VIEWS,
  STATUS_FILTERS,
  type CancelLine,
  type CancelType,
  type OrderLine,
  type OrdersQuery,
  type OrdersViewResult,
  type OrderView,
  type PickDue,
  type PickRow,
  type StatusFilter,
  type UpcomingRow,
  type WarehouseOrders,
} from "@/lib/orders-view";
import type { OrderSyncState } from "@/lib/orders-sync";
import { loadOrdersViewAction } from "@/server/actions/orders-view";

type Props = {
  cards: WarehouseOrders[];
  warehouses: { id: string; name: string }[];
  state: OrderSyncState;
  canSync: boolean;
  today: string;
  /** The moment the page was made, so server and browser agree on what is late. */
  nowIso: string;
  /** The first page of the list the address asked for, read on the server. */
  initialQuery: OrdersQuery;
  initialData: OrdersViewResult;
};

const VIEW_LABEL: Record<OrderView, string> = {
  sku: "By SKU",
  list: "Order list",
  pick: "Pick list",
  upcoming: "Upcoming vs stock",
  cancelled: "Cancelled (30 days)",
};

const SKU_SORTS: { key: string; dir: "asc" | "desc"; label: string }[] = [
  { key: "due", dir: "asc", label: "Earliest dispatch-by" },
  { key: "units", dir: "desc", label: "Most units" },
  { key: "orders", dir: "desc", label: "Most orders" },
  { key: "sku", dir: "asc", label: "SKU A to Z" },
];

/** Columns whose first tap sorts A to Z (the others sort biggest first). */
const TEXT_KEYS = new Set(["order", "sku", "wh", "status", "type", "reason"]);

const sortable = () => null;

export function exportHref(q: OrdersQuery): string {
  const params = new URLSearchParams({ view: q.view, status: q.status, sort: q.sort, dir: q.dir, pickDue: q.pickDue, cancelType: q.cancelType });
  if (q.wh) params.set("wh", q.wh);
  if (q.q) params.set("q", q.q);
  if (q.shortOnly) params.set("shortOnly", "1");
  return `/flipkart/export?${params.toString()}`;
}

function SkeletonRows() {
  return (
    <div aria-busy="true" aria-label="Loading">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="skeleton mb-2 h-20 w-full" />
      ))}
    </div>
  );
}

export function OrdersTab({ cards, warehouses, state, canSync, today, nowIso, initialQuery, initialData }: Props) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const [query, setQuery] = useState<OrdersQuery>(initialQuery);
  const [qInput, setQInput] = useState(initialQuery.q);
  const [data, setData] = useState<OrdersViewResult>(initialData);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const request = useRef(0);
  const first = useRef(true);
  // The numbers shown on the view chips, kept from the last time that view was loaded.
  const [badges, setBadges] = useState<{ cancelled: number | null; upcoming: number | null }>({
    cancelled: initialData.view === "cancelled" ? initialData.summary.seller_total + initialData.summary.buyer_total : null,
    upcoming: initialData.view === "upcoming" ? initialData.shortCount : null,
  });

  const load = useCallback((q: OrdersQuery, append: boolean) => {
    const id = ++request.current;
    setLoading(true);
    setFailed(false);
    void loadOrdersViewAction(q).then((result) => {
      if (id !== request.current) return; // a newer request has taken over
      setLoading(false);
      if (!result.ok || !result.data) {
        setFailed(true);
        return;
      }
      const next = result.data;
      if (next.view === "cancelled" && q.offset === 0) setBadges((b) => ({ ...b, cancelled: next.summary.seller_total + next.summary.buyer_total }));
      if (next.view === "upcoming") setBadges((b) => ({ ...b, upcoming: next.shortCount }));
      setData((prev) => {
        if (!append || prev.view !== next.view) return next;
        const rows = [...prev.rows, ...next.rows] as typeof next.rows;
        return next.view === "cancelled" && prev.view === "cancelled" ? { ...next, rows: rows as CancelLine[], summary: prev.summary } : ({ ...next, rows } as OrdersViewResult);
      });
    });
  }, []);

  // A new list, search or sort starts again from the first page.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    load({ ...query, offset: 0 }, false);
  }, [query, load]);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery((q) => (q.q === qInput.trim() ? q : { ...q, q: qInput.trim() })), 300);
    return () => window.clearTimeout(timer);
  }, [qInput]);

  useEffect(() => {
    const params = new URLSearchParams({ tab: "orders" });
    if (query.view !== "sku") params.set("view", query.view);
    if (query.status !== "active") params.set("status", query.status);
    if (query.wh) params.set("wh", query.wh);
    window.history.replaceState(null, "", `?${params.toString()}`);
  }, [query.view, query.status, query.wh]);

  const more = () => load({ ...query, offset: data.rows.length }, true);
  const patch = (p: Partial<OrdersQuery>) => setQuery((q) => ({ ...q, ...p }));
  const setView = (view: OrderView) => patch({ view, ...DEFAULT_SORT[view], offset: 0 });
  const onSort = (key: string) =>
    setQuery((q) => ({ ...q, sort: key, dir: q.sort === key ? (q.dir === "asc" ? "desc" : "asc") : TEXT_KEYS.has(key) ? "asc" : "desc" }));

  const nameOf = (id: string | null) => warehouses.find((w) => w.id === id)?.name ?? "Unknown";
  const toggleWarehouse = (id: string | null) => patch({ wh: id === null || query.wh === id ? "" : id });
  const scoped = query.wh ? cards.filter((c) => c.warehouseId === query.wh) : cards;
  const statusCount = (s: StatusFilter) => scoped.reduce((n, c) => n + (s === "active" ? c.active : c[s]), 0);
  const transitCount = scoped.reduce((n, c) => n + c.inTransit, 0);
  const scope = query.wh ? `${nameOf(query.wh)} only (tap the warehouse again to see all)` : undefined;

  const ready = data.view === query.view;
  const showStatus = query.view === "sku" || query.view === "list";
  const emptyBody =
    query.status === "upcoming"
      ? "No upcoming orders, or the nightly read of every upcoming order has not run yet."
      : query.status === "processing"
        ? "Flipkart is not working on any order at the moment."
        : "Nothing is waiting here at the moment, or the first read from Flipkart has not finished.";

  const orderCell = (id: string) => <span className="break-all font-mono text-xs">{id}</span>;
  const skuCell = (sku: string | null, title?: string | null, extra?: string) => (
    <div className="max-w-36 sm:max-w-60">
      <span className="block break-all font-mono text-[13px] font-bold">{sku || "—"}</span>
      {title ? <span className="block truncate text-xs text-muted">{title}</span> : null}
      {extra ? <span className="block text-xs font-semibold">{extra}</span> : null}
    </div>
  );

  const listColumns: Column<OrderLine>[] = [
    {
      key: "due",
      label: "Dispatch by",
      sort: sortable,
      cell: (o) => {
        const u = urgency(o.dispatch_by, now);
        const counts = !o.hold && ACTIVE_BUCKETS.includes(o.bucket);
        return (
          <div className="flex flex-col items-start gap-1">
            <span className={`whitespace-nowrap font-semibold ${counts && isRed(u) ? "text-bad" : ""}`}>{o.dispatch_by ? formatDue(o.dispatch_by, now) : "—"}</span>
            {o.hold ? <Chip tone="neutral">On hold</Chip> : counts && u === "late" ? <Chip tone="bad">Late</Chip> : counts && u === "today" ? <Chip tone="bad">Today</Chip> : null}
          </div>
        );
      },
      csv: () => null,
    },
    { key: "order", label: "Order ID", sort: sortable, cell: (o) => orderCell(o.order_id), csv: () => null },
    { key: "sku", label: "SKU", sort: sortable, cell: (o) => skuCell(o.sku), csv: () => null },
    { key: "qty", label: "Qty", align: "right", sort: sortable, cell: (o) => formatNumber(o.quantity), csv: () => null },
    { key: "wh", label: "Warehouse", cell: (o) => nameOf(o.warehouse_id), csv: () => null },
    { key: "status", label: "Status", sort: sortable, cell: (o) => <Chip tone={BUCKET_TONE[o.bucket]}>{BUCKET_LABEL[o.bucket]}</Chip>, csv: () => null },
    { key: "after", label: "Active from", sort: sortable, cell: (o) => <span className="whitespace-nowrap text-xs">{o.dispatch_after ? formatDue(o.dispatch_after, now) : "—"}</span>, csv: () => null },
  ];

  const pickColumns: Column<PickRow>[] = [
    { key: "sku", label: "SKU", sort: sortable, cell: (r) => skuCell(r.sku, r.title), csv: () => null },
    { key: "units", label: "Units", align: "right", sort: sortable, cell: (r) => <span className="text-base font-extrabold tabular-nums">{formatNumber(r.units)}</span>, csv: () => null },
    {
      key: "stock",
      label: "Stock",
      align: "right",
      sort: sortable,
      cell: (r) =>
        r.stock === null ? (
          <span className="text-xs text-muted">not listed</span>
        ) : (
          <span className={`tabular-nums ${r.stock < r.units ? "font-bold text-bad" : ""}`}>
            {formatNumber(r.stock)}
            {r.stock < r.units ? <span className="block whitespace-nowrap text-[11px]">short by {formatNumber(r.units - r.stock)}</span> : null}
          </span>
        ),
      csv: () => null,
    },
    { key: "due", label: "Dispatch by", sort: sortable, cell: (r) => <span className={`whitespace-nowrap text-xs font-semibold ${isRed(urgency(r.due, now)) ? "text-bad" : ""}`}>{r.due ? formatDue(r.due, now) : "—"}</span>, csv: () => null },
    { key: "orders", label: "Orders", align: "right", sort: sortable, cell: (r) => formatNumber(r.orders), csv: () => null },
    { key: "accept", label: "To Accept", align: "right", sort: sortable, cell: (r) => formatNumber(r.to_accept), csv: () => null },
    { key: "pack", label: "To Pack", align: "right", sort: sortable, cell: (r) => formatNumber(r.to_pack), csv: () => null },
  ];

  const upcomingColumns: Column<UpcomingRow>[] = [
    { key: "sku", label: "SKU", sort: sortable, cell: (r) => skuCell(r.sku, r.title, nameOf(r.warehouse_id)), csv: () => null },
    { key: "upcoming", label: "Upcoming units", align: "right", sort: sortable, cell: (r) => <span className="font-bold tabular-nums">{formatNumber(r.upcoming)}</span>, csv: () => null },
    { key: "stock", label: "Stock", align: "right", sort: sortable, cell: (r) => (r.stock === null ? <span className="text-xs text-muted">not listed</span> : <span className="tabular-nums">{formatNumber(r.stock)}</span>), csv: () => null },
    { key: "short", label: "Short by", align: "right", sort: sortable, cell: (r) => (r.short > 0 ? <span className="font-bold tabular-nums text-bad">{formatNumber(r.short)}</span> : <span className="text-muted">—</span>), csv: () => null },
    { key: "first", label: "First active", sort: sortable, cell: (r) => <span className="whitespace-nowrap text-xs">{r.first_active ? formatDue(r.first_active, now) : "—"}</span>, csv: () => null },
    { key: "orders", label: "Orders", align: "right", sort: sortable, cell: (r) => formatNumber(r.orders), csv: () => null },
    { key: "active", label: "Active units", align: "right", sort: sortable, cell: (r) => formatNumber(r.active), csv: () => null },
  ];

  const cancelColumns: Column<CancelLine>[] = [
    { key: "date", label: "Cancelled", sort: sortable, cell: (c) => <span className="whitespace-nowrap">{c.cancelled_at ? formatDate(todayIST(new Date(c.cancelled_at)), today) : "—"}</span>, csv: () => null },
    { key: "type", label: "By", sort: sortable, cell: (c) => <Chip tone={c.cancel_type === "seller" ? "bad" : "neutral"}>{c.cancel_type === "seller" ? "Seller" : "Buyer"}</Chip>, csv: () => null },
    { key: "sku", label: "SKU", sort: sortable, cell: (c) => skuCell(c.sku), csv: () => null },
    { key: "order", label: "Order ID", sort: sortable, cell: (c) => orderCell(c.order_id), csv: () => null },
    { key: "qty", label: "Qty", align: "right", sort: sortable, cell: (c) => formatNumber(c.quantity), csv: () => null },
    { key: "wh", label: "Warehouse", cell: (c) => nameOf(c.warehouse_id), csv: () => null },
    { key: "reason", label: "Reason", cell: (c) => <span className="text-xs">{[c.cancel_reason, c.cancel_sub_reason].filter(Boolean).join(" · ").replaceAll("_", " ") || "—"}</span>, csv: () => null },
  ];

  const table = <T,>(rows: T[], columns: Column<T>[], rowKey: (r: T) => string) => (
    <div className={loading ? "opacity-60 transition" : "transition"}>
      <DataTable columns={columns} rows={rows} sortKey={query.sort} sortDir={query.dir} onSort={onSort} rowKey={rowKey} />
    </div>
  );

  let body: ReactNode = null;
  if (!ready) {
    body = <SkeletonRows />;
  } else if (data.view === "sku") {
    body = (
      <SkuGroups
        rows={data.rows}
        total={data.total}
        orders={data.orders}
        units={data.units}
        warehouses={warehouses}
        now={now}
        status={query.status}
        warehouseId={query.wh}
        loading={loading}
        onMore={more}
        scope={scope}
        searching={query.q !== ""}
        emptyBody={emptyBody}
      />
    );
  } else {
    const noun = data.view === "pick" ? ["SKU", "SKUs"] : data.view === "upcoming" ? ["SKU at a warehouse", "SKUs at a warehouse"] : data.view === "cancelled" ? ["cancelled line", "cancelled lines"] : ["order line", "order lines"];
    const empty =
      data.view === "pick"
        ? { title: "Nothing to pack", body: query.pickDue === "today" ? "No Active orders due today or late need packing here. Try All active." : "No Active orders need packing at this warehouse." }
        : data.view === "upcoming"
          ? { title: "No upcoming orders", body: "No upcoming orders here, or the nightly read of every upcoming order has not run yet." }
          : data.view === "cancelled"
            ? { title: "No cancellations", body: "No cancelled orders in the last 30 days, or the daily read has not covered them yet." }
            : { title: "No orders here", body: emptyBody };
    body = (
      <>
        <p className="mb-2 text-xs text-muted">
          {formatNumber(data.total)} {data.total === 1 ? noun[0] : noun[1]}
          {data.view === "pick" ? ` · ${formatNumber(data.units)} units to pack at ${nameOf(data.warehouseId)}` : ""}
          {scope && data.view !== "pick" ? ` · ${scope}` : ""}
        </p>
        {data.rows.length === 0 ? (
          <EmptyState title={query.q ? "Nothing matches your search" : empty.title} body={query.q ? "Try a shorter part of the text, or clear the search." : empty.body} />
        ) : data.view === "list" ? (
          table(data.rows, listColumns, (r) => r.order_item_id)
        ) : data.view === "pick" ? (
          table(data.rows, pickColumns, (r) => r.sku)
        ) : data.view === "upcoming" ? (
          table(data.rows, upcomingColumns, (r) => `${r.sku}|${r.warehouse_id}`)
        ) : (
          table(data.rows, cancelColumns, (r) => r.order_item_id)
        )}
        {data.rows.length > 0 && data.rows.length < data.total ? (
          <button type="button" onClick={more} disabled={loading} className="focus-ring mt-2 min-h-11 w-full rounded-lg border border-line bg-surface px-4 text-sm font-bold hover:bg-surface2 disabled:opacity-60">
            {loading ? "Loading…" : `Show ${formatNumber(Math.min(50, data.total - data.rows.length))} more (${formatNumber(data.total - data.rows.length)} not shown; the CSV has all of them)`}
          </button>
        ) : null}
      </>
    );
  }

  const summary = ready && data.view === "cancelled" ? data.summary : null;

  return (
    <>
      <OrdersSyncBar state={state} canSync={canSync} kind={query.status === "upcoming" || query.view === "upcoming" ? "upcoming" : "pending"} today={today} />

      {/* On a phone the warehouses scroll sideways, so the lists start near the top; wider screens get a grid. */}
      <div className="-mx-4 mb-4 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-3">
        {cards.map((w) => {
          const on = query.wh !== "" && query.wh === w.warehouseId;
          const u = urgency(w.nextDue, now);
          return (
            <button
              key={w.warehouseId ?? "unknown"}
              type="button"
              aria-pressed={on}
              disabled={w.warehouseId === null}
              onClick={() => toggleWarehouse(w.warehouseId)}
              className={`focus-ring w-72 min-w-0 shrink-0 snap-start rounded-xl border p-3 text-left transition sm:w-auto ${on ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-accent"}`}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className={`truncate text-sm font-extrabold ${on ? "text-accent-text" : ""}`}>{w.name}</span>
                <span className="shrink-0 text-xs font-semibold text-muted">{formatNumber(w.active)} active</span>
              </span>
              <span className="mt-1.5 grid grid-cols-3 gap-1 text-center">
                {ACTIVE_BUCKETS.map((b) => (
                  <span key={b} className="rounded-lg bg-surface2 px-1 py-1.5">
                    <span className="block text-lg font-extrabold leading-none">{formatNumber(w[b])}</span>
                    <span className="block text-[11px] font-semibold text-muted">{BUCKET_LABEL[b]}</span>
                  </span>
                ))}
              </span>
              <span className="mt-1.5 block text-xs font-semibold text-muted">
                Upcoming {formatNumber(w.upcoming)} · Under Processing {formatNumber(w.processing)} · In Transit {formatNumber(w.inTransit)}
              </span>
              <span className={`mt-1 block text-xs font-semibold ${w.nextDue && isRed(u) ? "text-bad" : "text-muted"}`}>
                {w.nextDue ? `Next dispatch by ${formatDue(w.nextDue, now)}` : "No deadline"}
                {w.late ? ` · ${w.late} late` : ""}
                {w.held ? ` · ${w.held} on hold` : ""}
              </span>
            </button>
          );
        })}
        {cards.length === 0 ? <p className="text-sm text-muted">No warehouse to show.</p> : null}
      </div>

      <div className="mb-3 flex flex-col gap-2">
        <ChipFilter<OrderView>
          label="Orders views"
          value={query.view}
          onChange={setView}
          options={ORDER_VIEWS.map((v) => ({
            key: v,
            label: VIEW_LABEL[v],
            ...(v === "cancelled" && badges.cancelled !== null ? { count: badges.cancelled } : v === "upcoming" && badges.upcoming !== null ? { count: badges.upcoming } : {}),
          }))}
        />
        {showStatus ? (
          <>
            <ChipFilter<StatusFilter>
              label="Seller Hub tabs"
              value={query.status}
              onChange={(status) => patch({ status })}
              options={STATUS_FILTERS.map((s) => ({ key: s, label: s === "active" ? "All active" : BUCKET_LABEL[s], count: statusCount(s) }))}
            />
            <p className="text-xs text-muted">
              In Transit: <span className="font-bold text-ink">{formatNumber(transitCount)}</span> (shipped, not yet delivered){query.wh ? ` at ${nameOf(query.wh)}` : ""}. Counts are orders as Seller Hub counts them (shipments).
            </p>
            {query.status === "processing" ? (
              <p className="rounded-lg bg-info-soft px-3 py-2 text-xs font-semibold text-info">
                Under Processing: Flipkart is working on these orders. Seller Hub says delays here do not affect account health, so they are never shown as late or in Needs action.
              </p>
            ) : null}
            {query.status === "upcoming" ? (
              <p className="rounded-lg bg-info-soft px-3 py-2 text-xs font-semibold text-info">
                Upcoming: dispatch-after is still in the future. Every upcoming order is read each night at 10:30 PM; new ones that come in during the day show up after that read.
              </p>
            ) : null}
          </>
        ) : null}

        {query.view === "pick" ? (
          <>
            <ChipFilter<string>
              label="Warehouse for the pick list"
              value={(ready && data.view === "pick" ? data.warehouseId : query.wh) || ""}
              onChange={(id) => patch({ wh: id })}
              options={warehouses.map((w) => ({ key: w.id, label: w.name }))}
            />
            <ChipFilter<PickDue>
              label="Which orders"
              value={query.pickDue}
              onChange={(pickDue) => patch({ pickDue })}
              options={[
                { key: "today", label: "Due today or late" },
                { key: "all", label: "All active" },
              ]}
            />
            <p className="text-xs text-muted">Units still to pack: To Accept and To Pack orders (To Dispatch is packed already). Orders on hold are left out. Red stock is less than the units to pack.</p>
          </>
        ) : null}

        {query.view === "upcoming" ? (
          <>
            <ChipFilter<"short" | "all">
              label="Which SKUs"
              value={query.shortOnly ? "short" : "all"}
              onChange={(k) => patch({ shortOnly: k === "short" })}
              options={[
                { key: "all", label: "All upcoming" },
                { key: "short", label: "Short of stock", ...(badges.upcoming !== null ? { count: badges.upcoming } : {}) },
              ]}
            />
            <p className="text-xs text-muted">Upcoming units (dispatch-after still in the future) against the stock there now. Short by = upcoming units minus stock. Active units are shown for context.</p>
          </>
        ) : null}

        {query.view === "cancelled" ? (
          <ChipFilter<CancelType>
            label="Who cancelled"
            value={query.cancelType}
            onChange={(cancelType) => patch({ cancelType })}
            options={[
              { key: "all", label: "All", ...(summary ? { count: summary.seller_total + summary.buyer_total } : {}) },
              { key: "seller", label: "Seller cancelled", ...(summary ? { count: summary.seller_total } : {}) },
              { key: "buyer", label: "Buyer cancelled", ...(summary ? { count: summary.buyer_total } : {}) },
            ]}
          />
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
            <label htmlFor="orders-search" className="sr-only">
              Search
            </label>
            <input
              id="orders-search"
              type="search"
              className="input pl-10"
              placeholder={query.view === "sku" ? "Search SKU, title or order ID" : query.view === "cancelled" ? "Search order ID, SKU or reason" : query.view === "list" ? "Search order ID or SKU" : "Search SKU or title"}
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              autoComplete="off"
            />
          </div>
          {query.view === "sku" ? (
            <>
              <label htmlFor="orders-sku-sort" className="sr-only">
                Sort by
              </label>
              <select
                id="orders-sku-sort"
                className="input w-auto min-w-0"
                value={`${query.sort}|${query.dir}`}
                onChange={(e) => {
                  const [sort, dir] = e.target.value.split("|");
                  patch({ sort, dir: dir === "desc" ? "desc" : "asc" });
                }}
              >
                {SKU_SORTS.map((s) => (
                  <option key={s.key} value={`${s.key}|${s.dir}`}>
                    {s.label}
                  </option>
                ))}
              </select>
            </>
          ) : null}
          <a
            href={exportHref(query)}
            download
            className="focus-ring inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-bold hover:bg-surface2"
          >
            Download CSV
          </a>
        </div>
        {failed ? (
          <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm font-semibold text-bad">
            Could not load this list. Check your connection and try again.
          </p>
        ) : null}
      </div>

      {summary ? (
        <div className="mb-3 overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-max border-collapse text-sm">
            <caption className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-muted">Cancellations per day</caption>
            <thead>
              <tr className="border-y border-line bg-surface2 text-xs uppercase tracking-wide text-muted">
                <th scope="col" className="px-3 py-2 text-left">Day</th>
                <th scope="col" className="px-3 py-2 text-right">Seller</th>
                <th scope="col" className="px-3 py-2 text-right">Buyer</th>
              </tr>
            </thead>
            <tbody>
              {summary.days.map((d) => (
                <tr key={d.day} className="border-b border-line last:border-b-0">
                  <td className="px-3 py-1.5">{formatDate(d.day, today)}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${d.seller ? "font-bold text-bad" : "text-muted"}`}>{d.seller}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted">{d.buyer}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {body}
    </>
  );
}

