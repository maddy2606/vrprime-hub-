"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ListView } from "@/components/flipkart/list-view";
import { CoverValue, MasterTable, type MasterSort } from "@/components/flipkart/master-table";
import { Caption, CsvButton, InfoTip, Picker, SearchField, Segmented, Toolbar } from "@/components/flipkart/kit";
import type { Column } from "@/components/stock/data-table";
import { downloadCsv, toCsv, type CsvCell } from "@/lib/csv";
import { formatDate, formatNumber } from "@/lib/format";
import {
  buildMasterGroups,
  buildRows,
  historyNote,
  topMovers,
  WINDOWS,
  type ForecastMeta,
  type ForecastRaw,
  type ForecastRow,
  type MasterGroup,
} from "@/lib/forecast";
import { masterLookup, type MasterRow } from "@/lib/master-csv";

type Props = {
  meta: ForecastMeta;
  raw: ForecastRaw[];
  warehouses: { id: string; name: string }[];
  /** The window asked for in the address. */
  window: number;
  /** Which product each channel SKU belongs to. */
  masters: MasterRow[];
  /** "All warehouses" for owner and admin, "All my warehouses" for a warehouse user. */
  allLabel: string;
};

type View = "master" | "sku";

const n0 = (v: number) => formatNumber(Math.round(v));

export function ForecastTab({ meta, raw, warehouses, window, masters, allLabel }: Props) {
  const router = useRouter();
  const [view, setView] = useState<View>("master");
  const [split, setSplit] = useState(false);
  const [wh, setWh] = useState<string>("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<MasterSort>({ key: "f30", dir: "desc" });
  const nameOf = (id: string | null) => warehouses.find((w) => w.id === id)?.name ?? "Unknown warehouse";
  const masterOf = useMemo(() => masterLookup(masters), [masters]);

  const rows = useMemo(() => buildRows(raw, meta.days, split, wh || null), [raw, meta.days, split, wh]);
  const grouped = useMemo(() => buildMasterGroups(raw, meta.days, masterOf, wh || null), [raw, meta.days, masterOf, wh]);
  const note = historyNote(meta);

  // Top movers follow the view: products (combined) in the product view, SKUs in the flat list.
  const movers = useMemo(
    () =>
      view === "master"
        ? topMovers([...grouped.groups.map((g) => g.total), ...grouped.unmapped], 5).filter((r) => r.f30 > 0)
        : topMovers(buildRows(raw, meta.days, false, wh || null), 5).filter((r) => r.f30 > 0),
    [view, grouped, raw, meta.days, wh],
  );

  // Search finds a product by its name or by any of its SKUs (or a SKU's title); unmapped SKUs by SKU or title.
  const needle = q.trim().toLowerCase();
  const matches = (r: ForecastRow) => `${r.sku} ${r.title ?? ""}`.toLowerCase().includes(needle);
  const shownGroups: MasterGroup[] = needle ? grouped.groups.filter((g) => g.name.toLowerCase().includes(needle) || g.children.some(matches)) : grouped.groups;
  const childHit = new Set(needle ? shownGroups.filter((g) => !g.name.toLowerCase().includes(needle)).map((g) => g.key) : []);
  const shownUnmapped = needle ? grouped.unmapped.filter(matches) : grouped.unmapped;
  const coveredSkus = grouped.groups.reduce((n, g) => n + g.children.length, 0);

  const scope = meta.days
    ? `${formatDate(meta.windowStart, meta.today)} to ${formatDate(meta.windowEnd, meta.today)}, ${meta.days} complete days${meta.snapshot ? ` · stock as of ${formatDate(meta.snapshot, meta.today)}` : ""}`
    : undefined;

  /** The expanded detail: each product's total, then its SKUs; the unmapped SKUs last. */
  const exportMasterCsv = () => {
    const line = (product: string, kind: string, r: ForecastRow, sku: string, title: string | null, children: number | null): CsvCell[] => [
      product,
      kind,
      sku,
      title,
      children,
      r.stock,
      Math.round(r.rate * 10) / 10,
      r.f1,
      r.f7,
      r.f30,
      r.cover === null ? null : Math.round(r.cover * 10) / 10,
      r.dispatched,
    ];
    const out: CsvCell[][] = [];
    for (const g of shownGroups) {
      out.push(line(g.name, "Product total", g.total, "", null, g.children.length));
      for (const c of g.children) out.push(line(g.name, "SKU", c, c.sku, c.title, null));
    }
    for (const u of shownUnmapped) out.push(line("Unmapped", "SKU", u, u.sku, u.title, null));
    downloadCsv(
      `vrprime-forecast-by-product-${window}d${wh ? `-${nameOf(wh).toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : ""}.csv`,
      toCsv(
        ["Product", "Row", "SKU", "Title", "Child SKUs", "Stock now", "Avg / day", "Forecast 1d", "Forecast 7d", "Forecast 30d", "Days of cover", "Units dispatched in window"],
        out,
      ),
    );
  };

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
    { key: "product", label: "Product", csvOnly: true, cell: () => null, csv: (r) => masterOf(r.sku) ?? "Unmapped" },
    { key: "wh", label: "Warehouse", csvOnly: true, cell: () => null, csv: (r) => (split ? nameOf(r.wid) : wh ? nameOf(wh) : "All") },
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
      cell: (r) => <CoverValue cover={r.cover} />,
      csv: (r) => (r.cover === null ? null : Math.round(r.cover * 10) / 10),
    },
    { key: "disp", label: "Units dispatched in window", csvOnly: true, cell: () => null, csv: (r) => r.dispatched },
  ];

  const explain = (
    <>
      <b>By dispatch day</b>, in units. Average per day = units dispatched in the window ÷ its complete days (today is left out). Forecast = that average
      × 1, 7 or 30. Days of cover = stock now ÷ the average per day, the same calculation the Stock tab uses.
      {view === "master" ? (
        <>
          {" "}
          <b>A product row combines its Flipkart SKUs</b>: stock = the sum of their stock, average per day = the sum of their averages, and the forecasts and
          days of cover come from those sums. SKUs are matched to products by exact spelling, then in any case.
        </>
      ) : null}
    </>
  );

  const viewSwitch = (
    <Segmented<View>
      label="Show"
      value={view}
      onChange={setView}
      options={[
        { key: "master", label: "By product (master)" },
        { key: "sku", label: "All SKUs" },
      ]}
    />
  );
  const windowSwitch = (
    <Segmented
      label="Average over the last"
      value={String(window)}
      onChange={(k) => router.push(k === "30" ? "/flipkart?tab=forecast" : `/flipkart?tab=forecast&days=${k}`)}
      options={WINDOWS.map((d) => ({ key: String(d), label: `${d} days` }))}
    />
  );
  const warehousePicker =
    warehouses.length > 1 ? <Picker label="Only" value={wh} onChange={setWh} options={[{ value: "", label: allLabel }, ...warehouses.map((w) => ({ value: w.id, label: w.name }))]} /> : null;

  return (
    <>
      {note ? (
        <p role="status" className="mb-4 rounded-lg bg-info-soft px-3 py-2 text-sm font-semibold text-info">
          {note}
        </p>
      ) : null}

      {movers.length ? (
        <div className="mb-4">
          <p className="mb-1 text-xs font-semibold text-muted">Top movers, 30-day forecast{view === "master" ? " (products combined)" : ""}</p>
          <ul className="flex flex-wrap gap-2">
            {movers.map((m) => (
              <li key={m.key} className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs">
                <span className={view === "master" && m.key.startsWith("m:") ? "font-bold" : "font-mono font-bold"}>{m.sku}</span> <span className="text-muted">—</span>{" "}
                <span className="font-mono font-semibold tabular-nums">{n0(m.f30)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {view === "master" ? (
        <>
          <Toolbar>
            {viewSwitch}
            {windowSwitch}
            {warehousePicker}
            <SearchField value={q} onChange={setQ} placeholder="Search product or SKU" />
            <CsvButton onClick={exportMasterCsv} disabled={shownGroups.length + shownUnmapped.length === 0} />
            <InfoTip>{explain}</InfoTip>
          </Toolbar>
          <Caption>
            {formatNumber(shownGroups.length)} {shownGroups.length === 1 ? "product" : "products"} covering {formatNumber(coveredSkus)} SKUs ·{" "}
            {formatNumber(grouped.unmapped.length)} unmapped {grouped.unmapped.length === 1 ? "SKU" : "SKUs"}
            {scope ? ` · ${scope}` : ""}
          </Caption>
          <MasterTable groups={shownGroups} unmapped={shownUnmapped} unmappedTotal={grouped.unmapped.length} sort={sort} onSort={setSort} autoOpen={childHit} searching={needle !== ""} />
        </>
      ) : (
        <ListView
          rows={rows}
          columns={columns}
          rowKey={(r) => r.key}
          defaultSort={{ key: "f30", dir: "desc" }}
          textKeys={["sku"]}
          searchText={(r) => `${r.sku} ${r.title ?? ""} ${masterOf(r.sku) ?? ""}`}
          searchLabel="Search SKU, title or product"
          csvName={`vrprime-forecast-${window}d.csv`}
          noun={split ? ["SKU at a warehouse", "SKUs at warehouses"] : ["SKU", "SKUs"]}
          scope={scope}
          note={explain}
          controls={
            <>
              {viewSwitch}
              {windowSwitch}
              <Segmented<"all" | "split">
                label="Warehouses"
                value={split ? "split" : "all"}
                onChange={(k) => setSplit(k === "split")}
                options={[
                  { key: "all", label: "Together" },
                  { key: "split", label: "By warehouse" },
                ]}
              />
              {warehousePicker}
            </>
          }
          emptyTitle="Nothing to forecast"
          emptyBody="No SKU has dispatched, or has stock, in the places you can see."
        />
      )}
    </>
  );
}
