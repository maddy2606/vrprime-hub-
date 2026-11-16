"use client";

import { useState } from "react";
import { ChevronDownIcon } from "@/components/icons";
import { Caption } from "@/components/flipkart/kit";
import { CardLoader, Chip, EmptyState, buttonClass } from "@/components/ui";
import { formatDue, isRed, urgency } from "@/lib/flipkart-analysis";
import { formatNumber } from "@/lib/format";
import { BUCKET_LABEL, BUCKETS, shortBy, type Bucket, type SkuDetail, type SkuRow, type StatusFilter } from "@/lib/orders-view";
import { loadSkuDetailAction } from "@/server/actions/orders-view";

export const BUCKET_TONE: Record<Bucket, "info" | "accent" | "ok" | "neutral" | "warn"> = {
  to_accept: "info",
  to_pack: "accent",
  to_dispatch: "ok",
  upcoming: "neutral",
  processing: "warn",
};

type Props = {
  rows: SkuRow[];
  total: number;
  orders: number;
  units: number;
  warehouses: { id: string; name: string }[];
  now: Date;
  /** Which Seller Hub tab and warehouse the list is for, so an opened SKU shows the same orders. */
  status: StatusFilter;
  warehouseId: string;
  loading: boolean;
  onMore: () => void;
  /** Text after the count, for example "Bhiwandi only". */
  scope?: string;
  searching: boolean;
  emptyBody: string;
};

type Detail = { state: "loading" } | { state: "failed" } | { state: "ready"; detail: SkuDetail };

/**
 * One row per SKU, like Seller Hub's Smart Groups: title, orders, units, units per warehouse, the earliest
 * dispatch-by and the counts per tab. Tapping a row loads its orders and, per warehouse, stock against the
 * units ordered there: nothing about a SKU's orders is sent until it is opened.
 */
export function SkuGroups({ rows, total, orders, units, warehouses, now, status, warehouseId, loading, onMore, scope, searching, emptyBody }: Props) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<Record<string, Detail>>({});

  const nameOf = (id: string) => warehouses.find((w) => w.id === id)?.name ?? "Unknown";

  const toggle = (sku: string) => {
    const opening = !open.has(sku);
    setOpen((current) => {
      const next = new Set(current);
      if (opening) next.add(sku);
      else next.delete(sku);
      return next;
    });
    if (!opening) return;
    // Always look again when a row is opened: the orders may have moved on since it was last open.
    setDetails((d) => ({ ...d, [sku]: { state: "loading" } }));
    void loadSkuDetailAction({ sku, wh: warehouseId, status }).then((result) =>
      setDetails((d) => ({ ...d, [sku]: result.ok && result.data ? { state: "ready", detail: result.data } : { state: "failed" } })),
    );
  };

  return (
    <>
      <Caption>
        {formatNumber(total)} {total === 1 ? "SKU" : "SKUs"} · {formatNumber(orders)} orders · {formatNumber(units)} units
        {scope ? ` · ${scope}` : ""}
      </Caption>

      {rows.length === 0 ? (
        <EmptyState title={searching ? "Nothing matches your search" : "No orders here"} body={searching ? "Try a shorter part of the text, or clear the search." : emptyBody} />
      ) : (
        <ul className="sp-card ledger-card divide-y divide-line-soft">
          {rows.map((g) => {
            const expanded = open.has(g.sku);
            const detail = details[g.sku];
            // Red only for Active orders: Upcoming cannot be late yet and Under Processing does not count.
            const due = g.active_due ?? g.due;
            const red = g.active_due !== null && isRed(urgency(g.active_due, now));
            const whIds = Object.keys(g.by_wh).sort((a, b) => g.by_wh[b] - g.by_wh[a]);
            const stock = detail?.state === "ready" ? detail.detail.stock : null;
            const anyShort = stock !== null && whIds.some((id) => shortBy(g.by_wh[id], id in stock ? stock[id] : null) > 0);
            return (
              <li key={g.sku}>
                <button type="button" aria-expanded={expanded} onClick={() => toggle(g.sku)} className="focus-ring grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 px-3 py-2.5 text-left transition-colors hover:bg-[var(--row-hover)] sm:px-4 lg:grid-cols-[minmax(0,1.5fr)_10rem_minmax(0,1fr)_minmax(0,1.3fr)_8.5rem] lg:items-center">
                    <span className="min-w-0">
                      <span className="block break-all font-mono text-[13px] font-medium">{g.sku || "No SKU"}</span>
                      {g.title ? <span className="block truncate text-xs text-muted">{g.title}</span> : null}
                    </span>
                    <span className="flex shrink-0 items-center justify-end gap-1 lg:order-last">
                      <span className={`whitespace-nowrap text-xs font-semibold ${red ? "text-bad" : "text-muted"}`}>{due ? formatDue(due, now) : "—"}</span>
                      <ChevronDownIcon className={`h-4 w-4 text-muted transition-transform ${expanded ? "rotate-180" : ""}`} />
                    </span>
                  <span className="col-span-2 text-[13px] font-semibold tabular-nums lg:col-span-1">
                    {formatNumber(g.orders)} {g.orders === 1 ? "order" : "orders"} · {formatNumber(g.units)} {g.units === 1 ? "unit" : "units"}
                    {anyShort ? <span className="ml-2 font-sans text-xs font-semibold text-bad">Short of stock</span> : null}
                  </span>
                  <span className="col-span-2 flex flex-wrap gap-1 lg:col-span-1">
                    {whIds.map((id) => (
                      <Chip key={id}>
                        {nameOf(id)} {formatNumber(g.by_wh[id])}
                      </Chip>
                    ))}
                  </span>
                  <span className="col-span-2 flex flex-wrap gap-1 lg:col-span-1">
                    {BUCKETS.filter((b) => g[b] > 0).map((b) => (
                      <Chip key={b} tone={BUCKET_TONE[b]}>
                        {BUCKET_LABEL[b]} {formatNumber(g[b])}
                      </Chip>
                    ))}
                  </span>
                </button>

                {expanded ? (
                  <div className="border-t border-line-soft bg-surface2 px-3 py-3 sm:px-4">
                    {!detail || detail.state === "loading" ? (
                      <CardLoader label="Loading this SKU's orders…" className="h-24" />
                    ) : detail.state === "failed" ? (
                      <p role="alert" className="tone-row tone-bad"><span className="tone-row-title">Could not load this SKU. Close it and open it again.</span></p>
                    ) : (
                      <>
                        <table className="ledger mb-3 w-full border-collapse">
                          <caption className="t-label pb-2 text-left">Stock vs units ordered</caption>
                          <thead>
                            <tr>
                              <th scope="col">Warehouse</th>
                              <th scope="col" className="num">Ordered</th>
                              <th scope="col" className="num">Stock</th>
                            </tr>
                          </thead>
                          <tbody>
                            {whIds.map((id) => {
                              const have = id in detail.detail.stock ? detail.detail.stock[id] : null;
                              const short = shortBy(g.by_wh[id], have);
                              return (
                                <tr key={id}>
                                  <td>{nameOf(id)}</td>
                                  <td className="num">{formatNumber(g.by_wh[id])}</td>
                                  <td className="num">
                                    {have === null ? <span className="text-muted">not listed</span> : formatNumber(have)}
                                    {short > 0 ? <span className="ml-2 font-bold text-bad">short by {formatNumber(short)}</span> : null}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>

                        <div className="overflow-x-auto">
                          <table className="ledger w-full min-w-max border-collapse">
                            <caption className="t-label pb-2 text-left">Orders</caption>
                            <thead>
                              <tr>
                                <th scope="col">Order ID</th>
                                <th scope="col" className="num">Qty</th>
                                <th scope="col">Warehouse</th>
                                <th scope="col">Status</th>
                                <th scope="col">Dispatch by</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detail.detail.lines.map((o) => {
                                const ou = urgency(o.dispatch_by, now);
                                return (
                                  <tr key={o.order_item_id}>
                                    <td className="font-mono">{o.order_id}</td>
                                    <td className="num">{formatNumber(o.quantity)}</td>
                                    <td>{nameOf(o.warehouse_id ?? "")}</td>
                                    <td>
                                      <Chip tone={BUCKET_TONE[o.bucket]}>{BUCKET_LABEL[o.bucket]}</Chip>
                                      {o.hold ? <span className="ml-1"><Chip>On hold</Chip></span> : null}
                                    </td>
                                    <td className={`whitespace-nowrap font-semibold ${!o.hold && o.bucket !== "processing" && o.bucket !== "upcoming" && isRed(ou) ? "text-bad" : ""}`}>
                                      {o.dispatch_by ? formatDue(o.dispatch_by, now) : "—"}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        {detail.detail.total > detail.detail.lines.length ? (
                          <p className="t-caption mt-2">
                            The first {formatNumber(detail.detail.lines.length)} of {formatNumber(detail.detail.total)} order lines, earliest dispatch-by first. Use Order list to see them all.
                          </p>
                        ) : null}
                      </>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {rows.length < total ? (
        <button type="button" onClick={onMore} disabled={loading} className={buttonClass("secondary", "mt-2 w-full")}>
          {loading ? "Loading…" : `Show ${formatNumber(Math.min(50, total - rows.length))} more (${formatNumber(total - rows.length)} not shown; the CSV has all of them)`}
        </button>
      ) : null}
    </>
  );
}
