"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Column } from "@/components/stock/data-table";
import { ChipFilter, ListView } from "@/components/flipkart/list-view";
import { Chip } from "@/components/ui";
import { HEALTH_KEYS, HEALTH_LABEL, type HealthProblem, type HealthRow } from "@/lib/flipkart-analysis";

type Filter = "all" | HealthProblem;

export function HealthTab({ rows, total, taxUnread, slaLimit }: { rows: HealthRow[]; total: number; taxUnread: number; slaLimit: number }) {
  const [filter, setFilter] = useState<Filter>("all");
  // Inactive listings are shown by default here: a space in the SKU or a missing HSN is worth fixing before it is relisted.
  const [hideInactive, setHideInactive] = useState(false);

  const visible = useMemo(() => (hideInactive ? rows.filter((r) => r.status === "ACTIVE") : rows), [rows, hideInactive]);
  const shown = useMemo(() => (filter === "all" ? visible : visible.filter((r) => r.problems.includes(filter))), [visible, filter]);

  const columns: Column<HealthRow>[] = [
    {
      key: "sku",
      label: "SKU",
      sort: (r) => r.sku,
      cell: (r) => (
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            {/* A space at the start or end is the problem, so show it. */}
            <span className="break-all font-mono text-[13px] font-bold leading-tight">{r.problems.includes("sku_space") ? `"${r.sku}"` : r.sku}</span>
            {r.status === "INACTIVE" ? <Chip>Inactive</Chip> : null}
            {r.listingPost ? (
              <Link prefetch={false} href={`/posts/${r.listingPost.id}`} className="focus-ring rounded font-mono text-xs font-semibold text-accent-text underline">
                VR-{r.listingPost.number}
              </Link>
            ) : null}
          </div>
          {r.title ? <p className="mt-0.5 line-clamp-2 break-words text-xs leading-snug text-muted">{r.title}</p> : null}
        </div>
      ),
      csv: (r) => r.sku,
    },
    { key: "title", label: "Title", csvOnly: true, cell: () => null, csv: (r) => r.title },
    {
      key: "problems",
      label: "Problems",
      sort: (r) => r.problems.length,
      cell: (r) => (
        <div className="flex min-w-48 flex-wrap gap-1">
          {r.problems.map((p) => (
            <Chip key={p} tone={p === "slow_dispatch" ? "warn" : "bad"}>
              {p === "slow_dispatch" && r.dispatchSla !== null
                ? `Dispatch SLA ${r.dispatchSla} days`
                : p === "over_weight" && r.listingPost
                  ? `Over the weight limit: ${Math.round(r.listingPost.total).toLocaleString("en-IN")}`
                  : HEALTH_LABEL[p]}
            </Chip>
          ))}
        </div>
      ),
      csv: (r) => r.problems.map((p) => HEALTH_LABEL[p]).join("; "),
    },
    { key: "sla", label: "Dispatch SLA (days)", align: "right", sort: (r) => r.dispatchSla, cell: (r) => (r.dispatchSla === null ? "—" : r.dispatchSla), csv: (r) => r.dispatchSla },
    { key: "hsn", label: "HSN", sort: (r) => r.hsn, cell: (r) => r.hsn ?? <span className="text-muted">—</span>, csv: (r) => r.hsn },
    { key: "tax", label: "Tax code", sort: (r) => r.taxCode, cell: (r) => r.taxCode ?? <span className="text-muted">—</span>, csv: (r) => r.taxCode },
  ];

  return (
    <ListView
      rows={shown}
      columns={columns}
      rowKey={(r) => r.sku}
      defaultSort={{ key: "problems", dir: "desc" }}
      textKeys={["sku", "hsn", "tax"]}
      searchText={(r) => `${r.sku} ${r.title ?? ""}`}
      searchLabel="Search SKU or title"
      csvName="vrprime-listing-health.csv"
      noun={["SKU with a problem", "SKUs with problems"]}
      controls={
        <>
          <ChipFilter<Filter>
            label="Problem type"
            value={filter}
            onChange={setFilter}
            options={[
              { key: "all", label: "All problems", count: visible.length },
              ...HEALTH_KEYS.map((k) => ({ key: k as Filter, label: HEALTH_LABEL[k], count: visible.filter((r) => r.problems.includes(k)).length })),
            ]}
          />
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
            <input type="checkbox" className="h-5 w-5 accent-(--accent)" checked={hideInactive} onChange={(e) => setHideInactive(e.target.checked)} />
            Hide inactive listings
          </label>
        </>
      }
      note={
        <>
          <p className="text-xs text-muted">
            {formatTotals(total, rows.length)} A dispatch SLA over {slaLimit} days is flagged (owner can change this in Settings).
          </p>
          {taxUnread > 0 ? <p className="text-xs font-semibold text-info">HSN and tax codes have not been read for {taxUnread} listings yet. They are read by the next stock sync, so they are not flagged as missing until then.</p> : null}
        </>
      }
      emptyTitle="No listing problems"
      emptyBody="Every listing has a size, a weight, a normal dispatch SLA, a clean SKU and tax details."
    />
  );
}

function formatTotals(total: number, withProblems: number): string {
  return `${withProblems} of ${total} listings have at least one problem.`;
}
