"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { CsvButton, Picker, SearchField, Segmented, Toolbar } from "@/components/flipkart/kit";
import { ChevronDownIcon } from "@/components/icons";
import { DataTable, type Column } from "@/components/stock/data-table";
import { useToast } from "@/components/toast";
import { buttonClass, Chip, EmptyState, SectionHead, Stat, StatStrip } from "@/components/ui";
import { downloadCsv, toCsv } from "@/lib/csv";
import { formatDate, formatNumber } from "@/lib/format";
import {
  claimCounts,
  claimTicketHref,
  daysLeftChip,
  DEFAULT_CLAIM_FILTERS,
  filterClaims,
  groupClaims,
  groupLabel,
  skusInGroup,
  type ClaimFilters,
  type ClaimGroup,
  type ClaimRow,
} from "@/lib/return-claims";
import { markReturnChecked } from "@/server/actions/tickets";

const SOURCE_LABEL = { courier_return: "Courier return (RTO)", customer_return: "Customer return" } as const;
const reasonText = (r: ClaimRow) => [r.reason, r.subReason].filter(Boolean).join(" · ").replaceAll("_", " ") || "—";
const keyOf = (r: ClaimRow) => `${r.returnId}|${r.orderItemId}`;

/**
 * Flipkart › Returns › To claim: completed returns that may need a claim, grouped by reason. The tab opens on one card
 * per reason; a reason lists every SKU with it, most returns first; a SKU opens to its returns, each with "Looks fine"
 * (records the check, the row leaves the list) and "Raise ticket" (the new ticket form with the return attached).
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
  const [group, setGroup] = useState<ClaimGroup | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const rows = useMemo(() => initialRows.filter((r) => !done.has(keyOf(r))), [initialRows, done]);
  const counts = claimCounts(rows);
  const shown = filterClaims(rows, filters);
  const groups = groupClaims(shown);
  const current = group ? groups.find((g) => g.key === group) ?? null : null;
  const skus = group ? skusInGroup(shown, group) : [];
  const whName = new Map(warehouses.map((w) => [w.id, w.name]));
  const nameOf = (id: string | null) => (id ? (whName.get(id) ?? "—") : "—");

  const toggle = (k: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

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
    { key: "type", label: "Type", cell: (r) => SOURCE_LABEL[r.source], csv: (r) => SOURCE_LABEL[r.source] },
    {
      key: "reason",
      label: "Flipkart's reason",
      cell: (r) => (
        <span className="text-xs">
          {reasonText(r)}
          {r.flagged ? (
            <span className="ml-2">
              <Chip tone="warn">Marked: {groupLabel(r.group)}</Chip>
            </span>
          ) : null}
        </span>
      ),
      csv: (r) => reasonText(r),
    },
    { key: "qty", label: "Qty", align: "right", cell: (r) => <span className="tabular-nums">{formatNumber(r.quantity)}</span>, csv: (r) => r.quantity },
    { key: "wh", label: "Warehouse", cell: (r) => nameOf(r.warehouseId), csv: (r) => (r.warehouseId ? (whName.get(r.warehouseId) ?? "") : "") },
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

  // The CSV holds what is on screen: the open reason's returns, or every reason's.
  const csv = () => {
    const list = group ? shown.filter((r) => r.group === group) : shown;
    const header = ["Reason group", "SKU", "Title", ...columns.filter((c) => !c.screenOnly).map((c) => c.label)];
    const body = list.map((r) => [groupLabel(r.group), r.sku, r.title, ...columns.filter((c) => !c.screenOnly).map((c) => c.csv(r))]);
    downloadCsv(`returns-to-claim${group ? `-${group}` : ""}-${today}.csv`, toCsv(header, body));
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
        <SearchField value={filters.q} onChange={(q) => setFilters({ ...filters, q })} placeholder="Search SKU, title, order or reason" />
        <CsvButton onClick={csv} disabled={!shown.length} />
      </Toolbar>

      {!shown.length ? (
        <EmptyState
          title={filters.view === "missed" ? "No missed returns" : "Nothing to check"}
          body="Returns whose reason points at a claim (wrong item, damaged, missing, used, quality, an RTO that came back damaged), and any marked “Needs claim”, show here until someone checks them."
        />
      ) : !group || !current ? (
        <ul className="grid grid-cols-1 gap-[14px] sm:grid-cols-2 xl:grid-cols-4" aria-label="Reasons">
          {groups.map((g) => (
            <li key={g.key}>
              <button
                type="button"
                onClick={() => {
                  setGroup(g.key);
                  setOpen(new Set());
                }}
                className="sp-card focus-ring flex h-full w-full flex-col gap-1 p-4 text-left transition-colors hover:bg-[var(--row-hover)]"
              >
                <span className="t-card-title">{g.label}</span>
                <span className="t-caption text-muted">{g.hint}</span>
                <span className="t-stat mt-2 font-display tabular-nums">{formatNumber(g.returns)}</span>
                <span className="text-xs text-muted">
                  {g.returns === 1 ? "return" : "returns"} · {formatNumber(g.units)} {g.units === 1 ? "unit" : "units"} · {formatNumber(g.skus)} {g.skus === 1 ? "SKU" : "SKUs"}
                </span>
                {g.closing || g.flagged ? (
                  <span className="mt-2 flex flex-wrap gap-1">
                    {g.closing ? <Chip tone="bad">{formatNumber(g.closing)} closing soon</Chip> : null}
                    {g.flagged ? <Chip tone="warn">{formatNumber(g.flagged)} marked by the team</Chip> : null}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <button type="button" onClick={() => setGroup(null)} className={buttonClass("ghost", "mb-2 !px-0")}>
            ← All reasons
          </button>
          <SectionHead
            title={current.label}
            sub={`${formatNumber(current.returns)} ${current.returns === 1 ? "return" : "returns"} across ${formatNumber(current.skus)} ${current.skus === 1 ? "SKU" : "SKUs"}, most returns first. Open a SKU to check its returns.`}
            className="mb-3"
          />
          <ul className="sp-card ledger-card divide-y divide-line-soft" aria-label={`SKUs with ${current.label}`}>
            {skus.map((s) => {
              const k = s.sku ?? "";
              const expanded = open.has(k);
              const chip = daysLeftChip(s.soonest);
              return (
                <li key={k}>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => toggle(k)}
                    className="focus-ring grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-3 py-2.5 text-left transition-colors hover:bg-[var(--row-hover)] sm:px-4 lg:grid-cols-[minmax(0,1.6fr)_7rem_6rem_minmax(0,1fr)_7.5rem]"
                  >
                    <span className="min-w-0">
                      <span className="block break-all font-mono text-[13px] font-medium">{s.sku ?? "SKU not known"}</span>
                      {s.title ? <span className="block truncate text-xs text-muted">{s.title}</span> : null}
                    </span>
                    <span className="flex shrink-0 items-center justify-end gap-1 lg:order-last">
                      <Chip tone={chip.tone}>{s.soonest < 0 ? chip.label : s.soonest === 0 ? "Closes today" : `${chip.label} left`}</Chip>
                      <ChevronDownIcon className={`h-4 w-4 text-muted transition-transform ${expanded ? "rotate-180" : ""}`} />
                    </span>
                    <span className="text-[13px] font-semibold tabular-nums">
                      {formatNumber(s.returns)} {s.returns === 1 ? "return" : "returns"}
                    </span>
                    <span className="text-xs tabular-nums text-muted">
                      {formatNumber(s.units)} {s.units === 1 ? "unit" : "units"}
                    </span>
                    <span className="col-span-2 flex flex-wrap gap-1 lg:col-span-1">
                      {s.warehouseIds.map((id) => (
                        <Chip key={id}>{nameOf(id)}</Chip>
                      ))}
                    </span>
                  </button>
                  {expanded ? (
                    <div className="border-t border-line-soft bg-surface2 px-3 py-3 sm:px-4">
                      <DataTable columns={columns} rows={s.rows} sortKey="days" sortDir="asc" onSort={() => undefined} rowKey={keyOf} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}
