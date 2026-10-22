"use client";

import { useMemo, useState } from "react";
import { Caption, CsvButton, Dropdown, InfoTip, SearchField, Segmented, Toolbar } from "@/components/flipkart/kit";
import { DataTable, type Column } from "@/components/stock/data-table";
import { Chip, EmptyState } from "@/components/ui";
import { downloadCsv, toCsv } from "@/lib/csv";
import { formatDate, formatNumber } from "@/lib/format";
import { daysBetween } from "@/lib/stock-analysis";
import type { StockChange, StockChangeKind } from "@/lib/stock-changes";

type Kind = "all" | StockChangeKind;

export type StockoutsTabProps = {
  /** Already in warehouse order, stocked out first, then by SKU. */
  rows: StockChange[];
  warehouses: { id: string; name: string }[];
  snapshotDate: string;
  previousDate: string | null;
  today: string;
};

const noSort = () => {};

/**
 * Only what changed between the last two stock reads, location by location: SKUs that ran out at a warehouse, and SKUs
 * that came back in stock there. No totals, no alerts; the Stock tab has the full picture.
 */
export function StockoutsTab({ rows, warehouses, snapshotDate, previousDate, today }: StockoutsTabProps) {
  const [kind, setKind] = useState<Kind>("all");
  const [wh, setWh] = useState("");
  const [q, setQ] = useState("");

  const nameOf = (id: string) => warehouses.find((w) => w.id === id)?.name ?? "Unknown warehouse";
  const after = formatDate(snapshotDate, today);
  const before = previousDate ? formatDate(previousDate, today) : null;

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(
      (r) => (kind === "all" || r.kind === kind) && (!wh || r.warehouseId === wh) && (!needle || `${r.sku} ${r.title ?? ""}`.toLowerCase().includes(needle)),
    );
  }, [rows, kind, wh, q]);

  if (warehouses.length === 0) {
    return <EmptyState title="No warehouse is assigned to you" body="Stock is shown per warehouse. Ask the owner to add your warehouse to your account." />;
  }
  if (!previousDate || !before) {
    return (
      <EmptyState
        title="Needs two stock reads"
        body={`This tab compares the latest stock read with the one before it. There is only one so far (${after}); the first comparison appears after the next daily read at 8:00 AM.`}
      />
    );
  }

  const inLocation = wh ? rows.filter((r) => r.warehouseId === wh) : rows;
  const ofKind = kind === "all" ? rows : rows.filter((r) => r.kind === kind);
  const locationCount = (id: string) => ofKind.filter((r) => r.warehouseId === id).length;
  const withRows = warehouses.filter((w) => rows.some((r) => r.warehouseId === w.id));
  const gap = daysBetween(previousDate, snapshotDate);

  const columns: Column<StockChange>[] = [
    {
      key: "sku",
      label: "SKU",
      cell: (r) => (
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="break-all font-mono text-[13px] font-bold leading-tight">{r.sku}</span>
            {r.kind === "out" ? <Chip tone="bad">Stocked out</Chip> : <Chip tone="ok">Back in stock</Chip>}
            {r.status === "INACTIVE" ? <Chip>Inactive</Chip> : null}
          </div>
          {r.title ? <p className="mt-0.5 line-clamp-2 break-words text-xs leading-snug text-muted">{r.title}</p> : null}
        </div>
      ),
      csv: () => null,
    },
    { key: "before", label: `Units on ${before}`, align: "right", width: "w-40", cell: (r) => formatNumber(r.before), csv: () => null },
    {
      key: "after",
      label: `Units on ${after}`,
      align: "right",
      width: "w-40",
      cell: (r) => <span className={r.kind === "out" ? "font-bold text-bad" : "font-bold text-ok"}>{formatNumber(r.after)}</span>,
      csv: () => null,
    },
  ];

  const exportCsv = () =>
    downloadCsv(
      `vrprime-stock-outs-${snapshotDate}.csv`,
      toCsv(
        ["Date", "Location", "SKU", "Title", "Status", "Change", `Units on ${previousDate}`, `Units on ${snapshotDate}`],
        shown.map((r) => [snapshotDate, nameOf(r.warehouseId), r.sku, r.title, r.status, r.kind === "out" ? "Stocked out" : "Back in stock", r.before, r.after]),
      ),
    );

  const groups = warehouses.map((w) => ({ w, rows: shown.filter((r) => r.warehouseId === w.id) })).filter((g) => g.rows.length > 0);

  return (
    <>
      <Toolbar>
        <Segmented<Kind>
          label="Change"
          value={kind}
          onChange={setKind}
          options={[
            { key: "all", label: "All", count: inLocation.length },
            { key: "out", label: "Stocked out", count: inLocation.filter((r) => r.kind === "out").length },
            { key: "in", label: "Back in stock", count: inLocation.filter((r) => r.kind === "in").length },
          ]}
        />
        {withRows.length > 1 ? (
          <Dropdown
            label="Location"
            value={wh}
            onChange={setWh}
            options={[{ value: "", label: `All (${formatNumber(ofKind.length)})` }, ...withRows.map((w) => ({ value: w.id, label: `${w.name} (${formatNumber(locationCount(w.id))})` }))]}
          />
        ) : null}
        <SearchField value={q} onChange={setQ} placeholder="Search SKU or title" />
        <CsvButton onClick={exportCsv} disabled={shown.length === 0} />
        <InfoTip>
          <p>Stocked out = had units at that location in the stock read of {before}, 0 in the read of {after}.</p>
          <p className="mt-2">Back in stock = 0 at that location on {before}, units again on {after}.</p>
          <p className="mt-2">Stock is read from Flipkart every day at 8:00 AM. A location where the SKU was not listed in one of the two reads is left out. The Stock tab has the full stock at every location.</p>
        </InfoTip>
      </Toolbar>
      <Caption>
        Changes between the stock reads of {before} and {after}
        {gap > 1 ? ` (no good read in between, so this covers ${gap} days)` : ""}
      </Caption>

      {rows.length === 0 ? (
        <EmptyState title="Nothing stocked out or came back in stock" body={`Between ${before} and ${after}, no SKU went to 0 or came back from 0 at any location.`} />
      ) : groups.length === 0 ? (
        <EmptyState title="Nothing matches" body="Try another location or change, or clear the search." />
      ) : (
        groups.map(({ w, rows: here }) => {
          const out = here.filter((r) => r.kind === "out").length;
          const back = here.length - out;
          return (
            <section key={w.id} className="mb-6">
              <h2 className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-base font-extrabold">
                {w.name}
                <span className="text-sm font-semibold">
                  {out ? <span className="text-bad">{formatNumber(out)} stocked out</span> : null}
                  {out && back ? <span className="text-muted"> · </span> : null}
                  {back ? <span className="text-ok">{formatNumber(back)} back in stock</span> : null}
                </span>
              </h2>
              <DataTable columns={columns} rows={here} sortKey="" sortDir="asc" onSort={noSort} rowKey={(r) => `${r.sku}|${r.kind}`} />
            </section>
          );
        })
      )}
    </>
  );
}
