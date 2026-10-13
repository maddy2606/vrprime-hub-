"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ListView } from "@/components/flipkart/list-view";
import { Dropdown, Segmented } from "@/components/flipkart/kit";
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
  const router = useRouter();
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
          {split ? <p className="mt-0.5 text-xs font-semibold text-muted">{nameOf(r.wid)}</p> : null}
        </div>
      ),
      csv: (r) => r.sku,
    },
    { key: "title", label: "Title", csvOnly: true, cell: () => null, csv: (r) => r.title },
    { key: "wh", label: "Warehouse", csvOnly: true, cell: () => null, csv: (r) => (split ? nameOf(r.wid) : "All") },
    num("stock", "Stock now", (r) => r.stock),
    num("rate", "Avg / day", (r) => r.rate, 1),
    num("f1", "Forecast 1d", (r) => r.f1),
    num("f7", "Forecast 7d", (r) => r.f7),
    num("f30", "Forecast 30d", (r) => r.f30),
    {
      key: "cover",
      label: "Days of cover",
      align: "right",
      sort: (r) => r.cover,
      cell: (r) =>
        r.cover === null ? (
          <span className="text-muted">—</span>
        ) : (
          <span className={r.cover < 7 ? "font-bold text-bad" : r.cover < 14 ? "font-bold text-warn" : ""}>{r.cover < 10 ? r.cover.toFixed(1) : n0(r.cover)}</span>
        ),
      csv: (r) => (r.cover === null ? null : Math.round(r.cover * 10) / 10),
    },
    { key: "disp", label: "Units dispatched in window", csvOnly: true, cell: () => null, csv: (r) => r.dispatched },
  ];

  const windowOptions = WINDOWS.map((d) => ({ key: String(d), label: `${d} days` }));

  return (
    <>
      {note ? (
        <p role="status" className="mb-4 rounded-lg bg-info-soft px-3 py-2 text-sm font-semibold text-info">
          {note}
        </p>
      ) : null}

      {movers.length ? (
        <div className="mb-4">
          <p className="mb-1 text-xs font-semibold text-muted">Top movers, 30-day forecast</p>
          <ul className="flex flex-wrap gap-2">
            {movers.map((m) => (
              <li key={m.sku} className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs">
                <span className="font-mono font-bold">{m.sku}</span> <span className="text-muted">—</span> <span className="font-mono font-semibold tabular-nums">{n0(m.f30)}</span>
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
        scope={
          meta.days
            ? `${formatDate(meta.windowStart, meta.today)} to ${formatDate(meta.windowEnd, meta.today)}, ${meta.days} complete days${meta.snapshot ? ` · stock as of ${formatDate(meta.snapshot, meta.today)}` : ""}`
            : undefined
        }
        note={
          <>
            <b>By dispatch day</b>, in units. Average per day = units dispatched in the window ÷ its complete days (today is left out). Forecast = that average
            × 1, 7 or 30. Days of cover = stock now ÷ the average per day, the same calculation the Stock tab uses.
          </>
        }
        controls={
          <>
            <Segmented
              label="Average over the last"
              value={String(window)}
              onChange={(k) => router.push(k === "30" ? "/flipkart?tab=forecast" : `/flipkart?tab=forecast&days=${k}`)}
              options={windowOptions}
            />
            <Segmented<"all" | "split">
              label="Warehouses"
              value={split ? "split" : "all"}
              onChange={(k) => setSplit(k === "split")}
              options={[
                { key: "all", label: "Together" },
                { key: "split", label: "By warehouse" },
              ]}
            />
            {warehouses.length > 1 ? (
              <Dropdown label="Only" value={wh} onChange={setWh} options={[{ value: "", label: "All mine" }, ...warehouses.map((w) => ({ value: w.id, label: w.name }))]} />
            ) : null}
          </>
        }
        emptyTitle="Nothing to forecast"
        emptyBody="No SKU has dispatched, or has stock, in the places you can see."
      />
    </>
  );
}
