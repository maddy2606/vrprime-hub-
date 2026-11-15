import Link from "next/link";
import type { ReactNode } from "react";
import { Chip } from "@/components/ui";
import { formatNumber } from "@/lib/format";
import { STAGE_COLOR } from "@/lib/theme";

/**
 * The warehouse lanes, the signature visual (glass-spec section 5). One row per warehouse: a glowing dot, the name and
 * a status chip; a 30px track holding To Accept → To Pack → To Dispatch, drawn to one shared scale so lanes compare by
 * length, each segment with its count (hidden under 34px wide); a red late marker at the track's right edge; under the
 * track the note on the left and "next dispatch …" on the right; the active count on the right. Every number is on the
 * page at rest; the segments grow in once.
 */
export type Lane = {
  id: string;
  name: string;
  color: string;
  stages: { to_accept: number; to_pack: number; to_dispatch: number };
  /** Orders already past their dispatch time: the late marker. */
  late?: number;
  /** "Today 4:00 pm", or null when nothing is waiting. */
  next?: string | null;
  /** The status chip after the name. */
  chip?: { label: string; tone: "ok" | "warn" | "bad" | "neutral" };
  /** Shown at the right end: the figure and a line under it. */
  figure?: { value: number; label: string };
  /** The line under the track, on the left (on-time share, or Upcoming · Processing · In transit). */
  note?: ReactNode;
  href?: string;
  /** Pressed state when the lane is a filter button. */
  selected?: boolean;
  onSelect?: () => void;
};

/** Segment text: the light first stage takes ink, the two stronger stages take --accent-ink, in both modes. */
const STAGES = [
  { key: "to_accept", label: "To Accept", color: STAGE_COLOR.to_accept, ink: "text-ink" },
  { key: "to_pack", label: "To Pack", color: STAGE_COLOR.to_pack, ink: "text-accent-ink" },
  { key: "to_dispatch", label: "To Dispatch", color: STAGE_COLOR.to_dispatch, ink: "text-accent-ink" },
] as const;

const total = (l: Lane) => l.stages.to_accept + l.stages.to_pack + l.stages.to_dispatch;

export function laneAria(l: Lane): string {
  return `${l.name}: ${formatNumber(l.stages.to_accept)} to accept, ${formatNumber(l.stages.to_pack)} to pack, ${formatNumber(l.stages.to_dispatch)} to dispatch${l.late ? `, ${formatNumber(l.late)} late` : ""}${l.next ? `, next dispatch ${l.next}` : ""}`;
}

function Track({ lane, max, index }: { lane: Lane; max: number; index: number }) {
  const n = total(lane);
  const width = n > 0 ? Math.max(2, (n / max) * 100) : 0;
  const parts = STAGES.filter((s) => lane.stages[s.key] > 0);
  return (
    <div className="relative h-[30px] w-full overflow-hidden rounded-[10px] bg-surface2" aria-hidden="true">
      {n > 0 ? (
        <div className="absolute inset-y-0 left-0 flex gap-[2px]" style={{ width: `${width}%` }}>
          {parts.map((s, i) => (
            <div
              key={s.key}
              title={`${s.label}: ${formatNumber(lane.stages[s.key])}`}
              className="lane-seg sp-bar flex h-full min-w-[3px] items-center justify-center overflow-hidden"
              style={{ flexGrow: lane.stages[s.key], flexBasis: 0, background: s.color, ["--i" as string]: index * 3 + i }}
            >
              <span className={`lane-count font-mono text-[12px] font-semibold tabular-nums ${s.ink}`}>{formatNumber(lane.stages[s.key])}</span>
            </div>
          ))}
        </div>
      ) : null}
      {lane.late ? <div className="vr-blink absolute inset-y-0 right-0 w-[3px] bg-bad text-bad" style={{ boxShadow: "var(--glow)" }} /> : null}
    </div>
  );
}

export function Lanes({ lanes, ariaLabel, legend = true, className = "" }: { lanes: Lane[]; ariaLabel: string; legend?: boolean; className?: string }) {
  const max = Math.max(1, ...lanes.map(total));
  return (
    <figure className={`m-0 ${className}`}>
      <ul role="img" aria-label={ariaLabel} className="m-0 flex list-none flex-col p-0">
        {lanes.map((l, index) => {
          const n = total(l);
          const head = (
            <span className="flex min-w-0 items-center gap-2">
              <span aria-hidden="true" className="wh-dot" style={{ background: l.color, color: l.color }} />
              <span className="truncate text-sm font-semibold">{l.name}</span>
              {l.chip ? <Chip tone={l.chip.tone}>{l.chip.label}</Chip> : null}
            </span>
          );
          const tail = (
            <span className="flex shrink-0 items-baseline gap-1.5 text-right sm:flex-col sm:items-end sm:gap-0.5">
              <span className="font-display text-[20px] font-medium leading-none tabular-nums">{formatNumber(l.figure?.value ?? n)}</span>
              <span className="t-caption">{l.figure?.label ?? "active"}</span>
            </span>
          );
          const body = (
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 py-3 sm:grid-cols-[minmax(9rem,13rem)_minmax(0,1fr)_auto] sm:gap-x-4">
              {head}
              <div className="order-last col-span-2 sm:order-none sm:col-span-1">
                <Track lane={l} max={max} index={index} />
                <p className="t-caption mt-1.5 flex flex-wrap justify-between gap-x-3 gap-y-0.5">
                  <span>{l.note}</span>
                  <span className={l.late ? "font-semibold text-bad" : ""}>
                    {l.late ? `${formatNumber(l.late)} late · ` : ""}
                    {l.next ? `next dispatch ${l.next}` : n > 0 ? "" : "no orders waiting"}
                  </span>
                </p>
              </div>
              {tail}
            </div>
          );
          const cls = "focus-ring block w-full rounded-[var(--radius)] px-2 text-left transition-colors duration-160 hover:bg-surface2";
          return (
            <li key={l.id} aria-label={laneAria(l)} className="border-b border-line-soft last:border-b-0">
              {l.onSelect ? (
                <button type="button" aria-pressed={l.selected} onClick={l.onSelect} className={`${cls} ${l.selected ? "bg-accent-soft" : ""}`}>
                  {body}
                </button>
              ) : l.href ? (
                <Link prefetch={false} href={l.href} className={cls}>
                  {body}
                </Link>
              ) : (
                <div className="px-2">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
      {legend ? (
        <figcaption className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {STAGES.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
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
