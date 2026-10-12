"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Column } from "@/components/stock/data-table";
import { ChipFilter, ListView } from "@/components/flipkart/list-view";
import { OrdersSyncBar } from "@/components/flipkart/orders-sync-bar";
import { Chip } from "@/components/ui";
import { formatDate, formatNumber } from "@/lib/format";
import { ticketHref, type ReturnRate } from "@/lib/flipkart-analysis";
import type { OrderSyncState } from "@/lib/orders-sync";
import type { ReturnListRow } from "@/server/flipkart-data";

type View = "list" | "rates";
type Source = "all" | "courier_return" | "customer_return";

type Props = {
  returns: ReturnListRow[];
  rates: ReturnRate[];
  historyReady: boolean;
  rateLimit: number;
  warehouses: { id: string; name: string }[];
  state: OrderSyncState;
  canSync: boolean;
  today: string;
};

const SOURCE_LABEL = { courier_return: "Courier return", customer_return: "Customer return" } as const;

function TicketLink({ sku }: { sku: string | null }) {
  return (
    <Link prefetch={false} href={ticketHref(sku, "wrong_return")} className="focus-ring inline-flex min-h-9 items-center whitespace-nowrap rounded-lg px-2 text-xs font-bold text-accent-text hover:bg-accent-soft">
      Raise ticket
    </Link>
  );
}

export function ReturnsTab({ returns, rates, historyReady, rateLimit, warehouses, state, canSync, today }: Props) {
  const [view, setView] = useState<View>("list");
  const [source, setSource] = useState<Source>("all");
  const [warehouseId, setWarehouseId] = useState("");

  const nameOf = (id: string | null) => warehouses.find((w) => w.id === id)?.name ?? "Unknown";
  const rows = useMemo(
    () => returns.filter((r) => (source === "all" || r.source === source) && (!warehouseId || r.warehouseId === warehouseId)),
    [returns, source, warehouseId],
  );
  const units = (list: ReturnListRow[]) => list.reduce((n, r) => n + r.quantity, 0);
  const courier = returns.filter((r) => r.source === "courier_return");
  const customer = returns.filter((r) => r.source === "customer_return");

  const columns: Column<ReturnListRow>[] = [
    { key: "date", label: "Created", sort: (r) => r.createdDate, cell: (r) => <span className="whitespace-nowrap">{r.createdDate ? formatDate(r.createdDate, today) : "—"}</span>, csv: (r) => r.createdDate },
    { key: "sku", label: "SKU", sort: (r) => r.sku, cell: (r) => (r.sku ? <span className="break-all font-mono text-[13px] font-bold">{r.sku}</span> : <span className="text-xs text-muted">Not known (older order)</span>), csv: (r) => r.sku },
    { key: "type", label: "Type", sort: (r) => r.source, cell: (r) => <Chip tone={r.source === "courier_return" ? "warn" : "info"}>{SOURCE_LABEL[r.source]}</Chip>, csv: (r) => SOURCE_LABEL[r.source] },
    { key: "reason", label: "Reason", sort: (r) => r.reason, cell: (r) => <span className="text-xs">{[r.reason, r.subReason].filter(Boolean).join(" · ").replaceAll("_", " ") || "—"}</span>, csv: (r) => [r.reason, r.subReason].filter(Boolean).join(" / ") },
    { key: "qty", label: "Qty", align: "right", sort: (r) => r.quantity, cell: (r) => formatNumber(r.quantity), csv: (r) => r.quantity },
    { key: "wh", label: "Warehouse", sort: (r) => nameOf(r.warehouseId), cell: (r) => nameOf(r.warehouseId), csv: (r) => nameOf(r.warehouseId) },
    { key: "status", label: "Status", sort: (r) => r.status, cell: (r) => <span className="text-xs capitalize">{(r.status ?? "—").replaceAll("_", " ")}</span>, csv: (r) => r.status },
    { key: "order", label: "Order ID", sort: (r) => r.orderId, cell: (r) => <span className="break-all font-mono text-xs">{r.orderId ?? "—"}</span>, csv: (r) => r.orderId },
    { key: "ticket", label: "", screenOnly: true, cell: (r) => <TicketLink sku={r.sku} />, csv: () => null },
  ];

  const rateColumns: Column<ReturnRate>[] = [
    { key: "sku", label: "SKU", sort: (r) => r.sku, cell: (r) => <span className="break-all font-mono text-[13px] font-bold">{r.sku}</span>, csv: (r) => r.sku },
    { key: "rate", label: "Return rate", align: "right", sort: (r) => r.ratePct, cell: (r) => (r.ratePct === null ? <span className="text-muted">—</span> : <span className={r.flagged ? "font-bold text-bad" : ""}>{r.ratePct}%</span>), csv: (r) => r.ratePct },
    { key: "returned", label: "Returned", align: "right", sort: (r) => r.returned, cell: (r) => formatNumber(r.returned), csv: (r) => r.returned },
    { key: "sold", label: "Sold (30 days)", align: "right", sort: (r) => r.sold, cell: (r) => formatNumber(r.sold), csv: (r) => r.sold },
    { key: "flag", label: "", cell: (r) => (r.flagged ? <Chip tone="bad">Above {rateLimit}%</Chip> : null), csv: (r) => (r.flagged ? "above limit" : "") },
    { key: "ticket", label: "", screenOnly: true, cell: (r) => (r.flagged ? <TicketLink sku={r.sku} /> : null), csv: () => null },
  ];

  return (
    <>
      <OrdersSyncBar state={state} canSync={canSync} kind="daily" today={today} />

      {!historyReady ? (
        <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-xs font-semibold text-warn">
          Only returns that changed in the last few days are loaded so far. The full 30 days arrive when the nightly load finishes, so the counts below are low until then.
        </p>
      ) : null}

      <div className="mb-4 grid grid-cols-3 gap-2">
        {[
          { label: "Returns, 30 days", value: formatNumber(units(returns)), sub: `${formatNumber(returns.length)} lines` },
          { label: "Courier returns", value: formatNumber(units(courier)), sub: "came back undelivered" },
          { label: "Customer returns", value: formatNumber(units(customer)), sub: "sent back by the buyer" },
        ].map((t) => (
          <div key={t.label} className="min-w-0 rounded-xl border border-line bg-surface p-3">
            <span className="block text-xs font-bold leading-tight text-muted">{t.label}</span>
            <span className="mt-1 block text-2xl font-extrabold leading-none tracking-tight">{t.value}</span>
            <span className="mt-1 block text-xs font-semibold text-muted">{t.sub}</span>
          </div>
        ))}
      </div>

      <div className="mb-3">
        <ChipFilter<View>
          label="Returns lists"
          value={view}
          onChange={setView}
          options={[
            { key: "list", label: "All returns", count: returns.length },
            { key: "rates", label: "Return rate by SKU", count: rates.filter((r) => r.flagged).length },
          ]}
        />
      </div>

      {view === "list" ? (
        <ListView
          key="list"
          rows={rows}
          columns={columns}
          rowKey={(r) => `${r.returnId}|${r.orderItemId}`}
          defaultSort={{ key: "date", dir: "desc" }}
          textKeys={["sku", "type", "reason", "wh", "status", "order"]}
          searchText={(r) => `${r.sku ?? ""} ${r.orderId ?? ""} ${r.orderItemId} ${r.reason ?? ""} ${r.subReason ?? ""}`}
          searchLabel="Search SKU, order ID or reason"
          csvName="vrprime-returns.csv"
          noun={["return", "returns"]}
          scope={warehouseId ? `${nameOf(warehouseId)} only` : undefined}
          controls={
            <>
              <ChipFilter<Source>
                label="Kind of return"
                value={source}
                onChange={setSource}
                options={[
                  { key: "all", label: "All", count: returns.length },
                  { key: "courier_return", label: "Courier", count: courier.length },
                  { key: "customer_return", label: "Customer", count: customer.length },
                ]}
              />
              {warehouses.length > 1 ? (
                <div>
                  <label htmlFor="returns-wh" className="sr-only">Warehouse</label>
                  <select id="returns-wh" className="input max-w-60" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                    <option value="">All warehouses</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>
              ) : null}
            </>
          }
          emptyTitle="No returns"
          emptyBody="No returns in the last 30 days, or the daily read has not covered them yet."
        />
      ) : (
        <ListView
          key="rates"
          rows={rates}
          columns={rateColumns}
          rowKey={(r) => r.sku}
          defaultSort={{ key: historyReady ? "rate" : "returned", dir: "desc" }}
          textKeys={["sku"]}
          searchText={(r) => r.sku}
          searchLabel="Search SKU"
          csvName="vrprime-return-rates.csv"
          noun={["SKU", "SKUs"]}
          note={
            <p className="text-xs text-muted">
              {historyReady
                ? `Return rate = units returned ÷ units sold in the last 30 days. Flagged above ${rateLimit}% once at least 10 units were sold.`
                : "Rates need 30 days of shipped orders, which are still being loaded at night. Returns are already counted."}
            </p>
          }
          emptyTitle="No data yet"
          emptyBody="There are no returns or shipped orders to work out rates from."
        />
      )}
    </>
  );
}
