"use client";

import { useState } from "react";
import { CsvButton, SearchField, Segmented, Toolbar } from "@/components/flipkart/kit";
import { DataTable, type Column } from "@/components/stock/data-table";
import { Chip, EmptyState, Stat, StatStrip } from "@/components/ui";
import { downloadCsv, toCsv } from "@/lib/csv";
import { deadTotals, sortByValue, type DeadKind, type DeadRow } from "@/lib/dead-stock";
import { formatINR, formatNumber, todayIST } from "@/lib/format";

const rs = (n: number) => formatINR(Math.round(n));

/**
 * Business › Dead stock (graphite-spec 12.1): products with stock that did not sell in 30 days (Dead), or that would
 * last more than 90 days (Slow), by the value of the stock at cost.
 */
export function DeadTab({ rows, warehouses, error }: { rows: DeadRow[]; warehouses: { id: string; name: string }[]; error: boolean }) {
  const [kind, setKind] = useState<DeadKind>("dead");
  const [q, setQ] = useState("");
  const totals = deadTotals(rows);
  const whName = new Map(warehouses.map((w) => [w.id, w.name]));
  const needle = q.trim().toLowerCase();
  const shown = sortByValue(rows.filter((r) => r.kind === kind && (!needle || [r.name, r.code].some((v) => v?.toLowerCase().includes(needle)))));

  const columns: Column<DeadRow>[] = [
    {
      key: "product",
      label: "Product",
      cell: (r) => (
        <span className="flex min-w-0 flex-col">
          {r.code ? <span className="font-mono text-[12px] text-muted">{r.code}</span> : null}
          <span className="font-medium">{r.name}</span>
        </span>
      ),
      csv: (r) => (r.code ? `${r.code} ${r.name}` : r.name),
    },
    { key: "stock", label: "Stock", align: "right", cell: (r) => <span className="tabular-nums">{formatNumber(r.stock)}</span>, csv: (r) => r.stock },
    {
      key: "wh",
      label: "By warehouse",
      cell: (r) => (
        <span className="flex flex-wrap gap-1">
          {r.byWarehouse.map((w) => (
            <Chip key={w.wid}>
              {whName.get(w.wid) ?? "—"} {formatNumber(w.pieces)}
            </Chip>
          ))}
        </span>
      ),
      csv: (r) => r.byWarehouse.map((w) => `${whName.get(w.wid) ?? "—"} ${w.pieces}`).join("; "),
    },
    { key: "sold", label: "Sold in 30 days", align: "right", cell: (r) => <span className="tabular-nums">{formatNumber(r.dispatched)}</span>, csv: (r) => r.dispatched },
    { key: "cover", label: "Days of cover", align: "right", cell: (r) => <span className="tabular-nums">{r.cover === null ? "—" : formatNumber(Math.round(r.cover))}</span>, csv: (r) => (r.cover === null ? null : Math.round(r.cover)) },
    { key: "cost", label: "Cost a unit", align: "right", cell: (r) => <span className="tabular-nums">{r.cost === null ? "—" : formatINR(r.cost)}</span>, csv: (r) => r.cost },
    {
      key: "value",
      label: "Value",
      align: "right",
      cell: (r) => (r.value === null ? <Chip tone="warn">No cost</Chip> : <span className="tabular-nums font-semibold">{rs(r.value)}</span>),
      csv: (r) => (r.value === null ? null : Math.round(r.value)),
    },
  ];

  const csv = () => downloadCsv(`${kind}-stock-${todayIST()}.csv`, toCsv(columns.map((c) => c.label), shown.map((r) => columns.map((c) => c.csv(r)))));

  if (error) return <EmptyState title="Dead stock could not be loaded" body="Reload the page. If it keeps happening, tell the developer." />;

  return (
    <>
      <StatStrip ariaLabel="Dead and slow stock" className="mb-4">
        <Stat label="Dead stock value" kind="money" value={rs(totals.deadValue)} sub="at cost, products with no cost not counted" />
        <Stat label="Dead products" kind="orders" value={totals.deadProducts} tone={totals.deadProducts > 0 ? "warn" : "ink"} sub="stock, nothing sold in 30 days" />
        <Stat label="Slow stock value" kind="money" value={rs(totals.slowValue)} sub={`${formatNumber(totals.slowProducts)} ${totals.slowProducts === 1 ? "product" : "products"} with over 90 days of cover`} />
        <Stat label="Products with no cost entered" kind="stock-alert" value={totals.noCost} sub="enter costs on the P&L page" />
      </StatStrip>
      <Toolbar>
        <Segmented<DeadKind>
          label="Dead or slow stock"
          value={kind}
          onChange={setKind}
          options={[
            { key: "dead", label: "Dead", count: totals.deadProducts },
            { key: "slow", label: "Slow", count: totals.slowProducts },
          ]}
        />
        <SearchField value={q} onChange={setQ} placeholder="Search product or code" />
        <CsvButton onClick={csv} disabled={!shown.length} />
      </Toolbar>
      {shown.length ? (
        <DataTable columns={columns} rows={shown} sortKey="value" sortDir="desc" onSort={() => undefined} rowKey={(r) => r.name} />
      ) : (
        <EmptyState title={kind === "dead" ? "No dead stock" : "No slow stock"} body={kind === "dead" ? "Every product in stock sold something in the last 30 days." : "No product in stock would last more than 90 days."} />
      )}
    </>
  );
}
