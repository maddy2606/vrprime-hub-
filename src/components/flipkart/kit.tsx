"use client";

// The small shared pieces of the Flipkart page, so every tab looks and behaves the same:
//   Toolbar    one row: segmented control for the sub-view, compact dropdown filters, search, CSV. Wraps on a phone.
//   Segmented  the sub-view switch. Teal marks the one that is on.
//   Dropdown   a labelled compact filter.
//   SearchField, CsvButton, InfoTip (the "i" that holds long explanations), Caption (one line of small text).
//   PageSection, StatTile, MiniStat for headings and numbers.
// Spacing is on an 8px scale: gap-2 (8), gap-4 (16), mb-4 (16), mb-6 (24).
import { useId, type ReactNode } from "react";
import { SearchIcon } from "@/components/icons";
import { formatNumber } from "@/lib/format";

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-center gap-2">{children}</div>;
}

export type SegmentOption<K extends string> = { key: K; label: string; count?: number };

export function Segmented<K extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: SegmentOption<K>[];
  value: K;
  onChange: (key: K) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-lg border border-line bg-surface2 p-0.5">
      {options.map((o) => {
        const on = value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.key)}
            className={`focus-ring flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-semibold transition sm:min-h-9 ${
              on ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"
            }`}
          >
            {o.label}
            {o.count !== undefined ? <span className={`text-xs font-medium tabular-nums ${on ? "text-accent-ink/80" : "text-muted"}`}>{formatNumber(o.count)}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function Dropdown({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex min-h-11 min-w-[9.5rem] flex-1 items-center gap-1.5 rounded-lg border border-line bg-surface pl-2.5 sm:min-h-9 sm:flex-none">
      <label htmlFor={id} className="shrink-0 text-xs font-semibold text-muted">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="focus-ring min-h-10 min-w-0 flex-1 truncate bg-transparent py-1 pl-1 pr-2 text-sm font-semibold sm:min-h-8 sm:max-w-44"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function SearchField({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label?: string }) {
  const id = useId();
  return (
    <div className="relative min-w-40 flex-1">
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
      <label htmlFor={id} className="sr-only">
        {label ?? placeholder}
      </label>
      <input
        id={id}
        type="search"
        className="input min-h-11 pl-10 text-sm sm:min-h-9 sm:py-1"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
      />
    </div>
  );
}

const OUTLINE_BUTTON =
  "focus-ring inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-sm font-semibold hover:bg-surface2 disabled:opacity-50 sm:min-h-9";

export function CsvButton({ href, onClick, disabled }: { href?: string; onClick?: () => void; disabled?: boolean }) {
  if (href) {
    return (
      <a href={href} download className={OUTLINE_BUTTON}>
        CSV
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={OUTLINE_BUTTON}>
      CSV
    </button>
  );
}

/** A small "i" that opens a longer explanation, so the page itself stays short. */
export function InfoTip({ children, label = "More about this" }: { children: ReactNode; label?: string }) {
  return (
    <details className="group relative inline-block">
      <summary
        aria-label={label}
        className="focus-ring flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-full text-muted hover:text-ink sm:h-9 sm:w-9 [&::-webkit-details-marker]:hidden"
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full border border-current text-xs font-bold leading-none">i</span>
      </summary>
      <div className="absolute right-0 z-30 mt-1 w-72 max-w-[85vw] rounded-lg border border-line bg-surface p-3 text-xs leading-relaxed shadow-xl sm:left-0 sm:right-auto">{children}</div>
    </details>
  );
}

/** One line of small text under the toolbar: counts and scope. */
export function Caption({ children }: { children: ReactNode }) {
  return <p className="mb-2 text-xs text-muted">{children}</p>;
}

export function PageSection({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 flex items-baseline gap-2 text-base font-extrabold">
        {title}
        {count !== undefined ? <span className="text-sm font-semibold text-muted">{formatNumber(count)}</span> : null}
      </h2>
      {children}
    </section>
  );
}

/** A number with a label above it. */
export function StatTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "bad" | "warn" | "ok" }) {
  const color = tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "";
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface p-3">
      <span className="block text-xs font-semibold leading-tight text-muted">{label}</span>
      <span className={`mt-1 block font-mono text-xl font-bold leading-none tabular-nums ${color}`}>{value}</span>
      {sub ? <span className="mt-1 block text-xs text-muted">{sub}</span> : null}
    </div>
  );
}

/** Mono, tabular figures, Indian grouping: the look of every number and ID. */
export function Num({ value, className = "" }: { value: number; className?: string }) {
  return <span className={`font-mono tabular-nums ${className}`}>{formatNumber(value)}</span>;
}
