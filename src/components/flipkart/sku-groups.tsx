"use client";

import { useState } from "react";
import { ChevronDownIcon } from "@/components/icons";
import { Chip, EmptyState } from "@/components/ui";
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
      <p className="mb-3 text-xs text-muted">
        {formatNumber(total)} {total === 1 ? "SKU" : "SKUs"} · {formatNumber(orders)} orders · {formatNumber(units)} units
        {scope ? ` · ${scope}` : ""}. Tap a SKU to see its orders and the stock at each warehouse. Red dates are due today or late.
      </p>

      {rows.length === 0 ? (
        <EmptyState title={searching ? "Nothing matches your search" : "No orders here"} body={searching ? "Try a shorter part of the text, or clear the search." : emptyBody} />
      ) : (
        <ul className="flex flex-col gap-2">
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
              <li key={g.sku} className="rounded-xl border border-line bg-surface">
                <button type="button" aria-expanded={expanded} onClick={() => toggle(g.sku)} className="focus-ring flex w-full min-w-0 flex-col gap-1.5 rounded-xl p-3 text-left">
                  <span className="flex w-full items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block break-all font-mono text-[13px] font-bold">{g.sku || "No SKU"}</span>
                      {g.title ? <span className="block truncate text-xs text-muted">{g.title}</span> : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <span className={`whitespace-nowrap text-xs font-semibold ${red ? "text-bad" : "text-muted"}`}>{due ? formatDue(due, now) : "—"}</span>
                      <ChevronDownIcon className={`h-4 w-4 text-muted transition ${expanded ? "rotate-180" : ""}`} />
                    </span>
                  </span>
                  <span className="text-sm font-bold">
                    {formatNumber(g.orders)} {g.orders === 1 ? "order" : "orders"} · {formatNumber(g.units)} {g.units === 1 ? "unit" : "units"}
                    {anyShort ? <span className="ml-2 text-xs font-bold text-bad">Short of stock</span> : null}
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {whIds.map((id) => (
                      <Chip key={id}>
                        {nameOf(id)} {formatNumber(g.by_wh[id])}
                      </Chip>
                    ))}
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {BUCKETS.filter((b) => g[b] > 0).map((b) => (
                      <Chip key={b} tone={BUCKET_TONE[b]}>
                        {BUCKET_LABEL[b]} {formatNumber(g[b])}
                      </Chip>
                    ))}
                  </span>
                </button>

                {expanded ? (
                  <div className="border-t border-line p-3">
                    {!detail || detail.state === "loading" ? (
                      <div aria-busy="true" aria-label="Loading this SKU's orders">
                        <div className="skeleton mb-2 h-5 w-40" />
                        <div className="skeleton h-24 w-full" />
                      </div>
                    ) : detail.state === "failed" ? (
                      <p role="alert" className="text-sm font-semibold text-bad">Could not load this SKU. Close it and open it again.</p>
                    ) : (
                      <>
                        <table className="mb-3 w-full border-collapse text-sm">
                          <caption className="pb-1 text-left text-xs font-bold uppercase tracking-wide text-muted">Stock vs units ordered</caption>
                          <thead>
                            <tr className="text-xs uppercase tracking-wide text-muted">
                              <th scope="col" className="py-1 text-left font-bold">Warehouse</th>
                              <th scope="col" className="py-1 text-right font-bold">Ordered</th>
                              <th scope="col" className="py-1 text-right font-bold">Stock</th>
                            </tr>
                          </thead>
                          <tbody>
                            {whIds.map((id) => {
                              const have = id in detail.detail.stock ? detail.detail.stock[id] : null;
                              const short = shortBy(g.by_wh[id], have);
                              return (
                                <tr key={id} className="border-t border-line">
                                  <td className="py-1.5">{nameOf(id)}</td>
                                  <td className="py-1.5 text-right tabular-nums">{formatNumber(g.by_wh[id])}</td>
                                  <td className="py-1.5 text-right tabular-nums">
                                    {have === null ? <span className="text-muted">not listed</span> : formatNumber(have)}
                                    {short > 0 ? <span className="ml-2 font-bold text-bad">short by {formatNumber(short)}</span> : null}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>

                        <div className="overflow-x-auto">
                          <table className="w-full min-w-max border-collapse text-sm">
                            <caption className="pb-1 text-left text-xs font-bold uppercase tracking-wide text-muted">Orders</caption>
                            <thead>
                              <tr className="text-xs uppercase tracking-wide text-muted">
                                <th scope="col" className="py-1 pr-3 text-left font-bold">Order ID</th>
                                <th scope="col" className="py-1 pr-3 text-right font-bold">Qty</th>
                                <th scope="col" className="py-1 pr-3 text-left font-bold">Warehouse</th>
                                <th scope="col" className="py-1 pr-3 text-left font-bold">Status</th>
                                <th scope="col" className="py-1 text-left font-bold">Dispatch by</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detail.detail.lines.map((o) => {
                                const ou = urgency(o.dispatch_by, now);
                                return (
                                  <tr key={o.order_item_id} className="border-t border-line">
                                    <td className="py-1.5 pr-3 font-mono text-xs">{o.order_id}</td>
                                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatNumber(o.quantity)}</td>
                                    <td className="py-1.5 pr-3">{nameOf(o.warehouse_id ?? "")}</td>
                                    <td className="py-1.5 pr-3">
                                      <Chip tone={BUCKET_TONE[o.bucket]}>{BUCKET_LABEL[o.bucket]}</Chip>
                                      {o.hold ? <span className="ml-1"><Chip>On hold</Chip></span> : null}
                                    </td>
                                    <td className={`whitespace-nowrap py-1.5 font-semibold ${!o.hold && o.bucket !== "processing" && o.bucket !== "upcoming" && isRed(ou) ? "text-bad" : ""}`}>
                                      {o.dispatch_by ? formatDue(o.dispatch_by, now) : "—"}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        {detail.detail.total > detail.detail.lines.length ? (
                          <p className="mt-2 text-xs text-muted">
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
        <button type="button" onClick={onMore} disabled={loading} className="focus-ring mt-2 min-h-11 w-full rounded-lg border border-line bg-surface px-4 text-sm font-bold hover:bg-surface2 disabled:opacity-60">
          {loading ? "Loading…" : `Show ${formatNumber(Math.min(50, total - rows.length))} more (${formatNumber(total - rows.length)} not shown; the CSV has all of them)`}
        </button>
      ) : null}
    </>
  );
}
