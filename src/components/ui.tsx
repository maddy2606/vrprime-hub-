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
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${TONE_CLASS[tone]}`}
    >
      {children}
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

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink hover:opacity-90",
  secondary: "border border-line bg-surface text-ink hover:bg-surface2",
  ghost: "text-accent-text hover:bg-accent-soft",
  danger: "border border-line bg-surface text-bad hover:bg-bad-soft",
};

/** Class names for buttons and button-like links. Tap targets are at least 44px tall. */
export function buttonClass(variant: ButtonVariant = "secondary", extra = ""): string {
  return `focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_VARIANT[variant]} ${extra}`;
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
      {error ? (
        <p className="text-sm font-medium text-bad">{error}</p>
      ) : hint ? (
        <p className="text-sm text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-line bg-surface ${className}`}>{children}</section>;
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-5 py-10 text-center">
      <p className="text-base font-bold">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{body}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function PageTitle({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-extrabold tracking-tight">{title}</h1>
        {sub ? <p className="mt-0.5 text-sm text-muted">{sub}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function PostListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="grid grid-cols-1 gap-2 lg:grid-cols-2 2xl:grid-cols-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="rounded-xl border border-line bg-surface p-3">
          <div className="skeleton h-4 w-32" />
          <div className="skeleton mt-3 h-5 w-4/5" />
          <div className="skeleton mt-3 h-4 w-1/2" />
        </div>
      ))}
    </div>
  );
}
