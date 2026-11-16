"use client";

import { useState, type ReactNode } from "react";
import { ChevronDownIcon } from "@/components/icons";
import { Picker } from "@/components/flipkart/kit";
import { Bar } from "@/components/signal/charts";
import { Chip, EmptyState, buttonClass } from "@/components/ui";
import { formatNumber } from "@/lib/format";
import type { ForecastRow, KitInfo, MasterChild, MasterGroup } from "@/lib/forecast";

export type MasterSortKey = "product" | "stock" | "rate" | "f1" | "f7" | "f30" | "cover";
export type MasterSort = { key: MasterSortKey; dir: "asc" | "desc" };

type Props = {
  groups: MasterGroup[];
  unmapped: ForecastRow[];
  /** Unmapped SKUs before the search, for the heading. */
  unmappedTotal: number;
  sort: MasterSort;
  onSort: (sort: MasterSort) => void;
  /** Products found through one of their SKUs: opened so the SKU shows. */
  autoOpen: Set<string>;
  searching: boolean;
};

const n0 = (v: number) => formatNumber(Math.round(v));

/** Cover with the same colours everywhere on the Forecasting tab: red under a week, amber under two. */
export function CoverValue({ cover }: { cover: number | null }) {
  if (cover === null) return <span className="text-muted">—</span>;
  return <span className={cover < 7 ? "font-bold text-bad" : cover < 14 ? "font-bold text-warn" : ""}>{cover < 10 ? cover.toFixed(1) : n0(cover)}</span>;
}

const NUMBERS: { key: Exclude<MasterSortKey, "product">; label: string; value: (r: ForecastRow) => number | null; cell: (r: ForecastRow) => ReactNode }[] = [
  { key: "stock", label: "Stock now", value: (r) => (r.noStock ? null : r.stock), cell: (r) => (r.noStock ? <span className="text-muted">—</span> : n0(r.stock)) },
  { key: "rate", label: "Avg / day", value: (r) => r.rate, cell: (r) => r.rate.toFixed(1) },
  { key: "f1", label: "Forecast 1d", value: (r) => r.f1, cell: (r) => n0(r.f1) },
  { key: "f7", label: "Forecast 7d", value: (r) => r.f7, cell: (r) => n0(r.f7) },
  { key: "f30", label: "Forecast 30d", value: (r) => r.f30, cell: (r) => n0(r.f30) },
  { key: "cover", label: "Days of cover", value: (r) => r.cover, cell: (r) => <CoverValue cover={r.cover} /> },
];

/** Sorts rows by a column; empty values (no cover) go last whichever way, ties by name. */
function sortRows<T>(rows: T[], sort: MasterSort, row: (t: T) => ForecastRow, name: (t: T) => string): T[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  const col = NUMBERS.find((c) => c.key === sort.key);
  return [...rows].sort((a, b) => {
    if (!col) return sign * name(a).localeCompare(name(b), "en", { numeric: true, sensitivity: "base" });
    const x = col.value(row(a));
    const y = col.value(row(b));
    if (x === null && y === null) return name(a).localeCompare(name(b));
    if (x === null) return 1;
    if (y === null) return -1;
    return x - y === 0 ? name(a).localeCompare(name(b)) : sign * (x - y);
  });
}

/**
 * The Forecasting tab by product: one row per product with its Flipkart SKUs combined, opened to show each SKU's own
 * numbers; then the SKUs that belong to no product, each its own row. Wide screens get a table (product column and
 * header pinned); phones get cards, with no sideways scrolling.
 */
export function MasterTable({ groups, unmapped, unmappedTotal, sort, onSort, autoOpen, searching }: Props) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [unmappedOpen, setUnmappedOpen] = useState(true);
  const isOpen = (key: string) => open.has(key) || autoOpen.has(key);
  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key) || autoOpen.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const tap = (key: MasterSortKey) => onSort({ key, dir: sort.key === key ? (sort.dir === "asc" ? "desc" : "asc") : key === "product" ? "asc" : "desc" });

  const sortedGroups = sortRows(groups, sort, (g) => g.total, (g) => g.name);
  const sortedUnmapped = sortRows(unmapped, sort, (r) => r, (r) => r.sku);
  const childrenOf = (g: MasterGroup): MasterChild[] => sortRows(g.children, sort, (r) => r, (r) => r.sku);

  if (!groups.length && !unmapped.length) {
    return (
      <EmptyState
        title={searching ? "Nothing matches your search" : "Nothing to forecast"}
        body={searching ? "Try a shorter part of the product name or SKU, or clear the search." : "No SKU has dispatched, or has stock, in the places you can see."}
      />
    );
  }

  const skuLabel = (r: ForecastRow, units = 1) => (
    <div className="min-w-0">
      <span className="break-all font-mono text-[13px] font-medium leading-tight">{r.sku}</span>
      {units > 1 ? (
        <span title={`One order uses ${units} of the product`} className="tabular-nums g-chip tone-accent ml-1.5">
          ×{units}
        </span>
      ) : null}
      {r.title ? <p className="t-caption mt-0.5 line-clamp-2 break-words">{r.title}</p> : null}
    </div>
  );
  const count = (n: number) => (
    <span className="tabular-nums g-chip ml-2">
      {n} {n === 1 ? "SKU" : "SKUs"}
    </span>
  );

  return (
    <div>
      <div className="mb-2 min-[700px]:hidden">
        <SortControls sort={sort} onSort={onSort} />
      </div>
      <div className="sp-card ledger-card max-h-[75vh]">
        <table className="ledger">
          <thead>
            <tr>
              <SortHeader label="Product / SKU" active={sort.key === "product"} dir={sort.dir} onClick={() => tap("product")} first />
              {NUMBERS.map((c) => (
                <SortHeader key={c.key} label={c.label} active={sort.key === c.key} dir={sort.dir} onClick={() => tap(c.key)} />
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedGroups.map((g) => {
              const expanded = isOpen(g.key);
              return [
                <tr key={g.key} className={expanded ? "is-expanded" : ""}>
                  <td className="max-w-[18rem] !p-0">
                    <button type="button" aria-expanded={expanded} onClick={() => toggle(g.key)} className="focus-ring flex min-h-11 w-full items-center gap-1.5 px-2 py-2 text-left">
                      <ChevronDownIcon className={`h-4 w-4 shrink-0 text-muted transition ${expanded ? "" : "-rotate-90"}`} />
                      <span className="t-card-title min-w-0">{g.name}</span>
                      {g.kit ? <KitBadge /> : null}
                      {count(g.children.length)}
                    </button>
                  </td>
                  {NUMBERS.map((c) => (
                    <td key={c.key} className="num">
                      {c.cell(g.total)}
                    </td>
                  ))}
                </tr>,
                ...(expanded && g.kit
                  ? [
                      <tr key={`${g.key}|kit`} className="is-expanded">
                        <td colSpan={NUMBERS.length + 1} className="!pl-8">
                          <KitNote kit={g.kit} className="sticky left-8" />
                        </td>
                      </tr>,
                    ]
                  : []),
                ...(expanded
                  ? childrenOf(g).map((r) => (
                      <tr key={`${g.key}|${r.key}`} className="is-expanded">
                        <td className="max-w-[18rem] !pl-8">{skuLabel(r, r.units)}</td>
                        {NUMBERS.map((c) => (
                          <td key={c.key} className="num text-muted">
                            {c.cell(r)}
                          </td>
                        ))}
                      </tr>
                    ))
                  : []),
              ];
            })}
            {unmapped.length ? (
              <tr>
                <td colSpan={NUMBERS.length + 1} className="!p-0">
                  <button type="button" aria-expanded={unmappedOpen} onClick={() => setUnmappedOpen((v) => !v)} className="focus-ring sticky left-0 flex min-h-11 items-center gap-1.5 px-2 text-left">
                    <ChevronDownIcon className={`h-4 w-4 shrink-0 text-muted transition ${unmappedOpen ? "" : "-rotate-90"}`} />
                    <span className="t-card-title">Unmapped</span>
                    {count(searching ? unmapped.length : unmappedTotal)}
                    <span className="t-caption ml-1">SKUs that belong to no product yet</span>
                  </button>
                </td>
              </tr>
            ) : null}
            {unmappedOpen
              ? sortedUnmapped.map((r) => (
                  <tr key={`u|${r.key}`}>
                    <td className="max-w-[18rem]">{skuLabel(r)}</td>
                    {NUMBERS.map((c) => (
                      <td key={c.key} className="num">
                        {c.cell(r)}
                      </td>
                    ))}
                  </tr>
                ))
              : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** "Sort by" and the direction button, for the phone cards (the table's headers sort on wide screens). */
function SortControls({ sort, onSort }: { sort: MasterSort; onSort: (sort: MasterSort) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Picker
        label="Sort by"
        value={sort.key}
        onChange={(k) => onSort({ key: k as MasterSortKey, dir: k === "product" ? "asc" : "desc" })}
        options={[{ value: "product", label: "Product" }, ...NUMBERS.map((c) => ({ value: c.key, label: c.label }))]}
      />
      <button
        type="button"
        onClick={() => onSort({ ...sort, dir: sort.dir === "asc" ? "desc" : "asc" })}
        aria-label={sort.dir === "asc" ? "Ascending: tap to reverse" : "Descending: tap to reverse"}
        className={buttonClass("secondary", "w-10 px-0")}
      >
        {sort.dir === "asc" ? "▲" : "▼"}
      </button>
    </div>
  );
}

const coverTone = (cover: number | null): "neutral" | "bad" | "warn" | "ok" => (cover === null ? "neutral" : cover < 7 ? "bad" : cover < 14 ? "warn" : "ok");
const coverText = (r: ForecastRow): string =>
  r.noStock
    ? "No stock data"
    : r.cover === null
      ? r.stock > 0
        ? "No recent sales"
        : "Out of stock"
      : r.cover <= 0
        ? "Out of stock"
        : `${r.cover < 10 ? r.cover.toFixed(1) : n0(r.cover)} ${r.cover === 1 ? "day" : "days"} left`;
const perDay = (rate: number) => (rate < 10 ? rate.toFixed(1) : n0(rate));

/** One row of the ranked list: rank, name, the 30-day forecast with its bar, and days of stock left as a coloured tag. */
function RankedRow({
  rank,
  title,
  mono = false,
  sub,
  badge,
  row,
  share,
  expanded,
  onToggle,
  children,
}: {
  rank: number;
  title: string;
  mono?: boolean;
  sub: string | null;
  badge?: ReactNode;
  row: ForecastRow;
  share: number;
  expanded?: boolean;
  onToggle?: () => void;
  children?: ReactNode;
}) {
  const name = <span className={`min-w-0 truncate ${mono ? "font-mono text-[13px] font-medium" : "t-card-title"}`}>{title}</span>;
  return (
    <li>
      <div className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3">
        <span className="text-xs tabular-nums text-faint">{rank}</span>
        <span className="min-w-0">
          {onToggle ? (
            <button type="button" aria-expanded={expanded} onClick={onToggle} className="focus-ring flex max-w-full min-w-0 items-center gap-1.5 rounded text-left">
              {name}
              {badge}
              <ChevronDownIcon className={`h-4 w-4 shrink-0 text-muted transition ${expanded ? "rotate-180" : ""}`} />
            </button>
          ) : (
            <span className="flex min-w-0 items-center gap-1.5">
              {name}
              {badge}
            </span>
          )}
          {sub ? <span className="t-caption block truncate">{sub}</span> : null}
        </span>
        <span className="text-right">
          <span className="block text-[13px] font-medium tabular-nums">{n0(row.f30)}</span>
          <span className="t-caption block">{perDay(row.rate)} a day</span>
        </span>
        <span />
        <Bar share={share} tone="cyan" index={Math.min(rank - 1, 12)} />
        <span className="text-right">
          <Chip tone={coverTone(row.noStock ? null : row.cover)}>{coverText(row)}</Chip>
        </span>
      </div>
      {expanded ? children : null}
    </li>
  );
}

/** The ranked list's only order. */
const BY_F30: MasterSort = { key: "f30", dir: "desc" };

/**
 * Every product as a ranked list, the way the Command Deck shows its top movers: the 30-day forecast as a bar against the
 * biggest one, and days of stock left as a red, amber or green tag. Tap a product to see its Flipkart SKUs. Always ranked
 * by the 30-day forecast, largest first.
 */
export function RankedList({ groups, unmapped, unmappedTotal, autoOpen, searching }: Omit<Props, "sort" | "onSort">) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [unmappedOpen, setUnmappedOpen] = useState(false);
  const isOpen = (key: string) => open.has(key) || autoOpen.has(key);
  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key) || autoOpen.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (!groups.length && !unmapped.length) {
    return (
      <EmptyState
        title={searching ? "Nothing matches your search" : "Nothing to forecast"}
        body={searching ? "Try a shorter part of the product name or SKU, or clear the search." : "No SKU has dispatched, or has stock, in the places you can see."}
      />
    );
  }

  const max = Math.max(1, ...groups.map((g) => g.total.f30), ...unmapped.map((r) => r.f30));
  const sorted = sortRows(groups, BY_F30, (g) => g.total, (g) => g.name);
  const sortedUnmapped = sortRows(unmapped, BY_F30, (r) => r, (r) => r.sku);
  const skuCount = (n: number) => `${n} ${n === 1 ? "SKU" : "SKUs"}`;

  return (
    <div className="flex flex-col gap-3">
      {sorted.length ? (
        <ol className="sp-card divide-y divide-line-soft overflow-hidden">
          {sorted.map((g, i) => (
            <RankedRow
              key={g.key}
              rank={i + 1}
              title={g.name}
              sub={`${skuCount(g.children.length)}${g.total.noStock ? "" : ` · ${n0(g.total.stock)} in stock`}`}
              badge={g.kit ? <KitBadge /> : undefined}
              row={g.total}
              share={g.total.f30 / max}
              expanded={isOpen(g.key)}
              onToggle={() => toggle(g.key)}
            >
              <div className="border-t border-line-soft bg-surface2 px-4 py-2.5">
                {g.kit ? <KitNote kit={g.kit} className="mb-2 pl-10" /> : null}
                {g.children.length ? (
                  <ul className="flex flex-col">
                    {sortRows(g.children, BY_F30, (r) => r, (r) => r.sku).map((c) => (
                      <li key={c.key} className="flex items-center justify-between gap-3 py-1.5 pl-10 text-xs">
                        <span className="min-w-0 truncate">
                          <span className="font-mono font-bold">{c.sku}</span>
                          {c.units > 1 ? <span className="tabular-nums ml-1 text-accent-text">×{c.units}</span> : null}
                          {c.title ? <span className="text-muted"> · {c.title}</span> : null}
                        </span>
                        <span className="shrink-0 tabular-nums">
                          {n0(c.f30)} <span className="text-muted">· {perDay(c.rate)} a day</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-1 pl-10 text-xs text-muted">No Flipkart SKU is linked yet.</p>
                )}
              </div>
            </RankedRow>
          ))}
        </ol>
      ) : null}
      {unmapped.length ? (
        <section>
          <button type="button" aria-expanded={unmappedOpen} onClick={() => setUnmappedOpen((v) => !v)} className="focus-ring mb-2 flex min-h-11 w-full items-center gap-2 rounded-lg px-1 text-left">
            <span className="text-sm font-bold">Unmapped</span>
            <span className="tabular-nums inline-flex shrink-0 items-center rounded-full bg-surface2 px-2 py-0.5 text-[11px] font-semibold text-muted">{skuCount(searching ? unmapped.length : unmappedTotal)}</span>
            <span className="text-xs text-muted">no product yet</span>
            <ChevronDownIcon className={`ml-auto h-5 w-5 text-muted transition ${unmappedOpen ? "rotate-180" : ""}`} />
          </button>
          {unmappedOpen ? (
            <ol className="sp-card divide-y divide-line-soft overflow-hidden">
              {sortedUnmapped.map((r, i) => (
                <RankedRow key={r.key} rank={i + 1} title={r.sku} mono sub={r.title} row={r} share={r.f30 / max} />
              ))}
            </ol>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function SortHeader({ label, active, dir, onClick, first = false }: { label: string; active: boolean; dir: "asc" | "desc"; onClick: () => void; first?: boolean }) {
  return (
    <th scope="col" aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined} className={`!p-0 ${first ? "text-left" : "num"}`}>
      <button
        type="button"
        onClick={onClick}
        className={`focus-ring flex min-h-11 w-full items-center gap-0.5 px-3 font-[inherit] uppercase tracking-[inherit] ${first ? "justify-start" : "justify-end"} ${active ? "text-accent-text" : "hover:text-ink"}`}
      >
        {label}
        <span aria-hidden="true" className="w-3 text-[10px]">
          {active ? (dir === "asc" ? "▲" : "▼") : ""}
        </span>
      </button>
    </th>
  );
}

function KitBadge() {
  return (
    <span title="A kit (combo) made of other products" className="g-chip tone-accent ml-2">
      Kit
    </span>
  );
}

/** What a kit's stock is made of: its own stock plus what the parts make, and each part's stock. */
function KitNote({ kit, className = "" }: { kit: KitInfo; className?: string }) {
  return (
    <div className={`text-xs leading-relaxed ${className}`}>
      <p>
        <span className="font-semibold">Stock now {n0(kit.own + kit.canMake)}</span> <span className="text-muted">=</span> {n0(kit.own)} ready{" "}
        <span className="text-muted">+</span> <span className="font-semibold text-accent-text">{n0(kit.canMake)} can be made</span> from the parts
      </p>
      {kit.parts.length ? (
        <ul className="mt-1 flex flex-wrap gap-1.5">
          {kit.parts.map((p) => (
            <li key={p.name} className="rounded-full bg-surface2 px-2 py-0.5 font-semibold">
              {p.qty > 1 ? `${p.qty} × ` : ""}
              {p.name}: <span className="tabular-nums">{n0(p.stock)}</span> in stock
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">No parts set yet: add them on the Master SKUs tab.</p>
      )}
    </div>
  );
}
