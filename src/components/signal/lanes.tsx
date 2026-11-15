import Link from "next/link";
import type { ReactNode } from "react";
import { Chip } from "@/components/ui";
import { formatNumber } from "@/lib/format";
import { STAGE_COLOR } from "@/lib/theme";

/**
 * The warehouse lanes: the product's signature picture of the day. One lane per warehouse; orders flow left to right
 * through To Accept → To Pack → To Dispatch, drawn to one shared scale so lanes compare by length; late orders are
 * the red block at the gate on the right; the next pickup time is written at the end of the lane. Plain HTML and
 * CSS, so every number is on the page at rest; the fill is the page's one load animation.
 */
export type Lane = {
  id: string;
  name: string;
  color: string;
  stages: { to_accept: number; to_pack: number; to_dispatch: number };
  /** Orders already past their dispatch time, drawn as the red block at the gate. */
  late?: number;
  /** "Today 4:00 pm", or null when nothing is waiting. */
  next?: string | null;
  /** A chip after the name: on-time health, or whatever the page wants to say about this lane. */
  chip?: { label: string; tone: "ok" | "warn" | "bad" | "neutral" };
  /** Shown at the right end: the figure and a line under it. */
  figure?: { value: number; label: string };
  /** One muted line under the track (Upcoming · Processing · In transit). */
  note?: ReactNode;
  href?: string;
  /** Pressed state when the lane is a filter button. */
  selected?: boolean;
  onSelect?: () => void;
};

const STAGES = [
  { key: "to_accept", label: "To Accept", color: STAGE_COLOR.to_accept },
  { key: "to_pack", label: "To Pack", color: STAGE_COLOR.to_pack },
  { key: "to_dispatch", label: "To Dispatch", color: STAGE_COLOR.to_dispatch },
] as const;

const total = (l: Lane) => l.stages.to_accept + l.stages.to_pack + l.stages.to_dispatch;

export function laneAria(l: Lane): string {
  return `${l.name}: ${formatNumber(l.stages.to_accept)} to accept, ${formatNumber(l.stages.to_pack)} to pack, ${formatNumber(l.stages.to_dispatch)} to dispatch${l.late ? `, ${formatNumber(l.late)} late` : ""}${l.next ? `, next dispatch ${l.next}` : ""}`;
}

function Track({ lane, max }: { lane: Lane; max: number }) {
  const n = total(lane);
  const width = n > 0 ? Math.max(2, (n / max) * 100) : 0;
  const parts = STAGES.filter((s) => lane.stages[s.key] > 0);
  return (
    <div className="relative h-8 w-full" aria-hidden="true">
      {/* The lane itself: a faint track to the gate. */}
      <div className="absolute inset-y-0 left-0 right-0 rounded-md bg-surface2/70" />
      {n > 0 ? (
        <div className="sp-bar absolute inset-y-0 left-0 flex gap-[2px]" style={{ width: `${width}%` }}>
          {parts.map((s, i) => {
            const share = lane.stages[s.key] / n;
            return (
              <div
                key={s.key}
                title={`${s.label}: ${formatNumber(lane.stages[s.key])}`}
                className={`relative flex h-full min-w-[4px] items-center justify-center overflow-hidden ${i === 0 ? "rounded-l-md" : ""} ${i === parts.length - 1 ? "rounded-r-md" : ""}`}
                style={{ flexGrow: lane.stages[s.key], flexBasis: 0, background: s.color }}
              >
                {share * width > 9 ? <span className="font-mono text-[11px] font-semibold text-white mix-blend-difference">{formatNumber(lane.stages[s.key])}</span> : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {/* The gate: a hairline at the end of every lane; red and labelled when orders are late. */}
      <div className={`absolute inset-y-0 right-0 w-[3px] rounded-full ${lane.late ? "bg-bad" : "bg-line"}`} />
    </div>
  );
}

export function Lanes({ lanes, ariaLabel, legend = true, className = "" }: { lanes: Lane[]; ariaLabel: string; legend?: boolean; className?: string }) {
  const max = Math.max(1, ...lanes.map(total));
  return (
    <figure className={`m-0 ${className}`}>
      <ul role="img" aria-label={ariaLabel} className="flex flex-col divide-y divide-line-soft">
        {lanes.map((l) => {
          const n = total(l);
          const head = (
            <span className="flex min-w-0 items-center gap-2">
              <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: l.color }} />
              <span className="truncate text-sm font-semibold">{l.name}</span>
              {l.chip ? <Chip tone={l.chip.tone}>{l.chip.label}</Chip> : null}
            </span>
          );
          const tail = (
            <span className="flex shrink-0 items-baseline gap-1.5 text-right sm:flex-col sm:items-end sm:gap-0">
              <span className="font-mono text-base font-semibold tabular-nums leading-none">{formatNumber(l.figure?.value ?? n)}</span>
              <span className="text-[11px] text-muted">{l.figure?.label ?? "active"}</span>
            </span>
          );
          const body = (
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 py-2.5 sm:grid-cols-[minmax(9rem,13rem)_minmax(0,1fr)_auto] sm:gap-x-4">
              {head}
              <div className="order-last col-span-2 sm:order-none sm:col-span-1">
                <Track lane={l} max={max} />
                <p className="mt-1 flex justify-between gap-2 text-[11px] text-muted">
                  <span className="truncate">{l.note}</span>
                  <span className={`shrink-0 ${l.late ? "font-semibold text-bad" : ""}`}>{l.late ? `${formatNumber(l.late)} late · ` : ""}{l.next ? `next dispatch ${l.next}` : n > 0 ? "" : "no orders waiting"}</span>
                </p>
              </div>
              {tail}
            </div>
          );
          const cls = "focus-ring block w-full rounded-md text-left transition-colors hover:bg-surface2/60";
          return (
            <li key={l.id} aria-label={laneAria(l)}>
              {l.onSelect ? (
                <button type="button" aria-pressed={l.selected} onClick={l.onSelect} className={`${cls} ${l.selected ? "bg-accent-soft/60" : ""}`}>
                  {body}
                </button>
              ) : l.href ? (
                <Link prefetch={false} href={l.href} className={cls}>
                  {body}
                </Link>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>
      {legend ? (
        <figcaption className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {STAGES.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
              <span className="font-semibold text-ink">{s.label}</span>
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2.5 w-[3px] rounded-full bg-bad" />
            <span className="font-semibold text-ink">Late at the gate</span>
          </span>
        </figcaption>
      ) : null}
    </figure>
  );
}
