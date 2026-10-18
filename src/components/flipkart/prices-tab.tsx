"use client";

import { useMemo, useState } from "react";
import type { Column } from "@/components/stock/data-table";
import { ChipFilter, ListView } from "@/components/flipkart/list-view";
import { Chip } from "@/components/ui";
import { formatDate, formatNumber } from "@/lib/format";
import { PRICE_FLAG_LABEL, type PriceChange, type PriceFlag, type PriceRow } from "@/lib/flipkart-analysis";

type Filter = "all" | "flagged" | PriceFlag;

const rupees = (n: number | null) => (n === null ? "—" : `₹${formatNumber(Math.round(n * 100) / 100)}`);

function changeText(c: PriceChange): string {
  const parts: string[] = [];
  if (c.oldSelling !== c.newSelling) parts.push(`selling ${rupees(c.oldSelling)} → ${rupees(c.newSelling)}`);
  if (c.oldMrp !== c.newMrp) parts.push(`MRP ${rupees(c.oldMrp)} → ${rupees(c.newMrp)}`);
  return parts.join(", ");
}

export function PricesTab({ rows, today, dropLimit, snapshotDate }: { rows: PriceRow[]; today: string; dropLimit: number; snapshotDate: string | null }) {
  const [filter, setFilter] = useState<Filter>("flagged");
  const [hideInactive, setHideInactive] = useState(true);

  const visible = useMemo(() => (hideInactive ? rows.filter((r) => r.status === "ACTIVE") : rows), [rows, hideInactive]);
  const count = (flag: PriceFlag) => visible.filter((r) => r.flags.includes(flag)).length;
  const shown = useMemo(
    () => visible.filter((r) => (filter === "all" ? true : filter === "flagged" ? r.flags.length > 0 : r.flags.includes(filter))),
    [visible, filter],
  );

  const columns: Column<PriceRow>[] = [
    {
      key: "sku",
      label: "SKU",
      sort: (r) => r.sku,
      cell: (r) => (
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="break-all font-mono text-[13px] font-bold leading-tight">{r.sku}</span>
            {r.status === "INACTIVE" ? <Chip>Inactive</Chip> : null}
          </div>
          {r.title ? <p className="mt-0.5 line-clamp-2 break-words text-xs leading-snug text-muted">{r.title}</p> : null}
        </div>
      ),
      csv: (r) => r.sku,
    },
    { key: "title", label: "Title", csvOnly: true, cell: () => null, csv: (r) => r.title },
    { key: "selling", label: "Selling price", align: "right", sort: (r) => r.sellingPrice, cell: (r) => rupees(r.sellingPrice), csv: (r) => r.sellingPrice },
    { key: "mrp", label: "MRP", align: "right", sort: (r) => r.mrp, cell: (r) => rupees(r.mrp), csv: (r) => r.mrp },
    { key: "discount", label: "Discount", align: "right", sort: (r) => r.discountPct, cell: (r) => (r.discountPct === null ? "—" : `${r.discountPct}%`), csv: (r) => r.discountPct, minor: true },
    {
      key: "flags",
      label: "Problem",
      sort: (r) => r.flags.length,
      cell: (r) =>
        r.flags.length ? (
          // A long flag ("Selling price at or above MRP") wraps instead of pushing a phone card past the screen edge.
          <div className="flex min-w-36 max-w-full flex-wrap gap-1 [&>span]:max-w-full [&>span]:whitespace-normal">

            {r.flags.map((f) => (
              <Chip key={f} tone={f === "over_mrp" ? "warn" : "bad"}>
                {f === "big_drop" ? `Dropped ${r.dropPct}%` : PRICE_FLAG_LABEL[f]}
              </Chip>
            ))}
          </div>
        ) : (
          <span className="text-muted">—</span>
        ),
      csv: (r) => r.flags.map((f) => PRICE_FLAG_LABEL[f]).join("; "),
    },
    {
      key: "last",
      label: "Last change",
      sort: (r) => r.lastChange?.date ?? null,
      cell: (r) =>
        r.lastChange ? (
          <details className="min-w-44 text-xs">
            <summary className="cursor-pointer font-semibold">
              {formatDate(r.lastChange.date, today)}: {changeText(r.lastChange) || "no price change"}
              {r.changes.length > 1 ? ` (+${r.changes.length - 1} earlier)` : ""}
            </summary>
            <ul className="mt-1 flex flex-col gap-0.5 text-muted">
              {r.changes.slice(0, 12).map((c) => (
                <li key={c.date}>
                  {formatDate(c.date, today)}: {changeText(c)}
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <span className="text-muted">No change recorded</span>
        ),
      csv: (r) => (r.lastChange ? `${r.lastChange.date}: ${changeText(r.lastChange)}` : null),
    },
    { key: "changes", label: "Changes", align: "right", sort: (r) => r.changes.length, cell: (r) => formatNumber(r.changes.length), csv: (r) => r.changes.length, minor: true },
  ];

  return (
    <ListView
      rows={shown}
      columns={columns}
      rowKey={(r) => r.sku}
      defaultSort={{ key: "flags", dir: "desc" }}
      textKeys={["sku"]}
      searchText={(r) => `${r.sku} ${r.title ?? ""}`}
      searchLabel="Search SKU or title"
      csvName={`vrprime-prices-${snapshotDate ?? "latest"}.csv`}
      noun={["SKU", "SKUs"]}
      controls={
        <>
          <ChipFilter<Filter>
            label="Price problems"
            value={filter}
            onChange={setFilter}
            options={[
              { key: "flagged", label: "Any problem", count: visible.filter((r) => r.flags.length > 0).length },
              { key: "over_mrp", label: "At or above MRP", count: count("over_mrp") },
              { key: "big_drop", label: "Big drop", count: count("big_drop") },
              { key: "missing", label: "Missing", count: count("missing") },
              { key: "all", label: "All SKUs", count: visible.length },
            ]}
          />
          <label className="flex min-h-11 items-center gap-2 whitespace-nowrap rounded-lg border border-line bg-surface px-3 text-sm font-semibold sm:min-h-9">
            <input type="checkbox" className="h-4 w-4 accent-(--accent)" checked={hideInactive} onChange={(e) => setHideInactive(e.target.checked)} />
            Hide inactive listings
          </label>
        </>
      }
      note={
        <p className="text-xs text-muted">
          Prices are read every morning with the stock sync. “At or above MRP” includes SKUs priced exactly at MRP. A drop is flagged when the selling price fell by more than {dropLimit}% overnight (owner can change this in Settings).
        </p>
      }
      emptyTitle={filter === "all" ? "No listings" : "No price problems"}
      emptyBody="Every active listing has a selling price below its MRP, with no large overnight drop."
    />
  );
}
