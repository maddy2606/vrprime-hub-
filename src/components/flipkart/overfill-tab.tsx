"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ListView } from "@/components/flipkart/list-view";
import { Dropdown, Segmented } from "@/components/flipkart/kit";
import type { Column } from "@/components/stock/data-table";
import { ticketHref } from "@/lib/flipkart-analysis";
import { formatNumber } from "@/lib/format";
import { restockHref } from "@/lib/stock-analysis";

export type OverfillRow = { sku: string; title: string | null; warehouseId: string; orders: number; units: number };

const SMALL_BUTTON = "focus-ring inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-lg border border-line bg-surface px-3 text-xs font-bold hover:bg-surface2 sm:min-h-9";

/**
 * SKUs that have orders waiting at a warehouse where that SKU's stock is 0 ("overfill": more ordered than there is).
 * The same data Needs action used to carry, now with a warehouse view: pick a warehouse to see only its SKUs.
 */
export function OverfillTab({ rows, warehouses }: { rows: OverfillRow[]; warehouses: { id: string; name: string }[] }) {
  const [wh, setWh] = useState<string>("");
  const nameOf = (id: string) => warehouses.find((w) => w.id === id)?.name ?? "Unknown warehouse";

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.warehouseId, (m.get(r.warehouseId) ?? 0) + 1);
    return m;
  }, [rows]);
  const shown = useMemo(() => (wh ? rows.filter((r) => r.warehouseId === wh) : rows), [rows, wh]);
  const orders = shown.reduce((n, r) => n + r.orders, 0);
  const units = shown.reduce((n, r) => n + r.units, 0);
  const withRows = warehouses.filter((w) => counts.has(w.id));

  const columns: Column<OverfillRow>[] = [
    {
      key: "sku",
      label: "SKU",
      sort: (r) => r.sku,
      cell: (r) => (
        <div className="min-w-0">
          <span className="break-all font-mono text-[13px] font-bold leading-tight">{r.sku}</span>
          {r.title ? <p className="mt-0.5 line-clamp-2 break-words text-xs leading-snug text-muted">{r.title}</p> : null}
        </div>
      ),
      csv: (r) => r.sku,
    },
    { key: "title", label: "Title", csvOnly: true, cell: () => null, csv: (r) => r.title },
    { key: "wh", label: "Warehouse", sort: (r) => nameOf(r.warehouseId), cell: (r) => nameOf(r.warehouseId), csv: (r) => nameOf(r.warehouseId) },
    { key: "orders", label: "Orders waiting", align: "right", sort: (r) => r.orders, cell: (r) => <span className="font-bold text-bad">{formatNumber(r.orders)}</span>, csv: (r) => r.orders },
    { key: "units", label: "Units waiting", align: "right", sort: (r) => r.units, cell: (r) => formatNumber(r.units), csv: (r) => r.units },
    {
      key: "act",
      label: "",
      screenOnly: true,
      cell: (r) => (
        <div className="flex gap-1.5">
          <Link prefetch={false} href={restockHref(r.sku, r.warehouseId)} className={SMALL_BUTTON}>
            + Restock
          </Link>
          <Link prefetch={false} href={ticketHref(r.sku)} className={SMALL_BUTTON}>
            Raise ticket
          </Link>
        </div>
      ),
      csv: () => null,
    },
  ];

  return (
    <ListView
      rows={shown}
      columns={columns}
      rowKey={(r) => `${r.sku}|${r.warehouseId}`}
      defaultSort={{ key: "orders", dir: "desc" }}
      textKeys={["sku", "wh"]}
      searchText={(r) => `${r.sku} ${r.title ?? ""} ${nameOf(r.warehouseId)}`}
      searchLabel="Search SKU, title or warehouse"
      csvName="vrprime-overfill-orders.csv"
      noun={["SKU with orders and no stock", "SKUs with orders and no stock"]}
      scope={`${formatNumber(orders)} orders · ${formatNumber(units)} units waiting${wh ? ` · ${nameOf(wh)}` : ""}`}
      note={<>SKUs that have orders waiting to be packed at a warehouse where the stock of that SKU is 0. Restock the warehouse, or raise a ticket if the stock Flipkart shows is wrong. Only Active orders count (not Upcoming or Under Processing).</>}
      controls={
        withRows.length > 1 ? (
          withRows.length <= 3 ? (
            <Segmented<string>
              label="Warehouse"
              value={wh}
              onChange={setWh}
              options={[{ key: "", label: "All", count: rows.length }, ...withRows.map((w) => ({ key: w.id, label: w.name, count: counts.get(w.id) ?? 0 }))]}
            />
          ) : (
            <Dropdown
              label="Warehouse"
              value={wh}
              onChange={setWh}
              options={[{ value: "", label: `All (${rows.length})` }, ...withRows.map((w) => ({ value: w.id, label: `${w.name} (${counts.get(w.id) ?? 0})` }))]}
            />
          )
        ) : null
      }
      emptyTitle="No orders are waiting on an empty shelf"
      emptyBody="Every SKU with orders waiting has stock at that warehouse. This list fills when stock hits 0 while orders are still waiting."
    />
  );
}
