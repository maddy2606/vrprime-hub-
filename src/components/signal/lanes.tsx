import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { warehouseHealth } from "@/lib/deck";
import { formatNumber } from "@/lib/format";

/**
 * The flow map (graphite-spec section 5), which replaces the warehouse lanes everywhere and keeps their name and props.
 * A header with each stage's total; one row per warehouse: its dot, name and captions; the To accept, To pack and To
 * dispatch counts in chips over one stream line in the warehouse colour, thicker for more active orders, with dots
 * moving left to right; the next pickup time and the state on the right. A footer line explains the picture.
 */
export type Lane = {
  id: string;
  name: string;
  color: string;
  stages: { to_accept: number; to_pack: number; to_dispatch: number };
  /** Orders already past their dispatch time. */
  late?: number;
  /** "Today 4:00 pm", or null when nothing is waiting. */
  next?: string | null;
  /** The warehouse's status (late, due soon, on time): picks the state line under the next pickup. */
  chip?: { label: string; tone: "ok" | "warn" | "bad" | "neutral" };
  /** The active count (the stream's thickness) and its old label. */
  figure?: { value: number; label: string };
  /** A second caption under the name (Flipkart Orders: Upcoming · Processing · In transit · on hold). */
  note?: ReactNode;
  /** Units out (Command Centre); left out where the page has no such figure. */
  out?: number | null;
  href?: string;
  /** Pressed state when the row is a filter button. */
  selected?: boolean;
  onSelect?: () => void;
};

const STAGES = [
  { key: "to_accept", label: "To accept" },
  { key: "to_pack", label: "To pack" },
  { key: "to_dispatch", label: "To dispatch" },
] as const;

const total = (l: Lane) => l.stages.to_accept + l.stages.to_pack + l.stages.to_dispatch;
const activeOf = (l: Lane) => l.figure?.value ?? total(l);

export function laneAria(l: Lane): string {
  return `${l.name}: ${formatNumber(l.stages.to_accept)} to accept, ${formatNumber(l.stages.to_pack)} to pack, ${formatNumber(l.stages.to_dispatch)} to dispatch${l.late ? `, ${formatNumber(l.late)} late` : ""}${l.next ? `, next pickup ${l.next}` : ""}`;
}

/** The state under the next pickup: "N late" (amber, 600), "Due soon" (amber), "All on time" (green) or "Nothing waiting". */
function State({ lane }: { lane: Lane }) {
  const late = lane.late ?? 0;
  if (late > 0) return <span className="font-semibold text-warn">{formatNumber(late)} late</span>;
  if (activeOf(lane) === 0) return <span className="text-muted">Nothing waiting</span>;
  if (lane.chip && (lane.chip.tone === "warn" || lane.chip.tone === "bad")) return <span className="text-warn">Due soon</span>;
  return <span className="text-ok">All on time</span>;
}

function Captions({ lane }: { lane: Lane }) {
  const active = activeOf(lane);
  const pct = warehouseHealth({ active, late: lane.late ?? 0, nextDue: null }, new Date(0)).pct;
  return (
    <>
      <span className="t-caption block">
        {pct}% on time · {formatNumber(active)} active{lane.out === null || lane.out === undefined ? "" : ` · ${formatNumber(lane.out)} out`}
      </span>
      {lane.note ? <span className="t-caption block">{lane.note}</span> : null}
    </>
  );
}

function Row({ lane, maxActive }: { lane: Lane; maxActive: number }) {
  const active = activeOf(lane);
  const idle = active === 0;
  const height = idle ? 2 : Math.max(2, Math.round((18 * active) / maxActive));
  const style = { ["--wh" as string]: lane.color } as CSSProperties;
  const next = (
    <>
      <span className="flow-next block">{lane.next ?? "—"}</span>
      <span className="block text-[12px] leading-4">
        <State lane={lane} />
      </span>
    </>
  );
  const body = (
    <div className="flow-row flow-grid" style={style}>
      <div className="min-w-0">
        <span className="flex min-w-0 items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            <span aria-hidden="true" className="flow-dot" style={{ background: lane.color }} />
            <span className="flow-name truncate">{lane.name}</span>
          </span>
          <span className="shrink-0 text-[12px] leading-4 min-[700px]:hidden">
            <State lane={lane} />
          </span>
        </span>
        <span className="mt-0.5 block max-[699.98px]:hidden">
          <Captions lane={lane} />
        </span>
      </div>
      <div className="flow-stages" aria-hidden="true">
        <span className={`flow-stream ${idle ? "is-idle" : ""}`} style={{ height }}>
          {idle ? null : <span className="flow-stream-dots" />}
        </span>
        {STAGES.map((s) => (
          <span key={s.key} className="flow-stage">
            <span className="flow-stage-label t-label">{s.label}</span>
            <span className={`flow-chip ${idle ? "is-idle" : ""}`}>{formatNumber(lane.stages[s.key])}</span>
          </span>
        ))}
      </div>
      <div className="min-w-0 text-right max-[699.98px]:hidden">{next}</div>
      <div className="flex items-end justify-between gap-3 min-[700px]:hidden">
        <span className="min-w-0">
          <Captions lane={lane} />
        </span>
        <span className="shrink-0 text-right">
          <span className="flow-next block">{lane.next ?? "—"}</span>
        </span>
      </div>
    </div>
  );
  const cls = "focus-ring block w-full text-left transition-colors duration-160 hover:bg-panel2";
  if (lane.onSelect) {
    return (
      <button type="button" aria-pressed={lane.selected} onClick={lane.onSelect} className={`${cls} ${lane.selected ? "bg-accent-soft" : ""}`}>
        {body}
      </button>
    );
  }
  if (lane.href) {
    return (
      <Link prefetch={false} href={lane.href} className={cls}>
        {body}
      </Link>
    );
  }
  return body;
}

export function Lanes({ lanes, ariaLabel, className = "" }: { lanes: Lane[]; ariaLabel: string; legend?: boolean; className?: string }) {
  const maxActive = Math.max(1, ...lanes.map(activeOf));
  const totals = STAGES.map((s) => lanes.reduce((n, l) => n + l.stages[s.key], 0));
  const active = lanes.reduce((n, l) => n + activeOf(l), 0);
  const late = lanes.reduce((n, l) => n + (l.late ?? 0), 0);
  return (
    <figure className={`m-0 ${className}`}>
      <div className="flow-head flow-grid" aria-hidden="true">
        <span className="t-label">Warehouse</span>
        {STAGES.map((s, i) => (
          <span key={s.key} className="text-center">
            <span className="t-label block">{s.label}</span>
            <span className="flow-stage-total block">{formatNumber(totals[i])}</span>
          </span>
        ))}
        <span className="t-label text-right">Next pickup</span>
      </div>
      <ul role="img" aria-label={ariaLabel} className="m-0 list-none p-0">
        {lanes.map((l) => (
          <li key={l.id} aria-label={laneAria(l)}>
            <Row lane={l} maxActive={maxActive} />
          </li>
        ))}
      </ul>
      <figcaption className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="t-caption">Orders move left to right. A thicker line means more orders.</span>
        <span className="t-caption">
          <b className="font-semibold text-ink tabular-nums">{formatNumber(active)}</b> active
          {late > 0 ? (
            <>
              {" · "}
              <b className="font-semibold text-warn tabular-nums">{formatNumber(late)}</b> late
            </>
          ) : null}
        </span>
      </figcaption>
    </figure>
  );
}
