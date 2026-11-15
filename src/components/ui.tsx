import Link from "next/link";
import type { ReactNode } from "react";
import { InboxIcon } from "@/components/icons";
import { Sparkline } from "@/components/signal/charts";
import { CountUp } from "@/components/signal/count-up";
import {
  PRIORITY_LABEL,
  PRIORITY_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  TYPE_LABEL,
  TYPE_TONE,
  type Tone,
} from "@/lib/labels";
import type { PostStatus, PostType, Priority } from "@/lib/types";

// Aurora Glass shared components (glass-spec section 4). Every look lives in globals.css; these only pick classes.

/** A pill in a tone. `live` makes a late chip breathe (the only looping chip, spec section 6). */
export function Chip({ tone = "neutral", live = false, children }: { tone?: Tone; live?: boolean; children: ReactNode }) {
  return <span className={`g-chip ${tone === "neutral" ? "" : `tone-${tone}`} ${live ? "vr-blink" : ""}`}>{children}</span>;
}

/** Red count bubble for unread notifications. Renders nothing for zero. */
export function UnreadBadge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-bad px-1 font-mono text-[11px] font-semibold leading-none text-bad-ink">
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function StatusChip({ status }: { status: PostStatus }) {
  return <Chip tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Chip>;
}
export function TypeChip({ type }: { type: PostType }) {
  return <Chip tone={TYPE_TONE[type]}>{TYPE_LABEL[type]}</Chip>;
}
export function PriorityChip({ priority }: { priority: Priority }) {
  return <Chip tone={PRIORITY_TONE[priority]}>{PRIORITY_LABEL[priority]}</Chip>;
}

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
/** Class names for buttons and button-like links: 40px tall, radius 12px, 13px 600. */
export function buttonClass(variant: ButtonVariant = "secondary", extra = ""): string {
  return `g-btn g-btn-${variant} focus-ring ${extra}`;
}

export function Field({
  label,
  htmlFor,
  required,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-semibold">
        {label}
        {required ? <span className="text-bad"> *</span> : <span className="font-normal text-muted"> (optional)</span>}
      </label>
      {children}
      {error ? <p className="t-caption font-semibold text-bad">{error}</p> : hint ? <p className="t-caption">{hint}</p> : null}
    </div>
  );
}

export function Card({ children, className = "", hero = false }: { children: ReactNode; className?: string; hero?: boolean }) {
  return <section className={`sp-card ${hero ? "sp-hero" : ""} ${className}`}>{children}</section>;
}

/** Centred in its card: a 32px icon, a title, a line of body, an action below. */
export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="sp-card g-pad flex flex-col items-center py-10 text-center">
      <InboxIcon className="h-8 w-8 text-faint" />
      <p className="t-card-title mt-3">{title}</p>
      <p className="t-caption mx-auto mt-1 max-w-sm">{body}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** The page's first line: a title, an optional line under it, and the page's actions on the right. */
export function PageTitle({ title, sub, action }: { title: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="t-h1">{title}</h1>
        {sub ? <div className="t-caption mt-1">{sub}</div> : null}
      </div>
      {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}

/** A card's header: title left, a caption under it, an action on the right; 14px above the content. */
export function SectionHead({ title, sub, action, id, className = "" }: { title: ReactNode; sub?: ReactNode; action?: ReactNode; id?: string; className?: string }) {
  return (
    <header className={`g-head flex flex-wrap items-start justify-between gap-x-4 gap-y-2 ${className}`}>
      <div className="min-w-0">
        <h2 id={id} className="t-card-title">
          {title}
        </h2>
        {sub ? <p className="t-caption mt-0.5">{sub}</p> : null}
      </div>
      {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
    </header>
  );
}

const NUM_TONE: Record<Tone | "ink", string> = {
  neutral: "text-ink",
  ink: "text-ink",
  accent: "text-accent-text",
  info: "text-info",
  ok: "text-ok",
  warn: "text-warn",
  bad: "text-bad",
};

/** A figure inside a headline sentence: Unbounded 500, coloured by tone. */
export function Num({ tone = "ink", children }: { tone?: Tone | "ink"; children: ReactNode }) {
  return <em className={`t-num tabular-nums not-italic ${NUM_TONE[tone]}`}>{children}</em>;
}

/**
 * The headline sentence of a page, with its numbers in Unbounded and coloured. Pass the sentence as children with
 * figures wrapped in <Num>, or pass `text` and every run of digits is picked out in `tone`.
 */
export function Headline({ children, text, tone = "ink", className = "" }: { children?: ReactNode; text?: string; tone?: Tone | "ink"; size?: "lg" | "md"; className?: string }) {
  const body = text !== undefined ? withNumbers(text, tone) : children;
  return <p className={`t-headline text-balance ${className}`}>{body}</p>;
}

/** Splits a sentence so every number (1,250 · 2 · 9.4) is wrapped in <Num>. */
export function withNumbers(text: string, tone: Tone | "ink" = "ink"): ReactNode[] {
  const parts = text.split(/(\d[\d,.]*)/);
  return parts.map((part, i) => (i % 2 === 1 ? <Num key={i} tone={tone}>{part}</Num> : part));
}

/** One card split into equal cells by gradient dividers. Children are <Stat>. Phone: scrolls sideways. */
export function StatStrip({ children, className = "", ariaLabel }: { children: ReactNode; className?: string; ariaLabel?: string }) {
  return (
    <dl className={`sp-card stat-strip m-0 ${className}`} aria-label={ariaLabel}>
      {children}
    </dl>
  );
}

/**
 * One cell of a stat strip: Label, the Stat number (counts up once when it is a plain number), a caption, and an
 * optional sparkline 36px tall along the bottom. A link when `href`.
 */
export function Stat({
  label,
  value,
  sub,
  tone = "ink",
  href,
  chart,
  spark,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone | "ink";
  href?: string;
  chart?: ReactNode;
  /** Values for the 36px sparkline, oldest first. */
  spark?: { values: number[]; label: string };
  size?: "md" | "lg";
}) {
  const body = (
    <>
      <dt className="t-label">{label}</dt>
      <dd className={`t-stat m-0 mt-2 ${NUM_TONE[tone]}`}>{typeof value === "number" ? <CountUp value={value} className="font-display" /> : value}</dd>
      {sub ? <dd className="t-caption m-0 mt-1.5">{sub}</dd> : null}
      {chart ? <dd className="m-0 mt-3">{chart}</dd> : null}
      {spark && spark.values.length > 1 ? (
        <dd className="m-0 mt-3">
          <Sparkline values={spark.values} label={spark.label} className="h-9 w-full" />
        </dd>
      ) : null}
    </>
  );
  if (href) {
    return (
      <div>
        <Link prefetch={false} href={href} className="focus-ring block rounded-[var(--radius)] transition-colors duration-160 hover:text-accent-text">
          {body}
        </Link>
      </div>
    );
  }
  return <div>{body}</div>;
}

export function PostListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="g-cards">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="sp-card g-pad">
          <div className="skeleton h-4 w-32" />
          <div className="skeleton mt-3 h-5 w-4/5" />
          <div className="skeleton mt-3 h-4 w-1/2" />
        </div>
      ))}
    </div>
  );
}
