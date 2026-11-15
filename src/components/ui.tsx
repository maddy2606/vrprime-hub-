import Link from "next/link";
import type { ReactNode } from "react";
import {
  AlertIcon,
  BoxIcon,
  ClockIcon,
  InboxIcon,
  MegaphoneIcon,
  ReturnIcon,
  RupeeIcon,
  StarIcon,
  TicketIcon,
  TrendIcon,
  UsersIcon,
} from "@/components/icons";
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
import type { SignalTone } from "@/lib/theme";
import type { PostStatus, PostType, Priority } from "@/lib/types";

// Graphite shared components (graphite-spec section 4). Every look lives in globals.css; these only pick classes.

/** A pill in a tone. `live` makes a late chip breathe (the only looping chip). */
export function Chip({ tone = "neutral", live = false, children }: { tone?: Tone; live?: boolean; children: ReactNode }) {
  return <span className={`g-chip ${tone === "neutral" ? "" : `tone-${tone}`} ${live ? "vr-blink" : ""}`}>{children}</span>;
}

/** Red count bubble for unread notifications. Renders nothing for zero. */
export function UnreadBadge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-bad px-1 text-[11px] font-semibold leading-none tabular-nums text-bad-ink">
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

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "row";
/**
 * Class names for buttons and button-like links: 44px tall, radius 12px, 13px 600. "row" is the row action button:
 * secondary, 40px tall, 12px text.
 */
export function buttonClass(variant: ButtonVariant = "secondary", extra = ""): string {
  if (variant === "row") return `g-btn g-btn-secondary g-btn-row focus-ring ${extra}`;
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

/** A Card: --surface, 1px --line, radius 18px, no shadow, no blur. `hero` is kept for old callers and draws an ordinary Card. */
export function Card({ children, className = "" }: { children: ReactNode; className?: string; hero?: boolean }) {
  return <section className={`sp-card ${className}`}>{children}</section>;
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

/** The page header: title left with the subtitle under it; the main action (primary) and others on the right. */
export function PageTitle({ title, sub, action }: { title: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="t-h1">{title}</h1>
        {sub ? <div className="t-headline mt-1">{sub}</div> : null}
      </div>
      {action ? <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{action}</div> : null}
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
      {action ? <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{action}</div> : null}
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

/** A figure inside a page subtitle: 600, --ink, or the tone colour when late or low. */
export function Num({ tone = "ink", children }: { tone?: Tone | "ink"; children: ReactNode }) {
  return <em className={`t-num tabular-nums not-italic ${NUM_TONE[tone]}`}>{children}</em>;
}

/**
 * The page subtitle (the old headline sentence): Inter 14/20, --muted, its numbers 600 in --ink or a tone colour. Pass
 * the sentence as children with figures wrapped in <Num>, or pass `text` and every run of digits is picked out in `tone`.
 */
export function Headline({ children, text, tone = "ink", className = "" }: { children?: ReactNode; text?: string; tone?: Tone | "ink"; size?: "lg" | "md"; className?: string }) {
  const body = text !== undefined ? withNumbers(text, tone) : children;
  return <p className={`t-headline text-pretty ${className}`}>{body}</p>;
}

/** Splits a sentence so every number (1,250 · 2 · 9.4) is wrapped in <Num>. */
export function withNumbers(text: string, tone: Tone | "ink" = "ink"): ReactNode[] {
  const parts = text.split(/(\d[\d,.]*)/);
  return parts.map((part, i) => (i % 2 === 1 ? <Num key={i} tone={tone}>{part}</Num> : part));
}

// --- Icon badge -------------------------------------------------------------------------------------------------------

export type Tint = "violet" | "blue" | "green" | "amber" | "red";

/** A square icon badge in one of five tints: 38px (46px in KPI cards). */
export function IconBadge({ icon, tint = "violet", large = false }: { icon: ReactNode; tint?: Tint; large?: boolean }) {
  return (
    <span aria-hidden="true" className={`icon-badge tint-${tint} ${large ? "is-lg" : ""}`}>
      {icon}
    </span>
  );
}

/** What a stat is about, which picks its icon and tint (graphite-spec section 4, KPI card table). */
export type KpiKind = "orders" | "time" | "stock-alert" | "tickets" | "money" | "ads" | "returns" | "reviews" | "people" | "trend";

/** Reads what a stat is about from its label, in the order of the spec's table where words overlap. */
export function kpiKind(label: string): KpiKind {
  const l = label.toLowerCase();
  if (/ticket/.test(l)) return "tickets";
  if (/out of stock|low stock|stock-out|weight|price/.test(l)) return "stock-alert";
  if (/return|cancel/.test(l)) return "returns";
  if (/review|rating/.test(l)) return "reviews";
  if (/\bads?\b|campaign|ad spend/.test(l)) return "ads";
  if (/people|attendance|staff|present|absent|team|on leave/.test(l)) return "people";
  if (/forecast|trend|target|pace|avg|average/.test(l)) return "trend";
  if (/sales|revenue|profit|cost|fee|value|money|margin|spend|₹/.test(l)) return "money";
  if (/on time|late|due|pickup|overdue|today so far|yesterday/.test(l)) return "time";
  return "orders";
}

const KPI_ICON: Record<KpiKind, ReactNode> = {
  orders: <BoxIcon />,
  time: <ClockIcon />,
  "stock-alert": <AlertIcon />,
  tickets: <TicketIcon />,
  money: <RupeeIcon />,
  ads: <MegaphoneIcon />,
  returns: <ReturnIcon />,
  reviews: <StarIcon />,
  people: <UsersIcon />,
  trend: <TrendIcon />,
};

/** The tint for a stat. Time stats are amber when the value is a problem, else blue. */
export function kpiTint(kind: KpiKind, problem: boolean): Tint {
  switch (kind) {
    case "time":
      return problem ? "amber" : "blue";
    case "stock-alert":
    case "returns":
      return "amber";
    case "tickets":
      return "green";
    case "ads":
    case "people":
    case "trend":
      return "blue";
    default:
      return "violet";
  }
}

// --- KPI card and KPI row (replace Stat and StatStrip) -----------------------------------------------------------------

/** A row of KPI cards: 4 per row ≥1100 px, 2 per row 700–1099 px, a sideways scroll-snap row under 700 px. */
export function StatStrip({ children, className = "", ariaLabel }: { children: ReactNode; className?: string; ariaLabel?: string }) {
  return (
    <dl className={`kpi-row m-0 ${className}`} aria-label={ariaLabel}>
      {children}
    </dl>
  );
}
export const KpiRow = StatStrip;

const CONTEXT_TONE: Partial<Record<Tone | "ink", string>> = { bad: "text-bad", warn: "text-warn" };

/**
 * A KPI card: a 46px icon badge; right of it the Label, the KPI number (counts up once when it is a plain number) and
 * one context line (--muted, or the tone colour when `tone` says it states a problem); a 72×28 sparkline at the far
 * right. `chart` (a share bar or gauge) sits under the context line. A link when `href`.
 */
export function Stat({
  label,
  value,
  sub,
  tone = "ink",
  href,
  chart,
  spark,
  kind,
  aside,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone | "ink";
  href?: string;
  chart?: ReactNode;
  /** Values for the sparkline, oldest first. */
  spark?: { values: number[]; label: string; tone?: SignalTone };
  /** What the stat is about; read from the label when left out. */
  kind?: KpiKind;
  /** Something beside the label (the late Chip). */
  aside?: ReactNode;
  size?: "md" | "lg";
}) {
  const k = kind ?? kpiKind(label);
  const problem = tone === "bad" || tone === "warn";
  const body = (
    <>
      <IconBadge icon={KPI_ICON[k]} tint={kpiTint(k, problem)} large />
      <div className="kpi-body">
        <dt className="t-label flex min-w-0 items-center gap-2">
          <span className="truncate">{label}</span>
          {aside}
        </dt>
        <dd className="t-stat m-0 mt-0.5 truncate text-ink">{typeof value === "number" ? <CountUp value={value} className="font-display" /> : value}</dd>
        {sub ? <dd className={`kpi-context m-0 ${CONTEXT_TONE[tone] ?? ""}`}>{sub}</dd> : null}
        {chart ? <dd className="m-0 mt-3">{chart}</dd> : null}
      </div>
      {spark && spark.values.length > 1 ? (
        <dd className="m-0 shrink-0">
          <Sparkline values={spark.values} tone={spark.tone} label={spark.label} className="kpi-spark" />
        </dd>
      ) : null}
    </>
  );
  if (href) {
    return (
      <div className="min-w-0">
        <Link prefetch={false} href={href} className="sp-card kpi-card focus-ring h-full transition-colors duration-160 hover:bg-panel2">
          {body}
        </Link>
      </div>
    );
  }
  return <div className="sp-card kpi-card">{body}</div>;
}
export const KpiCard = Stat;

// --- Item row ---------------------------------------------------------------------------------------------------------

/**
 * A row inside a queue, alert or list card: a 38px icon badge, the title (one line) over the detail (one line), and on
 * the right a status pill or a 40px secondary button. A link when `href`.
 */
export function ItemRow({
  icon,
  tint = "violet",
  title,
  detail,
  end,
  href,
}: {
  icon: ReactNode;
  tint?: Tint;
  title: ReactNode;
  detail?: ReactNode;
  end?: ReactNode;
  href?: string;
}) {
  const inner = (
    <>
      <IconBadge icon={icon} tint={tint} />
      <span className="min-w-0">
        <span className="item-row-title">{title}</span>
        {detail ? <span className="item-row-detail">{detail}</span> : null}
      </span>
      <span className="item-row-end">{end}</span>
    </>
  );
  if (href) {
    return (
      <Link prefetch={false} href={href} className="item-row focus-ring transition-colors duration-160 hover:bg-panel2">
        {inner}
      </Link>
    );
  }
  return <div className="item-row">{inner}</div>;
}

/** The tint an item row takes from a tone. */
export const TONE_TINT: Record<Tone, Tint> = { neutral: "violet", accent: "violet", info: "blue", ok: "green", warn: "amber", bad: "red" };

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

/** A route's loading screen: the page header, a KPI row, then two cards, in grey Skeleton blocks (graphite-spec 10.4). */
export function PageSkeleton({ kpis = 4 }: { kpis?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="vr-page">
      <div className="mb-4">
        <div className="skeleton h-8 w-56" />
        <div className="skeleton mt-2 h-4 w-80 max-w-full" />
      </div>
      <div className="kpi-row">
        {Array.from({ length: kpis }, (_, i) => (
          <div key={i} className="sp-card kpi-card">
            <div className="skeleton h-[46px] w-[46px] shrink-0 rounded-[13px]" />
            <div className="min-w-0 flex-1">
              <div className="skeleton h-3 w-24" />
              <div className="skeleton mt-2 h-6 w-16" />
              <div className="skeleton mt-2 h-3 w-28" />
            </div>
          </div>
        ))}
      </div>
      <div className="g-grid mt-[14px]">
        <div className="sp-card g-pad span-8">
          <div className="skeleton h-5 w-40" />
          <div className="skeleton mt-4 h-56 w-full" />
        </div>
        <div className="sp-card g-pad span-4">
          <div className="skeleton h-5 w-32" />
          <div className="skeleton mt-4 h-56 w-full" />
        </div>
      </div>
    </div>
  );
}
