"use client";

import { useEffect, useMemo, useState } from "react";
import type { Column } from "@/components/stock/data-table";
import { ChipFilter, ListView } from "@/components/flipkart/list-view";
import { OrdersSyncBar } from "@/components/flipkart/orders-sync-bar";
import { Chip } from "@/components/ui";
import { formatDate, formatNumber, todayIST, addDays } from "@/lib/format";
import { formatDue, isRed, ordersByWarehouse, statusGroup, STATUS_GROUP_LABEL, urgency, type PendingOrder } from "@/lib/flipkart-analysis";
import type { OrderSyncState } from "@/lib/orders-sync";
import type { CancelRow } from "@/server/flipkart-data";

type View = "pending" | "cancelled";
type CancelFilter = "all" | "seller" | "buyer";

type Props = {
  orders: PendingOrder[];
  cancellations: CancelRow[];
  warehouses: { id: string; name: string }[];
  state: OrderSyncState;
  canSync: boolean;
  today: string;
  /** The moment the page was made, so server and browser agree on what is late. */
  nowIso: string;
  initial: { warehouseId: string; view: View };
};

const STATUS_TONE = { new: "info", packed: "accent", ready: "ok", other: "neutral" } as const;

export function OrdersTab({ orders, cancellations, warehouses, state, canSync, today, nowIso, initial }: Props) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const [view, setView] = useState<View>(initial.view);
  const [warehouseId, setWarehouseId] = useState(initial.warehouseId);
  const [cancelFilter, setCancelFilter] = useState<CancelFilter>("all");

  useEffect(() => {
    const params = new URLSearchParams({ tab: "orders" });
    if (view !== "pending") params.set("view", view);
    if (warehouseId) params.set("wh", warehouseId);
    window.history.replaceState(null, "", `?${params.toString()}`);
  }, [view, warehouseId]);

  const nameOf = (id: string | null) => warehouses.find((w) => w.id === id)?.name ?? "Unknown";
  const cards = useMemo(() => ordersByWarehouse(orders, warehouses, now), [orders, warehouses, now]);
  const inScope = <T extends { warehouseId: string | null }>(rows: T[]) => (warehouseId ? rows.filter((r) => r.warehouseId === warehouseId) : rows);
  const pending = inScope(orders);
  const cancelled = inScope(cancellations).filter((c) => cancelFilter === "all" || c.type === cancelFilter);
  const scope = warehouseId ? `${nameOf(warehouseId)} only (tap the warehouse again to see all)` : undefined;

  const pendingColumns: Column<PendingOrder>[] = [
    {
      key: "due",
      label: "Dispatch by",
      sort: (o) => o.dispatchBy,
      cell: (o) => {
        const u = urgency(o.dispatchBy, now);
        return (
          <div className="flex flex-col items-start gap-1">
            <span className={`whitespace-nowrap font-semibold ${!o.hold && isRed(u) ? "text-bad" : ""}`}>{o.dispatchBy ? formatDue(o.dispatchBy, now) : "—"}</span>
            {o.hold ? <Chip tone="neutral">On hold</Chip> : u === "late" ? <Chip tone="bad">Late</Chip> : u === "today" ? <Chip tone="bad">Today</Chip> : null}
          </div>
        );
      },
      csv: (o) => o.dispatchBy,
    },
    { key: "order", label: "Order ID", sort: (o) => o.orderId, cell: (o) => <span className="break-all font-mono text-xs">{o.orderId}</span>, csv: (o) => o.orderId },
    { key: "sku", label: "SKU", sort: (o) => o.sku, cell: (o) => <span className="break-all font-mono text-[13px] font-bold">{o.sku ?? "—"}</span>, csv: (o) => o.sku },
    { key: "qty", label: "Qty", align: "right", sort: (o) => o.quantity, cell: (o) => formatNumber(o.quantity), csv: (o) => o.quantity },
    { key: "wh", label: "Warehouse", sort: (o) => nameOf(o.warehouseId), cell: (o) => nameOf(o.warehouseId), csv: (o) => nameOf(o.warehouseId) },
    {
      key: "status",
      label: "Status",
      sort: (o) => STATUS_GROUP_LABEL[statusGroup(o.status)],
      cell: (o) => <Chip tone={STATUS_TONE[statusGroup(o.status)]}>{STATUS_GROUP_LABEL[statusGroup(o.status)]}</Chip>,
      csv: (o) => o.status,
    },
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
    const counts = new Map(days.map((d) => [d, { seller: 0, buyer: 0 }]));
    for (const c of inScope(cancellations)) {
      if (!c.cancelledAt) continue;
      const row = counts.get(todayIST(new Date(c.cancelledAt)));
      if (row) row[c.type] += 1;
    }
    return days.map((d) => ({ day: d, ...(counts.get(d) as { seller: number; buyer: number }) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancellations, warehouseId, today]);

  const sellerTotal = cancellations.filter((c) => c.type === "seller").length;
  const buyerTotal = cancellations.filter((c) => c.type === "buyer").length;
  const toggleWarehouse = (id: string | null) => setWarehouseId((current) => (id === null || current === id ? "" : id));

  return (
    <>
      <OrdersSyncBar state={state} canSync={canSync} kind="pending" today={today} />

      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
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
              className={`focus-ring min-w-0 rounded-xl border p-3 text-left transition ${on ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-accent"}`}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className={`truncate text-sm font-extrabold ${on ? "text-accent-text" : ""}`}>{w.name}</span>
                <span className="shrink-0 text-xs font-semibold text-muted">{formatNumber(w.total)} orders</span>
              </span>
              <span className="mt-1.5 grid grid-cols-3 gap-1 text-center">
                {(["new", "packed", "ready"] as const).map((g) => (
                  <span key={g} className="rounded-lg bg-surface2 px-1 py-1.5">
                    <span className="block text-lg font-extrabold leading-none">{formatNumber(w[g])}</span>
                    <span className="block text-[11px] font-semibold text-muted">{g === "ready" ? "Ready" : STATUS_GROUP_LABEL[g]}</span>
                  </span>
                ))}
              </span>
              <span className={`mt-1.5 block text-xs font-semibold ${w.nextDue && isRed(u) ? "text-bad" : "text-muted"}`}>
                {w.nextDue ? `Next dispatch by ${formatDue(w.nextDue, now)}` : "No deadline"}
                {w.late ? ` · ${w.late} late` : ""}
                {w.held ? ` · ${w.held} on hold` : ""}
              </span>
            </button>
          );
        })}
        {cards.length === 0 ? <p className="text-sm text-muted">No warehouse to show.</p> : null}
      </div>

      <div className="mb-3">
        <ChipFilter<View>
          label="Orders lists"
          value={view}
          onChange={setView}
          options={[
            { key: "pending", label: "Waiting to dispatch", count: pending.length },
            { key: "cancelled", label: "Cancelled (30 days)", count: sellerTotal + buyerTotal },
          ]}
        />
      </div>

      {view === "pending" ? (
        <ListView
          key="pending"
          rows={pending}
          columns={pendingColumns}
          rowKey={(o) => o.orderItemId}
          defaultSort={{ key: "due", dir: "asc" }}
          textKeys={["order", "sku", "wh", "status"]}
          searchText={(o) => `${o.orderId} ${o.sku ?? ""}`}
          searchLabel="Search order ID or SKU"
          csvName="vrprime-pending-orders.csv"
          noun={["order line", "order lines"]}
          scope={scope}
          emptyTitle="No orders waiting"
          emptyBody="Nothing is waiting to be dispatched at the moment, or the first read from Flipkart has not finished."
          note={<p className="text-xs text-muted">Red means the dispatch deadline is today or has passed. Orders on hold are shown but are not counted as late.</p>}
        />
      ) : (
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
      )}
    </>
  );
}
