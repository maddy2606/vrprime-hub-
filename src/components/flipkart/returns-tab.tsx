"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { SearchIcon } from "@/components/icons";
import { ChipFilter, ListView } from "@/components/flipkart/list-view";
import { OrdersSyncBar } from "@/components/flipkart/orders-sync-bar";
import { DataTable, type Column } from "@/components/stock/data-table";
import { Chip, EmptyState } from "@/components/ui";
import { formatDate, formatNumber } from "@/lib/format";
import { ticketHref, type ReturnRate } from "@/lib/flipkart-analysis";
import type { OrderSyncState } from "@/lib/orders-sync";
import { RETURNS_PAGE_SIZE, type ReturnLine, type ReturnsPage, type ReturnsQuery, type ReturnsSummary, defaultReturnsQuery } from "@/lib/returns-view";
import { loadReturnsAction } from "@/server/actions/returns-view";

type View = "list" | "rates";
type Source = ReturnsQuery["source"];

type Props = {
  /** The first page, read on the server. */
  initialPage: ReturnsPage;
  initialSummary: ReturnsSummary;
  rates: ReturnRate[];
  historyReady: boolean;
  rateLimit: number;
  warehouses: { id: string; name: string }[];
  state: OrderSyncState;
  canSync: boolean;
  today: string;
};

const SOURCE_LABEL = { courier_return: "Courier return", customer_return: "Customer return" } as const;
const TEXT_KEYS = new Set(["sku", "type", "reason", "status", "order"]);
const sortable = () => null;

function TicketLink({ sku }: { sku: string | null }) {
  return (
    <Link prefetch={false} href={ticketHref(sku, "wrong_return")} className="focus-ring inline-flex min-h-9 items-center whitespace-nowrap rounded-lg px-2 text-xs font-bold text-accent-text hover:bg-accent-soft">
      Raise ticket
    </Link>
  );
}

function exportHref(q: ReturnsQuery): string {
  const params = new URLSearchParams({ source: q.source, sort: q.sort, dir: q.dir });
  if (q.wh) params.set("wh", q.wh);
  if (q.q) params.set("q", q.q);
  return `/flipkart/returns-export?${params.toString()}`;
}

export function ReturnsTab({ initialPage, initialSummary, rates, historyReady, rateLimit, warehouses, state, canSync, today }: Props) {
  const [view, setView] = useState<View>("list");
  const [query, setQuery] = useState<ReturnsQuery>(defaultReturnsQuery());
  const [qInput, setQInput] = useState("");
  const [page, setPage] = useState<ReturnsPage>(initialPage);
  const [summary, setSummary] = useState<ReturnsSummary>(initialSummary);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const request = useRef(0);
  const first = useRef(true);

  const load = useCallback((q: ReturnsQuery, append: boolean) => {
    const id = ++request.current;
    setLoading(true);
    setFailed(false);
    void loadReturnsAction(q).then((result) => {
      if (id !== request.current) return; // a newer request has taken over
      setLoading(false);
      if (!result.ok || !result.data) {
        setFailed(true);
        return;
      }
      const { summary: next, ...data } = result.data;
      if (next) setSummary(next);
      setPage((prev) => (append ? { total: data.total, rows: [...prev.rows, ...data.rows] } : data));
    });
  }, []);

  // A new filter, search or sort starts again from the first page.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    load({ ...query, offset: 0 }, false);
  }, [query, load]);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery((q) => (q.q === qInput.trim() ? q : { ...q, q: qInput.trim(), offset: 0 })), 300);
    return () => window.clearTimeout(timer);
  }, [qInput]);

  const patch = (p: Partial<ReturnsQuery>) => setQuery((q) => ({ ...q, ...p, offset: 0 }));
  const onSort = (key: string) => setQuery((q) => ({ ...q, offset: 0, sort: key, dir: q.sort === key ? (q.dir === "asc" ? "desc" : "asc") : TEXT_KEYS.has(key) ? "asc" : "desc" }));
  const more = () => load({ ...query, offset: page.rows.length }, true);
  const nameOf = (id: string | null) => warehouses.find((w) => w.id === id)?.name ?? "Unknown";

  const columns: Column<ReturnLine>[] = [
    { key: "date", label: "Created", sort: sortable, cell: (r) => <span className="whitespace-nowrap">{r.created_date ? formatDate(r.created_date, today) : "—"}</span>, csv: () => null },
    { key: "sku", label: "SKU", sort: sortable, cell: (r) => (r.sku ? <span className="break-all font-mono text-[13px] font-bold">{r.sku}</span> : <span className="text-xs text-muted">Not known (older order)</span>), csv: () => null },
    { key: "type", label: "Type", sort: sortable, cell: (r) => <Chip tone={r.source === "courier_return" ? "warn" : "info"}>{SOURCE_LABEL[r.source]}</Chip>, csv: () => null },
    { key: "reason", label: "Reason", sort: sortable, cell: (r) => <span className="text-xs">{[r.reason, r.sub_reason].filter(Boolean).join(" · ").replaceAll("_", " ") || "—"}</span>, csv: () => null },
    { key: "qty", label: "Qty", align: "right", sort: sortable, cell: (r) => formatNumber(r.quantity), csv: () => null },
    { key: "wh", label: "Warehouse", cell: (r) => nameOf(r.warehouse_id), csv: () => null },
    { key: "status", label: "Status", sort: sortable, cell: (r) => <span className="text-xs capitalize">{(r.return_status ?? "—").replaceAll("_", " ")}</span>, csv: () => null },
    { key: "order", label: "Order ID", sort: sortable, cell: (r) => <span className="break-all font-mono text-xs">{r.order_id ?? "—"}</span>, csv: () => null },
    { key: "ticket", label: "", screenOnly: true, cell: (r) => <TicketLink sku={r.sku} />, csv: () => null },
  ];

  const rateColumns: Column<ReturnRate>[] = [
    { key: "sku", label: "SKU", sort: (r) => r.sku, cell: (r) => <span className="break-all font-mono text-[13px] font-bold">{r.sku}</span>, csv: (r) => r.sku },
    { key: "rate", label: "Return rate", align: "right", sort: (r) => r.ratePct, cell: (r) => (r.ratePct === null ? <span className="text-muted">—</span> : <span className={r.flagged ? "font-bold text-bad" : ""}>{r.ratePct}%</span>), csv: (r) => r.ratePct },
    { key: "returned", label: "Returned", align: "right", sort: (r) => r.returned, cell: (r) => formatNumber(r.returned), csv: (r) => r.returned },
    { key: "sold", label: "Sold (30 days)", align: "right", sort: (r) => r.sold, cell: (r) => formatNumber(r.sold), csv: (r) => r.sold },
    { key: "flag", label: "", cell: (r) => (r.flagged ? <Chip tone="bad">Above {rateLimit}%</Chip> : null), csv: (r) => (r.flagged ? "above limit" : "") },
    { key: "ticket", label: "", screenOnly: true, cell: (r) => (r.flagged ? <TicketLink sku={r.sku} /> : null), csv: () => null },
  ];

  const units = summary.courier_units + summary.customer_units;
  const lines = summary.courier_lines + summary.customer_lines;

  return (
    <>
      <OrdersSyncBar state={state} canSync={canSync} kind="daily" today={today} />

      {!historyReady ? (
        <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-xs font-semibold text-warn">
          Only returns that changed in the last few days are loaded so far. The full 30 days arrive when the nightly load finishes, so the counts below are low until then.
        </p>
      ) : null}

      <div className="mb-4 grid grid-cols-3 gap-2">
        {[
          { label: "Returns, 30 days", value: formatNumber(units), sub: `${formatNumber(lines)} lines` },
          { label: "Courier returns", value: formatNumber(summary.courier_units), sub: "came back undelivered" },
          { label: "Customer returns", value: formatNumber(summary.customer_units), sub: "sent back by the buyer" },
        ].map((t) => (
          <div key={t.label} className="min-w-0 rounded-xl border border-line bg-surface p-3">
            <span className="block text-xs font-bold leading-tight text-muted">{t.label}</span>
            <span className="mt-1 block text-2xl font-extrabold leading-none tracking-tight">{t.value}</span>
            <span className="mt-1 block text-xs font-semibold text-muted">{t.sub}</span>
          </div>
        ))}
      </div>

      <div className="mb-3">
        <ChipFilter<View>
          label="Returns lists"
          value={view}
          onChange={setView}
          options={[
            { key: "list", label: "All returns", count: summary.courier_lines + summary.customer_lines },
            { key: "rates", label: "Return rate by SKU", count: rates.filter((r) => r.flagged).length },
          ]}
        />
      </div>

      {view === "list" ? (
        <>
          <div className="mb-3 flex flex-col gap-2">
            <ChipFilter<Source>
              label="Kind of return"
              value={query.source}
              onChange={(source) => patch({ source })}
              options={[
                { key: "all", label: "All", count: summary.courier_lines + summary.customer_lines },
                { key: "courier_return", label: "Courier", count: summary.courier_lines },
                { key: "customer_return", label: "Customer", count: summary.customer_lines },
              ]}
            />
            {warehouses.length > 1 ? (
              <div>
                <label htmlFor="returns-wh" className="sr-only">Warehouse</label>
                <select id="returns-wh" className="input max-w-60" value={query.wh} onChange={(e) => patch({ wh: e.target.value })}>
                  <option value="">All warehouses</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-52 flex-1">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
                <label htmlFor="returns-search" className="sr-only">Search SKU, order ID or reason</label>
                <input id="returns-search" type="search" className="input pl-10" placeholder="Search SKU, order ID or reason" value={qInput} onChange={(e) => setQInput(e.target.value)} autoComplete="off" />
              </div>
              <a href={exportHref(query)} download className="focus-ring inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-bold hover:bg-surface2">
                Download CSV
              </a>
            </div>
            <p className="text-xs text-muted">
              {formatNumber(page.total)} {page.total === 1 ? "return" : "returns"}
              {query.wh ? ` · ${nameOf(query.wh)} only` : ""}
            </p>
            {failed ? (
              <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm font-semibold text-bad">
                Could not load this list. Check your connection and try again.
              </p>
            ) : null}
          </div>
          {page.rows.length === 0 ? (
            <EmptyState title={query.q ? "Nothing matches your search" : "No returns"} body={query.q ? "Try a shorter part of the text, or clear the search." : "No returns in the last 30 days, or the daily read has not covered them yet."} />
          ) : (
            <>
              <div className={loading ? "opacity-60 transition" : "transition"}>
                <DataTable columns={columns} rows={page.rows} sortKey={query.sort} sortDir={query.dir} onSort={onSort} rowKey={(r) => `${r.return_id}|${r.order_item_id}`} />
              </div>
              {page.rows.length < page.total ? (
                <button type="button" onClick={more} disabled={loading} className="focus-ring mt-2 min-h-11 w-full rounded-lg border border-line bg-surface px-4 text-sm font-bold hover:bg-surface2 disabled:opacity-60">
                  {loading ? "Loading…" : `Show ${formatNumber(Math.min(RETURNS_PAGE_SIZE, page.total - page.rows.length))} more (${formatNumber(page.total - page.rows.length)} not shown; the CSV has all of them)`}
                </button>
              ) : null}
            </>
          )}
        </>
      ) : (
        <ListView
          key="rates"
          rows={rates}
          columns={rateColumns}
          rowKey={(r) => r.sku}
          defaultSort={{ key: historyReady ? "rate" : "returned", dir: "desc" }}
          textKeys={["sku"]}
          searchText={(r) => r.sku}
          searchLabel="Search SKU"
          csvName="vrprime-return-rates.csv"
          noun={["SKU", "SKUs"]}
          note={
            <p className="text-xs text-muted">
              {historyReady
                ? `Return rate = units returned ÷ units sold in the last 30 days. Flagged above ${rateLimit}% once at least 10 units were sold.`
                : "Rates need 30 days of shipped orders, which are still being loaded at night. Returns are already counted."}
            </p>
          }
          emptyTitle="No data yet"
          emptyBody="There are no returns or shipped orders to work out rates from."
        />
      )}
    </>
  );
}
