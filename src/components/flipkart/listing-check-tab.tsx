"use client";

import { useState } from "react";
import { Segmented, Toolbar } from "@/components/flipkart/kit";
import { DataTable, type Column } from "@/components/stock/data-table";
import { buttonClass, Chip, EmptyState, Stat, StatStrip } from "@/components/ui";
import { formatDate, formatINR } from "@/lib/format";
import { checkCounts, isProblem, priceDiffers, STATUS_LABEL, STATUS_TONE, type CheckRow } from "@/lib/listing-view";

/** The Review tracker's priority names: P1…P7, "Last" from 8, "—" when none. */
const priorityName = (p: number | null) => (p == null || p === 0 ? "—" : p >= 8 ? "Last" : `P${p}`);
const rs = (n: number | null) => (n === null ? "—" : formatINR(n));

/**
 * Flipkart › Listings › Listing check (graphite-spec 12.3): what the PC read on each Review tracker link this morning,
 * problems first.
 */
export function ListingCheckTab({ rows, checkedOn, ready, today }: { rows: CheckRow[]; checkedOn: string | null; ready: boolean; today: string }) {
  const [view, setView] = useState<"problems" | "all">("problems");
  if (!ready) return <EmptyState title="The Listing check is not set up yet" body="It starts once migration 20261116092000_listing_check.sql is applied." />;
  if (!checkedOn) return <EmptyState title="No check yet. Install the PC task to start." body="Run scripts\install-listing-check.ps1 on the PC; it reads every link each morning at 9:15." />;
  const counts = checkCounts(rows);
  const problems = rows.filter(isProblem);
  const shown = view === "problems" ? problems : rows;
  const columns: Column<CheckRow>[] = [
    { key: "product", label: "Product", cell: (r) => <span className="font-medium">{r.product}</span>, csv: (r) => r.product },
    { key: "platform", label: "Platform", cell: (r) => r.platform, csv: (r) => r.platform },
    { key: "priority", label: "Priority", cell: (r) => <span className="tabular-nums">{priorityName(r.priority)}</span>, csv: (r) => priorityName(r.priority) },
    { key: "status", label: "Status", cell: (r) => <Chip tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Chip>, csv: (r) => STATUS_LABEL[r.status] },
    { key: "price", label: "Price on page", align: "right", cell: (r) => <span className="tabular-nums">{rs(r.price)}</span>, csv: (r) => r.price },
    { key: "ours", label: "Our price", align: "right", cell: (r) => <span className="tabular-nums">{rs(r.expectedPrice)}</span>, csv: (r) => r.expectedPrice },
    { key: "differs", label: "", cell: (r) => (priceDiffers(r) ? <Chip tone="warn">Differs</Chip> : null), csv: (r) => (priceDiffers(r) ? "Differs" : "") },
    {
      key: "open",
      label: "",
      screenOnly: true,
      cell: (r) =>
        r.url ? (
          <a href={r.url} target="_blank" rel="noopener noreferrer" className={buttonClass("row")}>
            Open
          </a>
        ) : null,
      csv: () => null,
    },
  ];
  return (
    <>
      <StatStrip ariaLabel="Listing check" className="mb-2">
        <Stat label="Buyable" kind="orders" value={counts.buyable} />
        <Stat label="Out of stock" kind="stock-alert" value={counts.outOfStock} tone={counts.outOfStock > 0 ? "warn" : "ink"} />
        <Stat label="Unavailable" kind="stock-alert" value={counts.unavailable} tone={counts.unavailable > 0 ? "bad" : "ink"} />
        <Stat label="Price differs" kind="stock-alert" value={counts.differs} tone={counts.differs > 0 ? "warn" : "ink"} />
        <Stat label="Not read" kind="time" value={counts.notRead} />
      </StatStrip>
      <p className="t-caption mb-4">Read on the PC each morning · last read {formatDate(checkedOn, today)}</p>
      <Toolbar>
        <Segmented<"problems" | "all">
          label="Problems or every link"
          value={view}
          onChange={setView}
          options={[
            { key: "problems", label: "Problems", count: problems.length },
            { key: "all", label: "All", count: rows.length },
          ]}
        />
      </Toolbar>
      {shown.length ? (
        <DataTable columns={columns} rows={shown} sortKey="" sortDir="asc" onSort={() => undefined} rowKey={(r) => String(r.rowNo)} />
      ) : (
        <EmptyState title="No problems" body="Every link could be bought at our price this morning." />
      )}
    </>
  );
}
