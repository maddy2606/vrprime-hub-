// SIGNAL PRO charts. Plain SVG and HTML, so every number and shape is there at rest without JavaScript;
// the draw-in animations are CSS only and switch off under prefers-reduced-motion.
import { useId } from "react";
import { TONE_COLOR, type SignalTone } from "@/lib/theme";

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
          <stop offset="0" stopColor={color} stopOpacity="0.32" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L100 32 L0 32 Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
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
        <circle cx="50" cy="50" r="42" fill="none" stroke="#1d1c2a" strokeWidth="10" />
        <circle
          cx="50"
          cy="50"
          r="42"
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${v} 100`}
          className="sp-gauge-arc"
          style={{ filter: `drop-shadow(0 0 4px ${color}66)` }}
        />
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
                <stop offset="0" stopColor={color} stopOpacity="0.38" />
                <stop offset="1" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>
            {ticks.map((_, i) => (
              <line
                key={i}
                x1="0"
                x2="100"
                y1={(i / (ticks.length - 1)) * 92 + 4}
                y2={(i / (ticks.length - 1)) * 92 + 4}
                stroke="#23222f"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
                strokeDasharray={i === ticks.length - 1 ? undefined : "3 4"}
              />
            ))}
            <path d={`${line} L100 100 L0 100 Z`} fill={`url(#${id})`} />
            <path d={line} fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </svg>
          {last ? (
            <span
              aria-hidden="true"
              className="sp-fade absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-canvas"
              style={{ left: `${last[0]}%`, top: `${last[1]}%`, background: color, boxShadow: `0 0 12px ${color}` }}
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

/** A horizontal bar that fills: a share of 0..1 of the track. */
export function Bar({ share, tone = "cyan", index = 0 }: { share: number; tone?: SignalTone; index?: number }) {
  const w = Math.max(0, Math.min(1, share));
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-line-soft" aria-hidden="true">
      <div className="sp-bar h-full rounded-full" style={{ width: `${w * 100}%`, background: TONE_COLOR[tone], ["--i" as string]: index }} />
    </div>
  );
}
