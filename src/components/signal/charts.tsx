// Charts. Plain SVG and HTML, so every number and shape is there at rest without JavaScript;
// the draw-in animations are CSS only and switch off under prefers-reduced-motion.
// Marks carry the colour; every label and value stays in text colours (ink, muted), never the series colour.
import { useId } from "react";
import { formatNumber } from "@/lib/format";
import { COLOR, TONE_COLOR, type SignalTone } from "@/lib/theme";

function points(values: number[], w: number, h: number, pad = 2, max?: number, min = 0): [number, number][] {
  const top = max ?? Math.max(...values, 1);
  const span = Math.max(top - min, 1);
  return values.map((v, i) => [values.length === 1 ? w / 2 : (i / (values.length - 1)) * w, pad + (1 - (v - min) / span) * (h - pad * 2)]);
}

function smooth(p: [number, number][]): string {
  if (p.length === 0) return "";
  if (p.length === 1) return `M0 ${p[0][1]} L100 ${p[0][1]}`;
  let d = `M${p[0][0]} ${p[0][1]}`;
  for (let i = 1; i < p.length; i++) {
    const [x0, y0] = p[i - 1];
    const [x1, y1] = p[i];
    const cx = (x0 + x1) / 2;
    d += ` C${cx} ${y0} ${cx} ${y1} ${x1} ${y1}`;
  }
  return d;
}

/** A small trend line. `values` oldest first. Nothing is drawn for fewer than two points. */
export function Sparkline({ values, tone = "cyan", label, className = "h-8 w-full" }: { values: number[]; tone?: SignalTone; label: string; className?: string }) {
  const id = useId();
  if (values.length < 2) return <div className={className} aria-hidden="true" />;
  const color = TONE_COLOR[tone];
  const lo = Math.min(...values);
  const p = points(values, 100, 32, 3, undefined, lo > 0 ? lo * 0.9 : 0);
  const line = smooth(p);
  return (
    <svg role="img" aria-label={label} viewBox="0 0 100 32" preserveAspectRatio="none" className={`${className} sp-wipe`}>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" style={{ stopColor: color }} stopOpacity="0.32" />
          <stop offset="1" style={{ stopColor: color }} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L100 32 L0 32 Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" style={{ stroke: color }} strokeWidth="1.8" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** The health ring: `pct` 0 to 100, with the number in the middle. */
export function Gauge({ pct, tone, size = 56, label }: { pct: number; tone: SignalTone; size?: number; label: string }) {
  const v = Math.max(0, Math.min(100, Math.round(pct)));
  const color = TONE_COLOR[tone];
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r="42" fill="none" style={{ stroke: COLOR.lineSoft }} strokeWidth="10" />
        <circle cx="50" cy="50" r="42" fill="none" style={{ stroke: color }} strokeWidth="10" strokeLinecap="round" pathLength={100} strokeDasharray={`${v} 100`} className="sp-gauge-arc" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-mono text-[13px] font-bold tabular-nums">{v}</span>
    </div>
  );
}

export type AreaPoint = { label: string; value: number };

/**
 * The big area chart: gridlines, y labels, day labels, a gradient fill and an emphasised last point.
 * Labels are HTML so they stay readable at phone width; only the shapes scale.
 */
export function AreaChart({ data, tone = "cyan", ariaLabel, formatY }: { data: AreaPoint[]; tone?: SignalTone; ariaLabel: string; formatY: (n: number) => string }) {
  const id = useId();
  const color = TONE_COLOR[tone];
  const max = Math.max(...data.map((d) => d.value), 1);
  // A round top for the scale: 1, 2, 2.5 or 5 times a power of ten.
  const mag = 10 ** Math.floor(Math.log10(max));
  const top = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((t) => t >= max) ?? max;
  const ticks = [1, 0.75, 0.5, 0.25, 0].map((f) => top * f);
  const p = points(data.map((d) => d.value), 100, 100, 4, top, 0);
  const line = smooth(p);
  const last = p[p.length - 1];
  return (
    <div role="img" aria-label={ariaLabel} className="flex gap-2">
      <div className="relative h-40 w-10 shrink-0 font-mono text-[10px] text-faint sm:h-48" aria-hidden="true">
        {ticks.map((t, i) => (
          <span key={i} className="absolute right-0 -translate-y-1/2 tabular-nums" style={{ top: `${(i / (ticks.length - 1)) * 92 + 4}%` }}>
            {formatY(t)}
          </span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative h-40 sm:h-48">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="sp-wipe absolute inset-0 h-full w-full" aria-hidden="true">
            <defs>
              <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" style={{ stopColor: color }} stopOpacity="0.38" />
                <stop offset="1" style={{ stopColor: color }} stopOpacity="0" />
              </linearGradient>
            </defs>
            {ticks.map((_, i) => (
              <line
                key={i}
                x1="0"
                x2="100"
                y1={(i / (ticks.length - 1)) * 92 + 4}
                y2={(i / (ticks.length - 1)) * 92 + 4}
                style={{ stroke: i === ticks.length - 1 ? COLOR.line : COLOR.lineSoft }}
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <path d={`${line} L100 100 L0 100 Z`} fill={`url(#${id})`} />
            <path d={line} fill="none" style={{ stroke: color }} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </svg>
          {last ? (
            <span
              aria-hidden="true"
              className="sp-fade absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface"
              style={{ left: `${last[0]}%`, top: `${last[1]}%`, background: color }}
            />
          ) : null}
        </div>
        <div className="mt-1.5 flex justify-between font-mono text-[10px] text-faint" aria-hidden="true">
          {data.map((d, i) => (
            <span key={i} className="min-w-0 flex-1 text-center first:text-left last:text-right">
              {d.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The orders graph: a purple-to-red line over a soft purple fill, a dashed line for the average, the busiest day named and
 * the latest day marked. Shapes scale with the card; every label is HTML so it stays sharp and readable on a phone.
 */
export function TrendChart({ data, avg, avgLabel, ariaLabel }: { data: AreaPoint[]; avg: number | null; avgLabel: string; ariaLabel: string }) {
  const id = useId();
  const values = data.map((d) => d.value);
  const top = Math.max(...values, avg ?? 0, 1) * 1.18;
  const p = points(values, 100, 100, 6, top, 0);
  const line = smooth(p);
  const last = p[p.length - 1];
  const peakIndex = values.indexOf(Math.max(...values));
  const peak = p[peakIndex];
  const avgY = avg === null ? null : 6 + (1 - avg / top) * 88;
  const mid = Math.floor((data.length - 1) / 2);
  return (
    <div role="img" aria-label={ariaLabel}>
      <div className="relative h-44 sm:h-52" aria-hidden="true">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="sp-wipe absolute inset-0 h-full w-full">
          <defs>
            <linearGradient id={`${id}f`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" style={{ stopColor: COLOR.indigo }} stopOpacity="0.42" />
              <stop offset="1" style={{ stopColor: COLOR.indigo }} stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${id}l`} x1="0" x2="100" y1="0" y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0" style={{ stopColor: COLOR.indigo }} />
              <stop offset="1" style={{ stopColor: COLOR.madder }} />
            </linearGradient>
          </defs>
          <line x1="0" x2="100" y1="99.5" y2="99.5" style={{ stroke: COLOR.line }} strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {avgY !== null ? <line x1="0" x2="100" y1={avgY} y2={avgY} style={{ stroke: COLOR.muted }} strokeOpacity="0.55" strokeWidth="1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" /> : null}
          <path d={`${line} L100 100 L0 100 Z`} fill={`url(#${id}f)`} />
          <path d={line} fill="none" stroke={`url(#${id}l)`} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
        {avgY !== null ? (
          <span className="absolute left-0 -translate-y-full pb-0.5 font-mono text-[11px] text-muted" style={{ top: `${avgY}%` }}>
            {avgLabel}
          </span>
        ) : null}
        {peak && peakIndex !== data.length - 1 ? (
          <span
            className="sp-fade absolute -translate-x-1/2 -translate-y-full whitespace-nowrap pb-1.5 font-mono text-[11px] font-bold text-ink"
            style={{ left: `${Math.min(88, Math.max(12, peak[0]))}%`, top: `${peak[1]}%` }}
          >
            peak {formatNumber(values[peakIndex])}
          </span>
        ) : null}
        {last ? (
          <>
            <span
              className="sp-fade absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-surface"
              style={{ left: `${last[0]}%`, top: `${last[1]}%`, background: COLOR.madder, boxShadow: `0 0 0 5px color-mix(in srgb, ${COLOR.madder} 22%, transparent)` }}
            />
            <span
              className="sp-fade absolute right-0 -translate-y-full whitespace-nowrap rounded-full bg-madder px-2 py-0.5 font-mono text-[11px] font-bold text-white"
              style={{ top: `calc(${last[1]}% - 12px)` }}
            >
              {formatNumber(values[values.length - 1])}
            </span>
          </>
        ) : null}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[11px] text-faint" aria-hidden="true">
        <span>{data[0]?.label}</span>
        <span>{data[mid]?.label}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
    </div>
  );
}

/** A horizontal bar that fills: a share of 0..1 of the track. */
export function Bar({ share, tone = "cyan", index = 0 }: { share: number; tone?: SignalTone; index?: number }) {
  const w = Math.max(0, Math.min(1, share));
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-line-soft" aria-hidden="true">
      <div className="sp-bar h-full rounded-full" style={{ width: `${w * 100}%`, background: TONE_COLOR[tone], ["--i" as string]: index }} />
    </div>
  );
}

// --- Breakdowns: a whole split into parts, or one row per warehouse --------------------------------------------------
// Marks are at most 14px thick with a 2px gap of card between touching parts, rounded only at the data end. Every chart
// has a legend and every value is written out, so colour is never the only way to tell parts apart. Each mark has a
// hover title with its exact value.

export type SeriesKey = { key: string; label: string; color: string };
export type BreakdownRow = { key: string; label: string; color: string; values: Record<string, number> };

const share = (value: number, total: number) => (total > 0 ? `${Math.round((value / total) * 100)}%` : "0%");

/** Swatch + label (+ value) for each series. Text stays ink and muted; the swatch beside it carries the colour. */
export function Legend({ items }: { items: (SeriesKey & { value?: string })[] }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
      {items.map((i) => (
        <li key={i.key} className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: i.color }} />
          <span className="font-bold text-ink">{i.label}</span>
          {i.value ? <span className="tabular-nums text-muted">{i.value}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** Parts of one whole on a single bar, each in its own colour, with every part's value and share in the legend. */
export function ShareBar({ parts, values, unit, ariaLabel }: { parts: SeriesKey[]; values: Record<string, number>; unit: string; ariaLabel: string }) {
  const total = parts.reduce((n, p) => n + (values[p.key] ?? 0), 0);
  const shown = parts.filter((p) => (values[p.key] ?? 0) > 0);
  return (
    <figure className="m-0">
      <div role="img" aria-label={ariaLabel} className="flex h-3.5 w-full gap-[2px]">
        {total === 0 ? (
          <div className="h-full w-full rounded bg-line-soft" />
        ) : (
          shown.map((p, i) => (
            <div
              key={p.key}
              title={`${p.label}: ${formatNumber(values[p.key])} ${unit} (${share(values[p.key], total)})`}
              className="sp-bar h-full min-w-[3px] first:rounded-l last:rounded-r"
              style={{ flexGrow: values[p.key], flexBasis: 0, background: p.color, ["--i" as string]: i }}
            />
          ))
        )}
      </div>
      <Legend items={parts.map((p) => ({ ...p, value: `${formatNumber(values[p.key] ?? 0)} · ${share(values[p.key] ?? 0, total)}` }))} />
    </figure>
  );
}

function RowLabel({ row }: { row: BreakdownRow }) {
  return (
    <span className="flex min-w-0 items-center gap-2 text-sm font-bold">
      <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: row.color }} />
      <span className="truncate">{row.label}</span>
    </span>
  );
}

/**
 * One bar per row (a warehouse), split into parts (say, order stages), all on one scale so rows compare by length.
 * The row's own colour sits in the dot beside its name; the parts take the series colours.
 */
export function StackedRows({ rows, parts, unit, ariaLabel }: { rows: BreakdownRow[]; parts: SeriesKey[]; unit: string; ariaLabel: string }) {
  const totals = rows.map((r) => parts.reduce((n, p) => n + (r.values[p.key] ?? 0), 0));
  const max = Math.max(...totals, 1);
  return (
    <figure className="m-0">
      <div role="img" aria-label={ariaLabel} className="flex flex-col gap-3">
        {rows.map((r, ri) => (
          <div key={r.key} className="grid grid-cols-[6.5rem_minmax(0,1fr)_3.5rem] items-center gap-3 sm:grid-cols-[8rem_minmax(0,1fr)_4rem]">
            <RowLabel row={r} />
            <div className="h-3.5 min-w-0">
              {totals[ri] === 0 ? (
                <div className="h-full w-full rounded bg-line-soft" title={`${r.label}: no ${unit}`} />
              ) : (
                <div className="flex h-full gap-[2px]" style={{ width: `${(totals[ri] / max) * 100}%` }}>
                  {parts
                    .filter((p) => (r.values[p.key] ?? 0) > 0)
                    .map((p, pi, shown) => (
                      <div
                        key={p.key}
                        title={`${r.label}, ${p.label}: ${formatNumber(r.values[p.key])} ${unit}`}
                        className={`sp-bar h-full min-w-[3px] ${pi === shown.length - 1 ? "rounded-r" : ""}`}
                        style={{ flexGrow: r.values[p.key], flexBasis: 0, background: p.color, ["--i" as string]: ri }}
                      />
                    ))}
                </div>
              )}
            </div>
            <span className="text-right font-mono text-sm font-bold tabular-nums">{formatNumber(totals[ri])}</span>
          </div>
        ))}
      </div>
      <Legend items={parts} />
    </figure>
  );
}

/** Two or three measures side by side for each row, on one shared scale, with each value at the tip of its bar. */
export function PairedRows({ rows, measures, ariaLabel }: { rows: BreakdownRow[]; measures: SeriesKey[]; ariaLabel: string }) {
  const max = Math.max(...rows.flatMap((r) => measures.map((m) => r.values[m.key] ?? 0)), 1);
  return (
    <figure className="m-0">
      <div role="img" aria-label={ariaLabel} className="flex flex-col gap-3">
        {rows.map((r, ri) => (
          <div key={r.key} className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
            <RowLabel row={r} />
            <div className="flex min-w-0 flex-col gap-1">
              {measures.map((m) => {
                const v = r.values[m.key] ?? 0;
                return (
                  <div key={m.key} className="grid grid-cols-[minmax(0,1fr)_2.75rem] items-center gap-2" title={`${r.label}, ${m.label}: ${formatNumber(v)}`}>
                    <div className="h-2.5">
                      {v > 0 ? <div className="sp-bar h-full rounded-r" style={{ width: `${Math.max((v / max) * 100, 1)}%`, background: m.color, ["--i" as string]: ri }} /> : null}
                    </div>
                    <span className="font-mono text-xs tabular-nums text-muted">{formatNumber(v)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <Legend items={measures} />
    </figure>
  );
}

// --- Demand against capacity -----------------------------------------------------------------------------------------

export type CapacityPoint = { label: string; value: number };

/**
 * Orders per day: the last days as a solid line, the projection as a dashed one, and two horizontal lines for what the
 * team packs comfortably and at the limit. Labels are HTML (readable at phone width); only the shapes scale.
 */
export function CapacityChart({
  past,
  future,
  comfortable,
  limit,
  ariaLabel,
}: {
  past: CapacityPoint[];
  future: CapacityPoint[];
  comfortable: number;
  limit: number;
  ariaLabel: string;
}) {
  // Formatted here, not passed in: a function cannot be handed from a server component to a chart.
  const formatY = (n: number) => (n >= 1000 ? `${formatNumber(Math.round(n / 100) / 10)}k` : formatNumber(Math.round(n)));
  const all = [...past, ...future];
  const max = Math.max(...all.map((p) => p.value), limit, 1);
  const mag = 10 ** Math.floor(Math.log10(max));
  const top = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((t) => t >= max) ?? max;
  const ticks = [1, 0.75, 0.5, 0.25, 0].map((f) => top * f);
  const n = all.length;
  const x = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v: number) => 4 + (1 - v / top) * 92;
  const line = (from: number, to: number) => all.slice(from, to + 1).map((p, k) => `${k === 0 ? "M" : "L"}${x(from + k)} ${y(p.value)}`).join(" ");
  const split = past.length - 1;
  const labelAt = [0, Math.floor((n - 1) / 2), n - 1];
  return (
    <figure className="m-0">
      <div role="img" aria-label={ariaLabel} className="flex gap-2">
        <div className="relative h-44 w-10 shrink-0 font-mono text-[10px] text-faint sm:h-52" aria-hidden="true">
          {ticks.map((t, i) => (
            <span key={i} className="absolute right-0 -translate-y-1/2 tabular-nums" style={{ top: `${y(t)}%` }}>
              {formatY(t)}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative h-44 sm:h-52">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
              {ticks.map((t, i) => (
                <line key={i} x1="0" x2="100" y1={y(t)} y2={y(t)} style={{ stroke: i === ticks.length - 1 ? COLOR.line : COLOR.lineSoft }} strokeWidth="1" vectorEffect="non-scaling-stroke" />
              ))}
              {past.length > 0 ? <line x1={x(split)} x2={x(split)} y1="4" y2="96" style={{ stroke: COLOR.line }} strokeWidth="1" vectorEffect="non-scaling-stroke" /> : null}
              <line x1="0" x2="100" y1={y(comfortable)} y2={y(comfortable)} style={{ stroke: COLOR.ok }} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              <line x1="0" x2="100" y1={y(limit)} y2={y(limit)} style={{ stroke: COLOR.danger }} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              {past.length > 1 ? <path d={line(0, split)} fill="none" style={{ stroke: COLOR.indigo }} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" /> : null}
              {future.length > 0 ? (
                <path d={line(Math.max(0, split), n - 1)} fill="none" style={{ stroke: COLOR.indigo }} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />
              ) : null}
            </svg>
            <span aria-hidden="true" className="absolute right-0 -translate-y-full rounded bg-surface/80 px-1 text-[10px] font-bold text-muted" style={{ top: `${y(limit)}%` }}>
              Most: {formatY(limit)}
            </span>
            <span aria-hidden="true" className="absolute right-0 -translate-y-full rounded bg-surface/80 px-1 text-[10px] font-bold text-muted" style={{ top: `${y(comfortable)}%` }}>
              Comfortable: {formatY(comfortable)}
            </span>
          </div>
          <div className="relative mt-1.5 h-4 font-mono text-[10px] text-faint" aria-hidden="true">
            {labelAt.map((i, k) => (
              <span key={i} className="absolute whitespace-nowrap" style={{ left: `${x(i)}%`, transform: k === 0 ? "none" : k === 2 ? "translateX(-100%)" : "translateX(-50%)" }}>
                {all[i]?.label}
              </span>
            ))}
          </div>
        </div>
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
        <li className="flex items-center gap-1.5"><span aria-hidden="true" className="h-0.5 w-5 rounded" style={{ background: COLOR.indigo }} /><span className="font-bold">Orders so far</span></li>
        <li className="flex items-center gap-1.5"><span aria-hidden="true" className="h-0 w-5 border-t-2 border-dashed" style={{ borderColor: COLOR.indigo }} /><span className="font-bold">Expected</span></li>
        <li className="flex items-center gap-1.5"><span aria-hidden="true" className="h-0.5 w-5 rounded" style={{ background: COLOR.ok }} /><span className="font-bold">Packed comfortably</span></li>
        <li className="flex items-center gap-1.5"><span aria-hidden="true" className="h-0.5 w-5 rounded" style={{ background: COLOR.danger }} /><span className="font-bold">The most the team can pack</span></li>
      </ul>
    </figure>
  );
}
