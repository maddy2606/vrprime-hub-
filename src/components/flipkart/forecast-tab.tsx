"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChipFilter, ListView } from "@/components/flipkart/list-view";
import type { Column } from "@/components/stock/data-table";
import { formatDate, formatNumber } from "@/lib/format";
import { buildRows, historyNote, topMovers, WINDOWS, type ForecastMeta, type ForecastRaw, type ForecastRow } from "@/lib/forecast";

type Props = {
  meta: ForecastMeta;
  raw: ForecastRaw[];
  warehouses: { id: string; name: string }[];
  /** The window asked for in the address. */
  window: number;
};

const n0 = (v: number) => formatNumber(Math.round(v));

export function ForecastTab({ meta, raw, warehouses, window }: Props) {
  const [split, setSplit] = useState(false);
  const [wh, setWh] = useState<string>("");
  const nameOf = (id: string | null) => warehouses.find((w) => w.id === id)?.name ?? "Unknown warehouse";

  const rows = useMemo(() => buildRows(raw, meta.days, split, wh || null), [raw, meta.days, split, wh]);
  const movers = useMemo(() => topMovers(buildRows(raw, meta.days, false), 5).filter((r) => r.f30 > 0), [raw, meta.days]);
  const note = historyNote(meta);

  const num = (key: string, label: string, value: (r: ForecastRow) => number, digits = 0): Column<ForecastRow> => ({
    key,
    label,
    align: "right",
    sort: value,
    cell: (r) => (digits ? value(r).toFixed(digits) : n0(value(r))),
    csv: (r) => (digits ? Math.round(value(r) * 10 ** digits) / 10 ** digits : value(r)),
  });

  const columns: Column<ForecastRow>[] = [
    {
      key: "sku",
      label: "SKU",
      sort: (r) => r.sku,
      cell: (r) => (
        <div className="min-w-0">
          <span className="break-all font-mono text-[13px] font-bold leading-tight">{r.sku}</span>
          {r.title ? <p className="mt-0.5 line-clamp-2 break-words text-xs leading-snug text-muted">{r.title}</p> : null}
          {split ? <p className="mt-0.5 text-xs font-semibold text-accent-text">{nameOf(r.wid)}</p> : null}
        </div>
      ),
      csv: (r) => r.sku,
    },
    { key: "title", label: "Title", csvOnly: true, cell: () => null, csv: (r) => r.title },
    { key: "wh", label: "Warehouse", csvOnly: true, cell: () => null, csv: (r) => (split ? nameOf(r.wid) : "All") },
    num("stock", "Stock now", (r) => r.stock),
    num("rate", "Avg dispatched / day", (r) => r.rate, 1),
    num("f1", "Forecast 1 day", (r) => r.f1),
    num("f7", "Forecast 7 days", (r) => r.f7),
    num("f30", "Forecast 30 days", (r) => r.f30),
    num("b1", "Booked 1 day", (r) => r.b1),
    num("b7", "Booked 7 days", (r) => r.b7),
    num("b30", "Booked 30 days", (r) => r.b30),
    {
      key: "cover",
      label: "Days of cover",
      align: "right",
      sort: (r) => r.cover,
      cell: (r) =>
        r.cover === null ? (
          <span className="text-muted">—</span>
        ) : (
          <span className={r.cover < 7 ? "font-bold text-bad" : ""}>{r.cover < 10 ? r.cover.toFixed(1) : n0(r.cover)}</span>
        ),
      csv: (r) => (r.cover === null ? null : Math.round(r.cover * 10) / 10),
    },
    { key: "disp", label: "Units dispatched in window", csvOnly: true, cell: () => null, csv: (r) => r.dispatched },
  ];

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="History window">
        <span className="text-sm font-semibold text-muted">Average of the last</span>
        {WINDOWS.map((d) => (
          <Link
            key={d}
            prefetch={false}
            href={d === 30 ? "/flipkart?tab=forecast" : `/flipkart?tab=forecast&days=${d}`}
            aria-current={window === d ? "true" : undefined}
            className={`focus-ring flex min-h-10 items-center rounded-full border px-3.5 text-sm font-bold ${
              window === d ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-muted hover:text-ink"
            }`}
          >
            {d} days
          </Link>
        ))}
      </div>
      <p className="mb-3 text-xs text-muted">
        By dispatch day, in units:{" "}
        {meta.days
          ? `${formatDate(meta.windowStart, meta.today)} to ${formatDate(meta.windowEnd, meta.today)} (${meta.days} complete days, today left out)`
          : "no history yet"}
        . <b>Forecast</b> = the average per day times 1, 7 or 30. <b>Booked</b> = units already scheduled to dispatch in the next 1, 7 or 30 days, counting from
        today. They are different things, so they are not added together.
        {meta.snapshot ? ` Stock as of ${formatDate(meta.snapshot, meta.today)}.` : ""}
      </p>
      {note ? (
        <p role="status" className="mb-3 rounded-lg bg-info-soft px-3 py-2 text-sm font-semibold text-info">
          {note}
        </p>
      ) : null}

      {movers.length ? (
        <div className="mb-3">
          <p className="mb-1 text-xs font-semibold text-muted">Top movers, 30-day forecast</p>
          <ul className="flex flex-wrap gap-1.5">
            {movers.map((m) => (
              <li key={m.sku} className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs">
                <span className="font-mono font-bold">{m.sku}</span> <span className="font-semibold tabular-nums">{n0(m.f30)}</span>
                <span className="text-muted"> · booked 7d {n0(m.b7)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ListView
        rows={rows}
        columns={columns}
        rowKey={(r) => r.key}
        defaultSort={{ key: "f30", dir: "desc" }}
        textKeys={["sku"]}
        searchText={(r) => `${r.sku} ${r.title ?? ""}`}
        searchLabel="Search SKU or title"
        csvName={`vrprime-forecast-${window}d.csv`}
        noun={split ? ["SKU at a warehouse", "SKUs at warehouses"] : ["SKU", "SKUs"]}
        controls={
          <div className="flex flex-col gap-2">
            <ChipFilter<"all" | "split">
              label="Warehouses"
              value={split ? "split" : "all"}
              onChange={(k) => setSplit(k === "split")}
              options={[
                { key: "all", label: "All warehouses together" },
                { key: "split", label: "Split by warehouse" },
              ]}
            />
            {warehouses.length > 1 ? (
              <label className="text-xs font-semibold text-muted">
                Only
                <select className="input mt-1 min-h-10 py-1.5" value={wh} onChange={(e) => setWh(e.target.value)}>
                  <option value="">All my warehouses</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        }
        emptyTitle="Nothing to forecast"
        emptyBody="No SKU has dispatched, is booked to dispatch, or has stock in the places you can see."
      />
    </>
  );
}
