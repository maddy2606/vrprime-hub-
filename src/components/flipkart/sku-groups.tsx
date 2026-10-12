"use client";

import { useMemo, useState } from "react";
import { ChevronDownIcon, SearchIcon } from "@/components/icons";
import { Chip, EmptyState } from "@/components/ui";
import { downloadCsv, toCsv, type CsvCell } from "@/lib/csv";
import { BUCKET_LABEL, BUCKETS, bucketOf, formatDue, isRed, shortBy, urgency, type Bucket, type SkuGroup, type StockBySku } from "@/lib/flipkart-analysis";
import { formatNumber } from "@/lib/format";

/** Cards drawn at a time: a phone should not have to draw thousands. */
const PAGE = 100;

type Sort = "due" | "units" | "orders" | "sku";

export const BUCKET_TONE: Record<Bucket, "info" | "accent" | "ok" | "neutral" | "warn"> = {
  to_accept: "info",
  to_pack: "accent",
  to_dispatch: "ok",
  upcoming: "neutral",
  processing: "warn",
};

type Props = {
  groups: SkuGroup[];
  warehouses: { id: string; name: string }[];
  stock: StockBySku;
  now: Date;
  /** Text after the count, for example "Bhiwandi only". */
  scope?: string;
  emptyBody: string;
};

/**
 * One row per SKU, like Seller Hub's Smart Groups: title, orders, units, units per warehouse, the earliest
 * dispatch-by and the counts per tab. Tapping a row shows its orders and, per warehouse, stock against the
 * units ordered there.
 */
export function SkuGroups({ groups, warehouses, stock, now, scope, emptyBody }: Props) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("due");
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const nameOf = (id: string) => warehouses.find((w) => w.id === id)?.name ?? "Unknown";
  const titleOf = (sku: string | null) => (sku ? stock[sku]?.title ?? null : null);
  const keyOf = (g: SkuGroup) => g.sku ?? "";

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? groups.filter((g) => `${g.sku ?? ""} ${titleOf(g.sku) ?? ""} ${g.orders.map((o) => o.orderId).join(" ")}`.toLowerCase().includes(needle))
      : groups;
    const by: Record<Sort, (a: SkuGroup, b: SkuGroup) => number> = {
      due: (a, b) => (a.earliestActiveDue ?? a.earliestDue ?? "9").localeCompare(b.earliestActiveDue ?? b.earliestDue ?? "9"),
      units: (a, b) => b.units - a.units,
      orders: (a, b) => b.orderCount - a.orderCount,
      sku: (a, b) => (a.sku ?? "").localeCompare(b.sku ?? "", "en", { numeric: true, sensitivity: "base" }),
    };
    return [...filtered].sort((a, b) => by[sort](a, b) || (a.sku ?? "").localeCompare(b.sku ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, q, sort, stock]);

  const exportCsv = () => {
    const whCols = warehouses.filter((w) => groups.some((g) => g.unitsByWarehouse[w.id]));
    downloadCsv(
      "vrprime-orders-by-sku.csv",
      toCsv(
        ["SKU", "Title", "Orders", "Units", ...whCols.map((w) => `Units ${w.name}`), "Earliest dispatch by", ...BUCKETS.map((b) => BUCKET_LABEL[b])],
        shown.map((g): CsvCell[] => [g.sku, titleOf(g.sku), g.orderCount, g.units, ...whCols.map((w) => g.unitsByWarehouse[w.id] ?? 0), g.earliestActiveDue ?? g.earliestDue, ...BUCKETS.map((b) => g.counts[b])]),
      ),
    );
  };

  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <>
      <div className="mb-3 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
            <label htmlFor="search-sku-groups" className="sr-only">
              Search SKU, title or order ID
            </label>
            <input id="search-sku-groups" type="search" className="input pl-10" placeholder="Search SKU, title or order ID" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} autoComplete="off" />
          </div>
          <label htmlFor="sort-sku-groups" className="sr-only">
            Sort by
          </label>
          <select id="sort-sku-groups" className="input w-auto min-w-0" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="due">Earliest dispatch-by</option>
            <option value="units">Most units</option>
            <option value="orders">Most orders</option>
            <option value="sku">SKU A to Z</option>
          </select>
          <button type="button" onClick={exportCsv} disabled={shown.length === 0} className="focus-ring min-h-11 rounded-lg border border-line bg-surface px-4 text-sm font-bold hover:bg-surface2 disabled:opacity-50">
            Download CSV
          </button>
        </div>
        <p className="text-xs text-muted">
          {formatNumber(shown.length)} {shown.length === 1 ? "SKU" : "SKUs"} · {formatNumber(shown.reduce((n, g) => n + g.orderCount, 0))} orders · {formatNumber(shown.reduce((n, g) => n + g.units, 0))} units
          {scope ? ` · ${scope}` : ""}
        </p>
        <p className="text-xs text-muted">Tap a SKU to see its orders and the stock at each warehouse. Red dates are due today or late.</p>
      </div>

      {shown.length === 0 ? (
        <EmptyState title={q ? "Nothing matches your search" : "No orders here"} body={q ? "Try a shorter part of the text, or clear the search." : emptyBody} />
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.slice(0, limit).map((g) => {
            const key = keyOf(g);
            const expanded = open.has(key);
            // Red only for Active orders: Upcoming cannot be late yet and Under Processing does not count.
            const due = g.earliestActiveDue ?? g.earliestDue;
            const red = g.earliestActiveDue !== null && isRed(urgency(g.earliestActiveDue, now));
            const title = titleOf(g.sku);
            const whIds = Object.keys(g.unitsByWarehouse).sort((a, b) => g.unitsByWarehouse[b] - g.unitsByWarehouse[a]);
            const anyShort = whIds.some((id) => shortBy(g.unitsByWarehouse[id], g.sku ? stock[g.sku]?.units[id] : null) > 0);
            return (
              <li key={key} className="rounded-xl border border-line bg-surface">
                <button type="button" aria-expanded={expanded} onClick={() => toggle(key)} className="focus-ring flex w-full min-w-0 flex-col gap-1.5 rounded-xl p-3 text-left">
                  <span className="flex w-full items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block break-all font-mono text-[13px] font-bold">{g.sku ?? "No SKU"}</span>
                      {title ? <span className="block truncate text-xs text-muted">{title}</span> : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <span className={`whitespace-nowrap text-xs font-semibold ${red ? "text-bad" : "text-muted"}`}>{due ? formatDue(due, now) : "—"}</span>
                      <ChevronDownIcon className={`h-4 w-4 text-muted transition ${expanded ? "rotate-180" : ""}`} />
                    </span>
                  </span>
                  <span className="text-sm font-bold">
                    {formatNumber(g.orderCount)} {g.orderCount === 1 ? "order" : "orders"} · {formatNumber(g.units)} {g.units === 1 ? "unit" : "units"}
                    {anyShort ? <span className="ml-2 text-xs font-bold text-bad">Short of stock</span> : null}
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {whIds.map((id) => (
                      <Chip key={id}>
                        {nameOf(id)} {formatNumber(g.unitsByWarehouse[id])}
                      </Chip>
                    ))}
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {BUCKETS.filter((b) => g.counts[b] > 0).map((b) => (
                      <Chip key={b} tone={BUCKET_TONE[b]}>
                        {BUCKET_LABEL[b]} {formatNumber(g.counts[b])}
                      </Chip>
                    ))}
                  </span>
                </button>

                {expanded ? (
                  <div className="border-t border-line p-3">
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
                          const units = g.unitsByWarehouse[id];
                          const have = g.sku ? stock[g.sku]?.units[id] : null;
                          const short = shortBy(units, have);
                          return (
                            <tr key={id} className="border-t border-line">
                              <td className="py-1.5">{nameOf(id)}</td>
                              <td className="py-1.5 text-right tabular-nums">{formatNumber(units)}</td>
                              <td className="py-1.5 text-right tabular-nums">
                                {have === null || have === undefined ? <span className="text-muted">not listed</span> : formatNumber(have)}
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
                          {g.orders.map((o) => {
                            const b = bucketOf(o, now);
                            const ou = urgency(o.dispatchBy, now);
                            return (
                              <tr key={o.orderItemId} className="border-t border-line">
                                <td className="py-1.5 pr-3 font-mono text-xs">{o.orderId}</td>
                                <td className="py-1.5 pr-3 text-right tabular-nums">{formatNumber(o.quantity)}</td>
                                <td className="py-1.5 pr-3">{nameOf(o.warehouseId ?? "")}</td>
                                <td className="py-1.5 pr-3">
                                  {b ? <Chip tone={BUCKET_TONE[b]}>{BUCKET_LABEL[b]}</Chip> : null}
                                  {o.hold ? <span className="ml-1"><Chip>On hold</Chip></span> : null}
                                </td>
                                <td className={`whitespace-nowrap py-1.5 font-semibold ${!o.hold && b !== "processing" && b !== "upcoming" && isRed(ou) ? "text-bad" : ""}`}>
                                  {o.dispatchBy ? formatDue(o.dispatchBy, now) : "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {shown.length > limit ? (
        <button type="button" onClick={() => setLimit((n) => n + PAGE)} className="focus-ring mt-2 min-h-11 w-full rounded-lg border border-line bg-surface px-4 text-sm font-bold hover:bg-surface2">
          Show {formatNumber(Math.min(PAGE, shown.length - limit))} more ({formatNumber(shown.length - limit)} not shown; the CSV has all of them)
        </button>
      ) : null}
    </>
  );
}
