"use client";

import { useState, type ReactNode } from "react";
import { ChevronDownIcon } from "@/components/icons";
import { Picker } from "@/components/flipkart/kit";
import { Bar } from "@/components/signal/charts";
import { Chip, EmptyState } from "@/components/ui";
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

/** A phone card's headline: days of cover as a coloured pill (red under a week, amber under two, green after). */
function CoverPill({ cover }: { cover: number | null }) {
  if (cover === null) return null;
  const tone = cover < 7 ? "bg-bad-soft text-bad" : cover < 14 ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok";
  const value = cover < 10 ? cover.toFixed(1) : n0(cover);
  return (
    <span title="Days of cover" className={`mt-px inline-flex shrink-0 items-baseline gap-1 rounded-full px-2.5 py-1 ${tone}`}>
      <span className="font-mono text-sm font-bold tabular-nums">{value}</span>
      <span className="text-[11px] font-semibold">{cover === 1 ? "day" : "days"} left</span>
    </span>
  );
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
      <span className="break-all font-mono text-[13px] font-bold leading-tight">{r.sku}</span>
      {units > 1 ? (
        <span title={`One order uses ${units} of the product`} className="ml-1.5 rounded-full bg-accent-soft px-1.5 py-0.5 font-mono text-[11px] font-semibold text-accent-text">
          ×{units}
        </span>
      ) : null}
      {r.title ? <p className="mt-0.5 line-clamp-2 break-words text-xs leading-snug text-muted">{r.title}</p> : null}
    </div>
  );
  const count = (n: number) => (
    <span className="ml-2 inline-flex shrink-0 items-center rounded-full bg-surface2 px-2 py-0.5 font-mono text-[11px] font-semibold text-muted">
      {n} {n === 1 ? "SKU" : "SKUs"}
    </span>
  );

  return (
    <div>
      {/* Phone: cards */}
      <div className="flex flex-col gap-2 min-[481px]:hidden">
        <SortControls sort={sort} onSort={onSort} />
        {sortedGroups.map((g) => {
          const expanded = isOpen(g.key);
          return (
            <article key={g.key} className="sp-card p-3">
              <button type="button" aria-expanded={expanded} onClick={() => toggle(g.key)} className="focus-ring flex w-full min-w-0 items-start gap-2 rounded-lg text-left">
                <span className="min-w-0 flex-1">
                  <span className="text-[15px] font-bold leading-snug">{g.name}</span>
                  {g.kit ? <KitBadge /> : null}
                  {count(g.children.length)}
                </span>
                <CoverPill cover={g.total.cover} />
                <ChevronDownIcon className={`mt-1 h-5 w-5 shrink-0 text-muted transition ${expanded ? "rotate-180" : ""}`} />
              </button>
              <Numbers row={g.total} hideCover={g.total.cover !== null} />
              {expanded && g.kit ? <KitNote kit={g.kit} className="mt-3 border-t border-line pt-3" /> : null}
              {expanded && g.children.length ? (
                <ul className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
                  {childrenOf(g).map((c) => (
                    <li key={c.key} className="rounded-lg border border-line-soft bg-canvas/60 p-2.5">
                      {skuLabel(c, c.units)}
                      <Numbers row={c} small />
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          );
        })}
        {unmapped.length ? (
          <section className="mt-2">
            <button type="button" aria-expanded={unmappedOpen} onClick={() => setUnmappedOpen((v) => !v)} className="focus-ring mb-2 flex min-h-11 w-full items-center gap-2 rounded-lg px-1 text-left">
              <span className="text-sm font-bold">Unmapped</span>
              {count(searching ? unmapped.length : unmappedTotal)}
              <span className="text-xs text-muted">no product yet</span>
              <ChevronDownIcon className={`ml-auto h-5 w-5 text-muted transition ${unmappedOpen ? "rotate-180" : ""}`} />
            </button>
            {unmappedOpen ? (
              <div className="flex flex-col gap-2">
                {sortedUnmapped.map((r) => (
                  <article key={r.key} className="sp-card p-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">{skuLabel(r)}</div>
                      <CoverPill cover={r.cover} />
                    </div>
                    <Numbers row={r} hideCover={r.cover !== null} />
                  </article>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>

      {/* Wider screens: table */}
      <div className="hidden max-h-[75vh] overflow-auto sp-card min-[481px]:block">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-20">
            <tr className="border-b border-line bg-panel2">
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
                <tr key={g.key} className="group border-b border-line hover:bg-surface2/60">
                  <td className="sticky left-0 z-10 max-w-[18rem] bg-surface p-0 group-hover:bg-surface2">
                    <button type="button" aria-expanded={expanded} onClick={() => toggle(g.key)} className="focus-ring flex min-h-11 w-full items-center gap-1.5 px-2 py-2 text-left">
                      <ChevronDownIcon className={`h-4 w-4 shrink-0 text-muted transition ${expanded ? "" : "-rotate-90"}`} />
                      <span className="min-w-0 font-bold leading-snug">{g.name}</span>
                      {g.kit ? <KitBadge /> : null}
                      {count(g.children.length)}
                    </button>
                  </td>
                  {NUMBERS.map((c) => (
                    <td key={c.key} className="px-2 py-2 text-right font-mono font-semibold tabular-nums">
                      {c.cell(g.total)}
                    </td>
                  ))}
                </tr>,
                ...(expanded && g.kit
                  ? [
                      <tr key={`${g.key}|kit`} className="border-b border-line-soft bg-canvas/50">
                        <td colSpan={NUMBERS.length + 1} className="py-1.5 pl-8 pr-2">
                          <KitNote kit={g.kit} className="sticky left-8" />
                        </td>
                      </tr>,
                    ]
                  : []),
                ...(expanded
                  ? childrenOf(g).map((r) => (
                      <tr key={`${g.key}|${r.key}`} className="border-b border-line-soft bg-canvas/50">
                        <td className="sticky left-0 z-10 max-w-[18rem] bg-panel2 py-1.5 pl-8 pr-2">{skuLabel(r, r.units)}</td>
                        {NUMBERS.map((c) => (
                          <td key={c.key} className="px-2 py-1.5 text-right font-mono text-[13px] tabular-nums text-muted">
                            {c.cell(r)}
                          </td>
                        ))}
                      </tr>
                    ))
                  : []),
              ];
            })}
            {unmapped.length ? (
              <tr className="border-y border-line bg-panel2">
                <td colSpan={NUMBERS.length + 1} className="p-0">
                  <button type="button" aria-expanded={unmappedOpen} onClick={() => setUnmappedOpen((v) => !v)} className="focus-ring sticky left-0 flex min-h-11 items-center gap-1.5 px-2 text-left">
                    <ChevronDownIcon className={`h-4 w-4 shrink-0 text-muted transition ${unmappedOpen ? "" : "-rotate-90"}`} />
                    <span className="font-bold">Unmapped</span>
                    {count(searching ? unmapped.length : unmappedTotal)}
                    <span className="ml-1 text-xs text-muted">SKUs that belong to no product yet</span>
                  </button>
                </td>
              </tr>
            ) : null}
            {unmappedOpen
              ? sortedUnmapped.map((r) => (
                  <tr key={`u|${r.key}`} className="group border-b border-line last:border-b-0 hover:bg-surface2/60">
                    <td className="sticky left-0 z-10 max-w-[18rem] bg-surface px-2 py-2 group-hover:bg-surface2">{skuLabel(r)}</td>
                    {NUMBERS.map((c) => (
                      <td key={c.key} className="px-2 py-2 text-right font-mono tabular-nums">
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

/** "Sort by" and the direction button, for the phone cards and the ranked list. */
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
        className="focus-ring flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line bg-surface text-sm font-bold text-ink"
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
  const name = <span className={`min-w-0 truncate ${mono ? "font-mono text-[13px]" : "text-[15px]"} font-bold`}>{title}</span>;
  return (
    <li>
      <div className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3.5">
        <span className="font-mono text-xs tabular-nums text-faint">{rank}</span>
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
          {sub ? <span className="block truncate text-xs text-muted">{sub}</span> : null}
        </span>
        <span className="text-right">
          <span className="block font-mono text-base font-bold tabular-nums">{n0(row.f30)}</span>
          <span className="block text-[11px] text-muted">{perDay(row.rate)} a day</span>
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

/**
 * Every product as a ranked list, the way the Command Deck shows its top movers: the 30-day forecast as a bar against the
 * biggest one, and days of stock left as a red, amber or green tag. Tap a product to see its Flipkart SKUs. It follows the
 * same sort as the table.
 */
export function RankedList({ groups, unmapped, unmappedTotal, sort, onSort, autoOpen, searching }: Props) {
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
  const sorted = sortRows(groups, sort, (g) => g.total, (g) => g.name);
  const sortedUnmapped = sortRows(unmapped, sort, (r) => r, (r) => r.sku);
  const skuCount = (n: number) => `${n} ${n === 1 ? "SKU" : "SKUs"}`;

  return (
    <div className="flex flex-col gap-3">
      <SortControls sort={sort} onSort={onSort} />
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
              <div className="border-t border-line-soft bg-canvas/40 px-4 py-2.5">
                {g.kit ? <KitNote kit={g.kit} className="mb-2 pl-10" /> : null}
                {g.children.length ? (
                  <ul className="flex flex-col">
                    {sortRows(g.children, sort, (r) => r, (r) => r.sku).map((c) => (
                      <li key={c.key} className="flex items-center justify-between gap-3 py-1.5 pl-10 text-xs">
                        <span className="min-w-0 truncate">
                          <span className="font-mono font-bold">{c.sku}</span>
                          {c.units > 1 ? <span className="ml-1 font-mono text-accent-text">×{c.units}</span> : null}
                          {c.title ? <span className="text-muted"> · {c.title}</span> : null}
                        </span>
                        <span className="shrink-0 font-mono tabular-nums">
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
            <span className="inline-flex shrink-0 items-center rounded-full bg-surface2 px-2 py-0.5 font-mono text-[11px] font-semibold text-muted">{skuCount(searching ? unmapped.length : unmappedTotal)}</span>
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
    <th scope="col" aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined} className={`bg-panel2 p-0 font-bold ${first ? "sticky left-0 z-10 text-left" : "text-right"}`}>
      <button
        type="button"
        onClick={onClick}
        className={`focus-ring flex min-h-11 w-full items-center gap-0.5 px-2 text-xs uppercase leading-tight ${first ? "justify-start" : "justify-end"} ${active ? "text-accent-text" : "text-muted hover:text-ink"}`}
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
    <span title="A kit (combo) made of other products" className="ml-2 inline-flex shrink-0 items-center rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-bold text-accent-text">
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
              {p.name}: <span className="font-mono tabular-nums">{n0(p.stock)}</span> in stock
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">No parts set yet: add them on the Master SKUs tab.</p>
      )}
    </div>
  );
}

/** A card's numbers: the six columns as label and value pairs (five when the cover is already the card's pill). */
function Numbers({ row, small = false, hideCover = false }: { row: ForecastRow; small?: boolean; hideCover?: boolean }) {
  return (
    <dl className={`mt-2.5 grid gap-x-4 ${small ? "grid-cols-3 gap-y-1.5" : "grid-cols-3 gap-y-2.5"}`}>
      {NUMBERS.filter((c) => !(hideCover && c.key === "cover")).map((c) => (
        <div key={c.key} className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase leading-tight tracking-wide text-muted">{c.label}</dt>
          <dd className={`mt-0.5 font-mono tabular-nums ${small ? "text-[13px]" : "text-sm font-semibold"}`}>{c.cell(row)}</dd>
        </div>
      ))}
    </dl>
  );
}
