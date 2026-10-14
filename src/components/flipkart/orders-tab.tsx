"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Caption, CsvButton, Dropdown, InfoTip, SearchField, Segmented, Toolbar } from "@/components/flipkart/kit";
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
  STATUS_FILTERS,
  type CancelLine,
  type CancelType,
  type OrderLine,
  type OrdersQuery,
  type OrdersViewResult,
  type OrderView,
  type StatusFilter,
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

/**
 * The views on the page. (The Pick list and Upcoming vs stock views were taken off the page; the server still knows
 * them, but nothing here opens them, and an old address that asks for one lands on By SKU.)
 */
export const SHOWN_VIEWS = ["sku", "list", "cancelled"] as const;
const VIEW_LABEL: Record<(typeof SHOWN_VIEWS)[number], string> = {
  sku: "By SKU",
  list: "Order list",
  cancelled: "Cancelled",
};

const SKU_SORTS: { key: string; dir: "asc" | "desc"; label: string }[] = [
  { key: "orders", dir: "desc", label: "Most orders" },
  { key: "units", dir: "desc", label: "Most units" },
  { key: "due", dir: "asc", label: "Earliest dispatch-by" },
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
  // The number shown on the Cancelled view, kept from the last time it was loaded.
  const [cancelledCount, setCancelledCount] = useState<number | null>(
    initialData.view === "cancelled" ? initialData.summary.seller_total + initialData.summary.buyer_total : null,
  );

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
      if (next.view === "cancelled" && q.offset === 0) setCancelledCount(next.summary.seller_total + next.summary.buyer_total);
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
  } else if (data.view === "list" || data.view === "cancelled") {
    const isCancel = data.view === "cancelled";
    const noun = isCancel ? ["cancelled line", "cancelled lines"] : ["order line", "order lines"];
    const empty = isCancel
      ? { title: "No cancellations", body: "No cancelled orders in the last 30 days, or the daily read has not covered them yet." }
      : { title: "No orders here", body: emptyBody };
    body = (
      <>
        <Caption>
          {formatNumber(data.total)} {data.total === 1 ? noun[0] : noun[1]}
          {scope ? ` · ${scope}` : ""}
        </Caption>
        {data.rows.length === 0 ? (
          <EmptyState title={query.q ? "Nothing matches your search" : empty.title} body={query.q ? "Try a shorter part of the text, or clear the search." : empty.body} />
        ) : data.view === "list" ? (
          table(data.rows, listColumns, (r) => r.order_item_id)
        ) : (
          table(data.rows, cancelColumns, (r) => r.order_item_id)
        )}
        {data.rows.length > 0 && data.rows.length < data.total ? (
          <button type="button" onClick={more} disabled={loading} className="focus-ring mt-2 min-h-11 w-full rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-surface2 disabled:opacity-60">
            {loading ? "Loading…" : `Show ${formatNumber(Math.min(50, data.total - data.rows.length))} more (${formatNumber(data.total - data.rows.length)} not shown; the CSV has all of them)`}
          </button>
        ) : null}
      </>
    );
  }

  const summary = ready && data.view === "cancelled" ? data.summary : null;
  const shownView = (SHOWN_VIEWS as readonly string[]).includes(query.view) ? (query.view as (typeof SHOWN_VIEWS)[number]) : "sku";

  return (
    <>
      <OrdersSyncBar state={state} canSync={canSync} kind={query.status === "upcoming" ? "upcoming" : "pending"} today={today} />

      {/* One tidy grid of warehouses: three counts you act on, the rest muted, and the next deadline as a chip. */}
      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((w) => {
          const on = query.wh !== "" && query.wh === w.warehouseId;
          const u = urgency(w.nextDue, now);
          const red = w.late > 0 || (Boolean(w.nextDue) && isRed(u));
          return (
            <button
              key={w.warehouseId ?? "unknown"}
              type="button"
              aria-pressed={on}
              disabled={w.warehouseId === null}
              onClick={() => toggleWarehouse(w.warehouseId)}
              className={`focus-ring min-w-0 rounded-xl border p-3 text-left transition ${on ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-ink/30"}`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-extrabold">{w.name}</span>
                <span
                  className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${
                    red ? "bg-bad-soft text-bad" : "bg-surface2 text-muted"
                  }`}
                >
                  {w.nextDue ? (w.late ? `${formatNumber(w.late)} late` : formatDue(w.nextDue, now)) : "No deadline"}
                </span>
              </span>
              <span className="mt-2 grid grid-cols-3 divide-x divide-line text-center">
                {ACTIVE_BUCKETS.map((b) => (
                  <span key={b} className="px-1">
                    <span className="block font-mono text-lg font-bold leading-none tabular-nums">{formatNumber(w[b])}</span>
                    <span className="mt-1 block text-[11px] font-semibold text-muted">{BUCKET_LABEL[b]}</span>
                  </span>
                ))}
              </span>
              <span className="mt-2 block text-[11px] text-muted">
                Upcoming {formatNumber(w.upcoming)} · Processing {formatNumber(w.processing)} · In transit {formatNumber(w.inTransit)}
                {w.held ? ` · ${w.held} on hold` : ""}
              </span>
            </button>
          );
        })}
        {cards.length === 0 ? <p className="text-sm text-muted">No warehouse to show.</p> : null}
      </div>

      <Toolbar>
        <Segmented<(typeof SHOWN_VIEWS)[number]>
          label="Orders views"
          value={shownView}
          onChange={setView}
          options={SHOWN_VIEWS.map((v) => ({ key: v, label: VIEW_LABEL[v], ...(v === "cancelled" && cancelledCount !== null ? { count: cancelledCount } : {}) }))}
        />
        {showStatus ? (
          <Dropdown
            label="Show"
            value={query.status}
            onChange={(status) => patch({ status: status as StatusFilter })}
            options={STATUS_FILTERS.map((st) => ({ value: st, label: `${st === "active" ? "All active" : BUCKET_LABEL[st]} (${formatNumber(statusCount(st))})` }))}
          />
        ) : null}
        {query.view === "cancelled" ? (
          <Dropdown
            label="By"
            value={query.cancelType}
            onChange={(cancelType) => patch({ cancelType: cancelType as CancelType })}
            options={[
              { value: "all", label: `All${summary ? ` (${formatNumber(summary.seller_total + summary.buyer_total)})` : ""}` },
              { value: "seller", label: `Seller${summary ? ` (${formatNumber(summary.seller_total)})` : ""}` },
              { value: "buyer", label: `Buyer${summary ? ` (${formatNumber(summary.buyer_total)})` : ""}` },
            ]}
          />
        ) : null}
        {warehouses.length > 1 ? (
          <Dropdown label="Warehouse" value={query.wh} onChange={(wh) => patch({ wh })} options={[{ value: "", label: "All" }, ...warehouses.map((w) => ({ value: w.id, label: w.name }))]} />
        ) : null}
        {query.view === "sku" ? (
          <Dropdown
            label="Sort"
            value={`${query.sort}|${query.dir}`}
            onChange={(v) => {
              const [sort, dir] = v.split("|");
              patch({ sort, dir: dir === "desc" ? "desc" : "asc" });
            }}
            options={SKU_SORTS.map((o) => ({ value: `${o.key}|${o.dir}`, label: o.label }))}
          />
        ) : null}
        <SearchField
          value={qInput}
          onChange={setQInput}
          placeholder={query.view === "sku" ? "Search SKU, title or order ID" : query.view === "cancelled" ? "Search order ID, SKU or reason" : "Search order ID or SKU"}
        />
        <CsvButton href={exportHref(query)} />
        <InfoTip>
          <p>
            Counts are orders as Seller Hub counts them (shipments). In Transit: <b>{formatNumber(transitCount)}</b> (shipped, not yet delivered){query.wh ? ` at ${nameOf(query.wh)}` : ""}. Tap a warehouse above to look at it alone.
          </p>
          <p className="mt-2">Tap a SKU to see its orders and the stock at each warehouse. Red dates are due today or late.</p>
          <p className="mt-2">
            <b>Under Processing:</b> Flipkart is working on these. Delays here do not affect account health, so they are never shown as late or in Needs action.
          </p>
          <p className="mt-2">
            <b>Upcoming:</b> dispatch-after is still in the future. Every upcoming order is read each night at 10:30 PM; new ones that come in during the day show up after that read.
          </p>
        </InfoTip>
      </Toolbar>
      {failed ? (
        <p role="alert" className="mb-3 rounded-lg bg-bad-soft px-3 py-2 text-sm font-semibold text-bad">
          Could not load this list. Check your connection and try again.
        </p>
      ) : null}

      {summary ? (
        <div className="mb-4 overflow-x-auto sp-card">
          <table className="w-full border-collapse text-sm">
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
                  <td className={`px-3 py-1.5 text-right font-mono tabular-nums ${d.seller ? "font-bold text-bad" : "text-muted"}`}>{d.seller}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-muted">{d.buyer}</td>
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
