"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { CsvButton, Picker, SearchField, Segmented, Toolbar } from "@/components/flipkart/kit";
import { DataTable, type Column } from "@/components/stock/data-table";
import { useToast } from "@/components/toast";
import { buttonClass, Chip, EmptyState, Stat, StatStrip } from "@/components/ui";
import { downloadCsv, toCsv } from "@/lib/csv";
import { formatDate, formatNumber } from "@/lib/format";
import { claimCounts, claimTicketHref, daysLeftChip, DEFAULT_CLAIM_FILTERS, filterClaims, type ClaimFilters, type ClaimRow } from "@/lib/return-claims";
import { markReturnChecked } from "@/server/actions/tickets";

const SOURCE_LABEL = { courier_return: "Courier return", customer_return: "Customer return" } as const;

/**
 * Flipkart › Returns › To claim (graphite-spec 12.2): completed returns from the last 30 days nobody has checked yet,
 * fewest days left first. "Looks fine" records the check and the row leaves the list; "Raise ticket" opens the new
 * ticket form with the return attached.
 */
export function ClaimsTab({
  rows: initialRows,
  checkedThisWeek,
  ready,
  warehouses,
  today,
}: {
  rows: ClaimRow[];
  checkedThisWeek: number;
  ready: boolean;
  warehouses: { id: string; name: string }[];
  today: string;
}) {
  const toast = useToast();
  const [done, setDone] = useState<Set<string>>(new Set());
  const [checked, setChecked] = useState(checkedThisWeek);
  const [filters, setFilters] = useState<ClaimFilters>(DEFAULT_CLAIM_FILTERS);
  const [pending, startTransition] = useTransition();
  const keyOf = (r: ClaimRow) => `${r.returnId}|${r.orderItemId}`;
  const rows = useMemo(() => initialRows.filter((r) => !done.has(keyOf(r))), [initialRows, done]);
  const counts = claimCounts(rows);
  const shown = filterClaims(rows, filters);
  const whName = new Map(warehouses.map((w) => [w.id, w.name]));

  const looksFine = (r: ClaimRow) =>
    startTransition(async () => {
      const result = await markReturnChecked(r.returnId, r.orderItemId);
      if (toast.result(result)) {
        setDone((s) => new Set(s).add(keyOf(r)));
        setChecked((n) => n + 1);
      }
    });

  const columns: Column<ClaimRow>[] = [
    {
      key: "days",
      label: "Days left",
      cell: (r) => {
        const c = daysLeftChip(r.daysLeft);
        return <Chip tone={c.tone}>{c.label}</Chip>;
      },
      csv: (r) => r.daysLeft,
    },
    { key: "returned", label: "Returned", cell: (r) => formatDate(r.returnedOn, today), csv: (r) => r.returnedOn },
    { key: "sku", label: "SKU", cell: (r) => (r.sku ? <span className="break-all font-mono text-[13px] font-medium">{r.sku}</span> : <span className="text-muted">—</span>), csv: (r) => r.sku },
    { key: "type", label: "Type", cell: (r) => SOURCE_LABEL[r.source], csv: (r) => SOURCE_LABEL[r.source] },
    { key: "reason", label: "Reason", cell: (r) => [r.reason, r.subReason].filter(Boolean).join(" · ").replaceAll("_", " ") || "—", csv: (r) => [r.reason, r.subReason].filter(Boolean).join(" · ") },
    { key: "qty", label: "Qty", align: "right", cell: (r) => <span className="tabular-nums">{formatNumber(r.quantity)}</span>, csv: (r) => r.quantity },
    { key: "wh", label: "Warehouse", cell: (r) => (r.warehouseId ? (whName.get(r.warehouseId) ?? "—") : "—"), csv: (r) => (r.warehouseId ? (whName.get(r.warehouseId) ?? "") : "") },
    { key: "order", label: "Order ID", cell: (r) => <span className="break-all font-mono text-xs">{r.orderId ?? "—"}</span>, csv: (r) => r.orderId },
    {
      key: "actions",
      label: "",
      screenOnly: true,
      cell: (r) => (
        <span className="flex flex-wrap justify-end gap-2">
          <button type="button" disabled={pending} onClick={() => looksFine(r)} className={buttonClass("row")}>
            Looks fine
          </button>
          <Link prefetch={false} href={claimTicketHref(r.sku, r.returnId, r.orderItemId)} className={buttonClass("primary", "!h-10 !min-h-10 !text-[12px]")}>
            Raise ticket
          </Link>
        </span>
      ),
      csv: () => null,
    },
  ];

  const csv = () => {
    const cols = columns.filter((c) => !c.screenOnly);
    downloadCsv(`returns-to-claim-${today}.csv`, toCsv(cols.map((c) => c.label), shown.map((r) => cols.map((c) => c.csv(r)))));
  };

  if (!ready) {
    return <EmptyState title="Returns to claim is not set up yet" body="It starts once migration 20261116091000_return_checks.sql is applied." />;
  }

  return (
    <>
      <StatStrip ariaLabel="Returns to claim" className="mb-4">
        <Stat label="To check" kind="returns" value={counts.toCheck} sub="0 or more days left" />
        <Stat label="Closing today or tomorrow" kind="time" value={counts.closing} tone={counts.closing > 0 ? "bad" : "ink"} sub="0 or 1 day left" />
        <Stat label="Missed" kind="returns" value={counts.missed} tone={counts.missed > 0 ? "bad" : "ink"} sub="the days to claim have passed" />
        <Stat label="Checked this week" kind="returns" value={checked} sub="since Monday" />
      </StatStrip>
      <Toolbar>
        <Segmented<ClaimFilters["view"]>
          label="Returns to check or missed"
          value={filters.view}
          onChange={(view) => setFilters({ ...filters, view })}
          options={[
            { key: "check", label: "To check", count: counts.toCheck },
            { key: "missed", label: "Missed", count: counts.missed },
          ]}
        />
        {warehouses.length > 1 ? (
          <Picker label="Warehouse" value={filters.wh} onChange={(wh) => setFilters({ ...filters, wh })} options={[{ value: "", label: "All" }, ...warehouses.map((w) => ({ value: w.id, label: w.name }))]} />
        ) : null}
        <Picker
          label="Type"
          value={filters.source}
          onChange={(v) => setFilters({ ...filters, source: v as ClaimFilters["source"] })}
          options={[
            { value: "", label: "All" },
            { value: "courier_return", label: "Courier" },
            { value: "customer_return", label: "Customer" },
          ]}
        />
        <SearchField value={filters.q} onChange={(q) => setFilters({ ...filters, q })} placeholder="Search SKU, order or reason" />
        <CsvButton onClick={csv} disabled={!shown.length} />
      </Toolbar>
      {shown.length ? (
        <DataTable columns={columns} rows={shown} sortKey="days" sortDir="asc" onSort={() => undefined} rowKey={keyOf} />
      ) : (
        <EmptyState title={filters.view === "missed" ? "No missed returns" : "Nothing to check"} body="Completed returns from the last 30 days show here until someone checks them." />
      )}
    </>
  );
}
