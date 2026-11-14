import Link from "next/link";
import type { ReactNode } from "react";
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

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-surface2 text-muted",
  accent: "bg-accent-soft text-accent-text",
  info: "bg-info-soft text-info",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
};

export function Chip({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
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
const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink hover:brightness-110 active:brightness-95",
  secondary: "border border-line bg-surface text-ink hover:bg-surface2",
  outline: "border border-line bg-transparent text-ink hover:bg-surface2",
  ghost: "text-accent-text hover:bg-accent-soft",
  danger: "border border-line bg-surface text-bad hover:bg-bad-soft",
};
/** Class names for buttons and button-like links. Tap targets are at least 44px tall. */
export function buttonClass(variant: ButtonVariant = "secondary", extra = ""): string {
  return `focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_VARIANT[variant]} ${extra}`;
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
      <label htmlFor={htmlFor} className="text-sm font-semibold">
        {label}
        {required ? <span className="text-bad"> *</span> : <span className="font-normal text-muted"> (optional)</span>}
      </label>
      {children}
      {error ? <p className="text-sm font-medium text-bad">{error}</p> : hint ? <p className="text-sm text-muted">{hint}</p> : null}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`sp-card ${className}`}>{children}</section>;
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-5 py-10 text-center">
      <p className="text-base font-semibold">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{body}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** The page's first line: a title, an optional line under it, and the page's one action on the right. */
export function PageTitle({ title, sub, action }: { title: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-[1.75rem] font-semibold leading-tight tracking-[-0.02em]">{title}</h1>
        {sub ? <div className="mt-1 text-sm text-muted">{sub}</div> : null}
      </div>
      {action}
    </div>
  );
}

/** A section's heading inside a page: title, a line under it, an action on the right. */
export function SectionHead({ title, sub, action, id, className = "" }: { title: ReactNode; sub?: ReactNode; action?: ReactNode; id?: string; className?: string }) {
  return (
    <header className={`mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1 ${className}`}>
      <div className="min-w-0">
        <h2 id={id} className="font-display text-[1.0625rem] font-semibold leading-snug tracking-[-0.01em]">
          {title}
        </h2>
        {sub ? <p className="mt-0.5 text-xs text-muted">{sub}</p> : null}
      </div>
      {action}
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

/** A figure inside a sentence, in the mono face and a status colour. */
export function Num({ tone = "ink", children }: { tone?: Tone | "ink"; children: ReactNode }) {
  return <em className={NUM_TONE[tone]}>{children}</em>;
}

/**
 * The headline sentence of a page: "1 order is late, and 2 selling SKUs are out of stock", with its numbers set in
 * the mono face and coloured. Pass the sentence as children, with figures wrapped in <Num>; or pass `text` and every
 * run of digits is picked out in `tone` for you.
 */
export function Headline({ children, text, tone = "ink", size = "lg", className = "" }: { children?: ReactNode; text?: string; tone?: Tone | "ink"; size?: "lg" | "md"; className?: string }) {
  const body = text !== undefined ? withNumbers(text, tone) : children;
  const sizeClass = size === "lg" ? "text-[1.6rem] leading-[1.2] sm:text-[2rem]" : "text-xl leading-snug sm:text-2xl";
  return <p className={`headline font-display font-semibold tracking-[-0.02em] text-balance ${sizeClass} ${className}`}>{body}</p>;
}

/** Splits a sentence so every number (1,250 · 2 · 9.4) is wrapped in <Num>. */
export function withNumbers(text: string, tone: Tone | "ink" = "ink"): ReactNode[] {
  const parts = text.split(/(\d[\d,.]*)/);
  return parts.map((part, i) => (i % 2 === 1 ? <Num key={i} tone={tone}>{part}</Num> : part));
}

/** Numbers side by side, divided by hairlines (see .stat-strip in globals.css). Children are <Stat>. */
export function StatStrip({ children, className = "", ariaLabel }: { children: ReactNode; className?: string; ariaLabel?: string }) {
  return (
    <dl className={`stat-strip ${className}`} aria-label={ariaLabel}>
      {children}
    </dl>
  );
}

/** One figure in a strip: label, the value in mono, a line under it, an optional small chart below. Link when `href`. */
export function Stat({
  label,
  value,
  sub,
  tone = "ink",
  href,
  chart,
  size = "md",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone | "ink";
  href?: string;
  chart?: ReactNode;
  size?: "md" | "lg";
}) {
  const body = (
    <>
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className={`mt-1 font-mono font-semibold leading-none tracking-[-0.03em] tabular-nums ${size === "lg" ? "text-[2rem]" : "text-2xl"} ${NUM_TONE[tone]}`}>{value}</dd>
      {sub ? <dd className="mt-1.5 text-xs text-muted">{sub}</dd> : null}
      {chart ? <dd className="mt-2">{chart}</dd> : null}
    </>
  );
  if (href) {
    return (
      <div>
        <Link prefetch={false} href={href} className="focus-ring block rounded-md transition-colors hover:text-accent-text">
          {body}
        </Link>
      </div>
    );
  }
  return <div>{body}</div>;
}

export function PostListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="grid grid-cols-1 gap-2 lg:grid-cols-2 2xl:grid-cols-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="sp-card p-3">
          <div className="skeleton h-4 w-32" />
          <div className="skeleton mt-3 h-5 w-4/5" />
          <div className="skeleton mt-3 h-4 w-1/2" />
        </div>
      ))}
    </div>
  );
}
