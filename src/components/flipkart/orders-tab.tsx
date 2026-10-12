"use client";

import { useEffect, useMemo, useState } from "react";
import type { Column } from "@/components/stock/data-table";
import { ChipFilter, ListView } from "@/components/flipkart/list-view";
import { OrdersSyncBar } from "@/components/flipkart/orders-sync-bar";
import { BUCKET_TONE, SkuGroups } from "@/components/flipkart/sku-groups";
import { Chip } from "@/components/ui";
import { formatDate, formatNumber, todayIST, addDays } from "@/lib/format";
import {
  ACTIVE_BUCKETS,
  BUCKET_LABEL,
  bucketOf,
  formatDue,
  isActiveBucket,
  isRed,
  ORDER_VIEWS,
  ordersByWarehouse,
  pickList,
  shipmentKey,
  skuGroups,
  STATUS_FILTERS,
  upcomingVsStock,
  urgency,
  type OrderView,
  type PendingOrder,
  type PickRow,
  type StatusFilter,
  type StockBySku,
  type UpcomingRow,
} from "@/lib/flipkart-analysis";
import type { OrderSyncState } from "@/lib/orders-sync";
import type { CancelRow } from "@/server/flipkart-data";

type CancelFilter = "all" | "seller" | "buyer";
type PickDue = "today" | "all";

type Props = {
  orders: PendingOrder[];
  cancellations: CancelRow[];
  warehouses: { id: string; name: string }[];
  state: OrderSyncState;
  canSync: boolean;
  today: string;
  /** The moment the page was made, so server and browser agree on what is late. */
  nowIso: string;
  /** Title and units per warehouse for each SKU, from the latest stock sync. */
  stock: StockBySku;
  /** Shipped and not delivered, per warehouse ID. */
  inTransit: Record<string, number>;
  initial: { warehouseId: string; view: OrderView; status: StatusFilter };
};

const VIEW_LABEL: Record<OrderView, string> = {
  sku: "By SKU",
  list: "Order list",
  pick: "Pick list",
  upcoming: "Upcoming vs stock",
  cancelled: "Cancelled (30 days)",
};

export function OrdersTab({ orders, cancellations, warehouses, state, canSync, today, nowIso, stock, inTransit, initial }: Props) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const [view, setView] = useState<OrderView>(initial.view);
  const [status, setStatus] = useState<StatusFilter>(initial.status);
  const [warehouseId, setWarehouseId] = useState(initial.warehouseId);
  const [cancelFilter, setCancelFilter] = useState<CancelFilter>("all");
  const [pickDue, setPickDue] = useState<PickDue>("today");
  const [shortOnly, setShortOnly] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams({ tab: "orders" });
    if (view !== "sku") params.set("view", view);
    if (status !== "active") params.set("status", status);
    if (warehouseId) params.set("wh", warehouseId);
    window.history.replaceState(null, "", `?${params.toString()}`);
  }, [view, status, warehouseId]);

  const nameOf = (id: string | null) => warehouses.find((w) => w.id === id)?.name ?? "Unknown";
  const cards = useMemo(() => ordersByWarehouse(orders, warehouses, now, inTransit), [orders, warehouses, now, inTransit]);
  const inScope = <T extends { warehouseId: string | null }>(rows: T[]) => (warehouseId ? rows.filter((r) => r.warehouseId === warehouseId) : rows);
  const scopedOrders = useMemo(() => inScope(orders), [orders, warehouseId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Counts for the status chips, in shipments, for the warehouse in view.
  const counts = useMemo(() => {
    const keys = new Map<StatusFilter, Set<string>>(STATUS_FILTERS.map((s) => [s, new Set<string>()]));
    for (const o of scopedOrders) {
      const b = bucketOf(o, now);
      if (!b) continue;
      const k = `${o.warehouseId}|${shipmentKey(o)}`;
      keys.get(b)?.add(k);
      if (isActiveBucket(b)) keys.get("active")?.add(k);
    }
    return Object.fromEntries([...keys].map(([s, set]) => [s, set.size])) as Record<StatusFilter, number>;
  }, [scopedOrders, now]);
  const transitCount = warehouseId ? inTransit[warehouseId] ?? 0 : Object.values(inTransit).reduce((n, v) => n + v, 0);

  const inStatus = useMemo(
    () =>
      scopedOrders.filter((o) => {
        const b = bucketOf(o, now);
        return status === "active" ? isActiveBucket(b) : b === status;
      }),
    [scopedOrders, status, now],
  );
  const groups = useMemo(() => skuGroups(inStatus, now), [inStatus, now]);

  // The pick list is for one warehouse: the one chosen, or else the first with Active orders.
  const pickWarehouse = warehouseId || cards.find((c) => c.warehouseId && c.to_accept + c.to_pack > 0)?.warehouseId || warehouses[0]?.id || "";
  const pickRows = useMemo(() => (pickWarehouse ? pickList(orders, pickWarehouse, now, stock, pickDue === "today" ? todayIST(now) : null) : []), [orders, pickWarehouse, now, stock, pickDue]);
  const upcomingRows = useMemo(() => inScope(upcomingVsStock(orders, now, stock)).filter((r) => !shortOnly || r.short > 0), [orders, now, stock, warehouseId, shortOnly]); // eslint-disable-line react-hooks/exhaustive-deps
  const shortCount = useMemo(() => inScope(upcomingVsStock(orders, now, stock)).filter((r) => r.short > 0).length, [orders, now, stock, warehouseId]); // eslint-disable-line react-hooks/exhaustive-deps

  const cancelled = inScope(cancellations).filter((c) => cancelFilter === "all" || c.type === cancelFilter);
  const scope = warehouseId ? `${nameOf(warehouseId)} only (tap the warehouse again to see all)` : undefined;
  const toggleWarehouse = (id: string | null) => setWarehouseId((current) => (id === null || current === id ? "" : id));

  const listColumns: Column<PendingOrder>[] = [
    {
      key: "due",
      label: "Dispatch by",
      sort: (o) => o.dispatchBy,
      cell: (o) => {
        const u = urgency(o.dispatchBy, now);
        const counts = !o.hold && isActiveBucket(bucketOf(o, now));
        return (
          <div className="flex flex-col items-start gap-1">
            <span className={`whitespace-nowrap font-semibold ${counts && isRed(u) ? "text-bad" : ""}`}>{o.dispatchBy ? formatDue(o.dispatchBy, now) : "—"}</span>
            {o.hold ? <Chip tone="neutral">On hold</Chip> : counts && u === "late" ? <Chip tone="bad">Late</Chip> : counts && u === "today" ? <Chip tone="bad">Today</Chip> : null}
          </div>
        );
      },
      csv: (o) => o.dispatchBy,
    },
    { key: "order", label: "Order ID", sort: (o) => o.orderId, cell: (o) => <span className="break-all font-mono text-xs">{o.orderId}</span>, csv: (o) => o.orderId },
    { key: "sku", label: "SKU", sort: (o) => o.sku, cell: (o) => <span className="break-all font-mono text-[13px] font-bold">{o.sku ?? "—"}</span>, csv: (o) => o.sku },
    { key: "title", label: "Title", csvOnly: true, cell: () => null, csv: (o) => (o.sku ? stock[o.sku]?.title ?? null : null) },
    { key: "qty", label: "Qty", align: "right", sort: (o) => o.quantity, cell: (o) => formatNumber(o.quantity), csv: (o) => o.quantity },
    { key: "wh", label: "Warehouse", sort: (o) => nameOf(o.warehouseId), cell: (o) => nameOf(o.warehouseId), csv: (o) => nameOf(o.warehouseId) },
    {
      key: "status",
      label: "Status",
      sort: (o) => {
        const b = bucketOf(o, now);
        return b ? BUCKET_LABEL[b] : null;
      },
      cell: (o) => {
        const b = bucketOf(o, now);
        return b ? <Chip tone={BUCKET_TONE[b]}>{BUCKET_LABEL[b]}</Chip> : <Chip>{o.status ?? "—"}</Chip>;
      },
      csv: (o) => {
        const b = bucketOf(o, now);
        return b ? BUCKET_LABEL[b] : o.status;
      },
    },
    { key: "after", label: "Active from", sort: (o) => o.dispatchAfter, cell: (o) => <span className="whitespace-nowrap text-xs">{o.dispatchAfter ? formatDue(o.dispatchAfter, now) : "—"}</span>, csv: (o) => o.dispatchAfter },
  ];

  const skuCell = (sku: string | null, title: string | null, extra?: string) => (
    <div className="max-w-36 sm:max-w-60">
      <span className="block break-all font-mono text-[13px] font-bold">{sku ?? "—"}</span>
      {title ? <span className="block truncate text-xs text-muted">{title}</span> : null}
      {extra ? <span className="block text-xs font-semibold">{extra}</span> : null}
    </div>
  );

  const pickColumns: Column<PickRow>[] = [
    { key: "sku", label: "SKU", sort: (r) => r.sku, cell: (r) => skuCell(r.sku, r.title), csv: (r) => r.sku },
    { key: "title", label: "Title", csvOnly: true, cell: () => null, csv: (r) => r.title },
    { key: "units", label: "Units", align: "right", sort: (r) => r.units, cell: (r) => <span className="text-base font-extrabold tabular-nums">{formatNumber(r.units)}</span>, csv: (r) => r.units },
    {
      key: "stock",
      label: "Stock",
      align: "right",
      sort: (r) => r.stock,
      cell: (r) =>
        r.stock === null ? (
          <span className="text-xs text-muted">not listed</span>
        ) : (
          <span className={`tabular-nums ${r.stock < r.units ? "font-bold text-bad" : ""}`}>
            {formatNumber(r.stock)}
            {r.stock < r.units ? <span className="block whitespace-nowrap text-[11px]">short by {formatNumber(r.units - r.stock)}</span> : null}
          </span>
        ),
      csv: (r) => r.stock,
    },
    { key: "due", label: "Dispatch by", sort: (r) => r.earliestDue, cell: (r) => <span className={`whitespace-nowrap text-xs font-semibold ${isRed(urgency(r.earliestDue, now)) ? "text-bad" : ""}`}>{r.earliestDue ? formatDue(r.earliestDue, now) : "—"}</span>, csv: (r) => r.earliestDue },
    { key: "orders", label: "Orders", align: "right", sort: (r) => r.orders, cell: (r) => formatNumber(r.orders), csv: (r) => r.orders },
    { key: "accept", label: "To Accept", align: "right", sort: (r) => r.toAccept, cell: (r) => formatNumber(r.toAccept), csv: (r) => r.toAccept },
    { key: "pack", label: "To Pack", align: "right", sort: (r) => r.toPack, cell: (r) => formatNumber(r.toPack), csv: (r) => r.toPack },
  ];

  const upcomingColumns: Column<UpcomingRow>[] = [
    { key: "sku", label: "SKU", sort: (r) => r.sku, cell: (r) => skuCell(r.sku, r.title, nameOf(r.warehouseId)), csv: (r) => r.sku },
    { key: "title", label: "Title", csvOnly: true, cell: () => null, csv: (r) => r.title },
    { key: "wh", label: "Warehouse", csvOnly: true, cell: () => null, csv: (r) => nameOf(r.warehouseId) },
    { key: "upcoming", label: "Upcoming units", align: "right", sort: (r) => r.upcoming, cell: (r) => <span className="font-bold tabular-nums">{formatNumber(r.upcoming)}</span>, csv: (r) => r.upcoming },
    {
      key: "stock",
      label: "Stock",
      align: "right",
      sort: (r) => r.stock,
      cell: (r) => (r.stock === null ? <span className="text-xs text-muted">not listed</span> : <span className="tabular-nums">{formatNumber(r.stock)}</span>),
      csv: (r) => r.stock,
    },
    { key: "short", label: "Short by", align: "right", sort: (r) => r.short, cell: (r) => (r.short > 0 ? <span className="font-bold tabular-nums text-bad">{formatNumber(r.short)}</span> : <span className="text-muted">—</span>), csv: (r) => r.short },
    { key: "first", label: "First active", sort: (r) => r.firstActive, cell: (r) => <span className="whitespace-nowrap text-xs">{r.firstActive ? formatDue(r.firstActive, now) : "—"}</span>, csv: (r) => r.firstActive },
    { key: "orders", label: "Orders", align: "right", sort: (r) => r.orders, cell: (r) => formatNumber(r.orders), csv: (r) => r.orders },
    { key: "active", label: "Active units", align: "right", sort: (r) => r.active, cell: (r) => formatNumber(r.active), csv: (r) => r.active },
  ];

  const cancelColumns: Column<CancelRow>[] = [
    { key: "date", label: "Cancelled", sort: (c) => c.cancelledAt, cell: (c) => <span className="whitespace-nowrap">{c.cancelledAt ? formatDate(todayIST(new Date(c.cancelledAt)), today) : "—"}</span>, csv: (c) => c.cancelledAt },
    { key: "type", label: "By", sort: (c) => c.type, cell: (c) => <Chip tone={c.type === "seller" ? "bad" : "neutral"}>{c.type === "seller" ? "Seller" : "Buyer"}</Chip>, csv: (c) => c.type },
    { key: "sku", label: "SKU", sort: (c) => c.sku, cell: (c) => <span className="break-all font-mono text-[13px] font-bold">{c.sku ?? "—"}</span>, csv: (c) => c.sku },
    { key: "order", label: "Order ID", sort: (c) => c.orderId, cell: (c) => <span className="break-all font-mono text-xs">{c.orderId}</span>, csv: (c) => c.orderId },
    { key: "qty", label: "Qty", align: "right", sort: (c) => c.quantity, cell: (c) => formatNumber(c.quantity), csv: (c) => c.quantity },
    { key: "wh", label: "Warehouse", sort: (c) => nameOf(c.warehouseId), cell: (c) => nameOf(c.warehouseId), csv: (c) => nameOf(c.warehouseId) },
    { key: "reason", label: "Reason", cell: (c) => <span className="text-xs">{[c.reason, c.subReason].filter(Boolean).join(" · ").replaceAll("_", " ") || "—"}</span>, csv: (c) => [c.reason, c.subReason].filter(Boolean).join(" / ") },
  ];

  // Cancellations per day for the last 14 days, seller and buyer apart.
  const perDay = useMemo(() => {
    const days = Array.from({ length: 14 }, (_, i) => addDays(today, -i));
    const tally = new Map(days.map((d) => [d, { seller: 0, buyer: 0 }]));
    for (const c of inScope(cancellations)) {
      if (!c.cancelledAt) continue;
      const row = tally.get(todayIST(new Date(c.cancelledAt)));
      if (row) row[c.type] += 1;
    }
    return days.map((d) => ({ day: d, ...(tally.get(d) as { seller: number; buyer: number }) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancellations, warehouseId, today]);

  const sellerTotal = cancellations.filter((c) => c.type === "seller").length;
  const buyerTotal = cancellations.filter((c) => c.type === "buyer").length;
  const showStatus = view === "sku" || view === "list";
  const emptyBody =
    status === "upcoming"
      ? "No upcoming orders, or the nightly read of every upcoming order has not run yet."
      : status === "processing"
        ? "Flipkart is not working on any order at the moment."
        : "Nothing is waiting here at the moment, or the first read from Flipkart has not finished.";

  return (
    <>
      <OrdersSyncBar state={state} canSync={canSync} kind={status === "upcoming" || view === "upcoming" ? "upcoming" : "pending"} today={today} />

      {/* On a phone the warehouses scroll sideways, so the lists start near the top; wider screens get a grid. */}
      <div className="-mx-4 mb-4 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-3">
        {cards.map((w) => {
          const on = warehouseId !== "" && warehouseId === w.warehouseId;
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
          value={view}
          onChange={setView}
          options={ORDER_VIEWS.map((v) => ({ key: v, label: VIEW_LABEL[v], ...(v === "cancelled" ? { count: sellerTotal + buyerTotal } : v === "upcoming" ? { count: shortCount } : {}) }))}
        />
        {showStatus ? (
          <>
            <ChipFilter<StatusFilter>
              label="Seller Hub tabs"
              value={status}
              onChange={setStatus}
              options={STATUS_FILTERS.map((s) => ({ key: s, label: s === "active" ? "All active" : BUCKET_LABEL[s], count: counts[s] }))}
            />
            <p className="text-xs text-muted">
              In Transit: <span className="font-bold text-ink">{formatNumber(transitCount)}</span> (shipped, not yet delivered){warehouseId ? ` at ${nameOf(warehouseId)}` : ""}. Counts are orders as Seller Hub counts them (shipments).
            </p>
            {status === "processing" ? (
              <p className="rounded-lg bg-info-soft px-3 py-2 text-xs font-semibold text-info">
                Under Processing: Flipkart is working on these orders. Seller Hub says delays here do not affect account health, so they are never shown as late or in Needs action.
              </p>
            ) : null}
            {status === "upcoming" ? (
              <p className="rounded-lg bg-info-soft px-3 py-2 text-xs font-semibold text-info">
                Upcoming: dispatch-after is still in the future. Every upcoming order is read each night at 10:30 PM; new ones that come in during the day show up after that read.
              </p>
            ) : null}
          </>
        ) : null}
      </div>

      {view === "sku" ? <SkuGroups groups={groups} warehouses={warehouses} stock={stock} now={now} scope={scope} emptyBody={emptyBody} /> : null}

      {view === "list" ? (
        <ListView
          key={`list-${status}`}
          rows={inStatus}
          columns={listColumns}
          rowKey={(o) => o.orderItemId}
          defaultSort={{ key: "due", dir: "asc" }}
          textKeys={["order", "sku", "wh", "status"]}
          searchText={(o) => `${o.orderId} ${o.sku ?? ""}`}
          searchLabel="Search order ID or SKU"
          csvName="vrprime-orders.csv"
          noun={["order line", "order lines"]}
          scope={scope}
          emptyTitle="No orders here"
          emptyBody={emptyBody}
          note={<p className="text-xs text-muted">Red means an Active order is due today or late. Orders on hold, Upcoming and Under Processing are never counted as late.</p>}
        />
      ) : null}

      {view === "pick" ? (
        <ListView
          key={`pick-${pickWarehouse}-${pickDue}`}
          rows={pickRows}
          columns={pickColumns}
          rowKey={(r) => r.sku ?? ""}
          defaultSort={{ key: "units", dir: "desc" }}
          textKeys={["sku", "due"]}
          searchText={(r) => `${r.sku ?? ""} ${r.title ?? ""}`}
          searchLabel="Search SKU or title"
          csvName={`vrprime-pick-list-${nameOf(pickWarehouse).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${today}.csv`}
          noun={["SKU", "SKUs"]}
          scope={`${formatNumber(pickRows.reduce((n, r) => n + r.units, 0))} units to pack at ${nameOf(pickWarehouse)}`}
          controls={
            <>
              <ChipFilter<string>
                label="Warehouse for the pick list"
                value={pickWarehouse}
                onChange={(id) => setWarehouseId(id)}
                options={warehouses.map((w) => ({ key: w.id, label: w.name }))}
              />
              <ChipFilter<PickDue>
                label="Which orders"
                value={pickDue}
                onChange={setPickDue}
                options={[
                  { key: "today", label: "Due today or late" },
                  { key: "all", label: "All active" },
                ]}
              />
            </>
          }
          note={<p className="text-xs text-muted">Units still to pack: To Accept and To Pack orders (To Dispatch is packed already). Orders on hold are left out. Red stock is less than the units to pack.</p>}
          emptyTitle="Nothing to pack"
          emptyBody={pickDue === "today" ? "No Active orders due today or late need packing here. Try All active." : "No Active orders need packing at this warehouse."}
        />
      ) : null}

      {view === "upcoming" ? (
        <ListView
          key={`upcoming-${shortOnly}`}
          rows={upcomingRows}
          columns={upcomingColumns}
          rowKey={(r) => `${r.sku ?? ""}|${r.warehouseId}`}
          defaultSort={{ key: "short", dir: "desc" }}
          textKeys={["sku", "first"]}
          searchText={(r) => `${r.sku ?? ""} ${r.title ?? ""} ${nameOf(r.warehouseId)}`}
          searchLabel="Search SKU, title or warehouse"
          csvName="vrprime-upcoming-vs-stock.csv"
          noun={["SKU at a warehouse", "SKUs at a warehouse"]}
          scope={scope}
          controls={
            <ChipFilter<"short" | "all">
              label="Which SKUs"
              value={shortOnly ? "short" : "all"}
              onChange={(k) => setShortOnly(k === "short")}
              options={[
                { key: "all", label: "All upcoming" },
                { key: "short", label: "Short of stock", count: shortCount },
              ]}
            />
          }
          note={<p className="text-xs text-muted">Upcoming units (dispatch-after still in the future) against the stock there now. Short by = upcoming units minus stock. Active units are shown for context.</p>}
          emptyTitle="No upcoming orders"
          emptyBody="No upcoming orders here, or the nightly read of every upcoming order has not run yet."
        />
      ) : null}

      {view === "cancelled" ? (
        <>
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
                {perDay.map((d) => (
                  <tr key={d.day} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-1.5">{formatDate(d.day, today)}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${d.seller ? "font-bold text-bad" : "text-muted"}`}>{d.seller}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted">{d.buyer}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ListView
            key="cancelled"
            rows={cancelled}
            columns={cancelColumns}
            rowKey={(c) => c.orderItemId}
            defaultSort={{ key: "date", dir: "desc" }}
            textKeys={["type", "sku", "order", "wh"]}
            searchText={(c) => `${c.orderId} ${c.sku ?? ""} ${c.reason ?? ""}`}
            searchLabel="Search order ID, SKU or reason"
            csvName="vrprime-cancellations.csv"
            noun={["cancelled line", "cancelled lines"]}
            scope={scope}
            controls={
              <ChipFilter<CancelFilter>
                label="Who cancelled"
                value={cancelFilter}
                onChange={setCancelFilter}
                options={[
                  { key: "all", label: "All", count: sellerTotal + buyerTotal },
                  { key: "seller", label: "Seller cancelled", count: sellerTotal },
                  { key: "buyer", label: "Buyer cancelled", count: buyerTotal },
                ]}
              />
            }
            emptyTitle="No cancellations"
            emptyBody="No cancelled orders in the last 30 days, or the daily read has not covered them yet."
          />
        </>
      ) : null}
    </>
  );
}
