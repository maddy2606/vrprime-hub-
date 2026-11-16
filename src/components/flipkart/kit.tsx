"use client";

// The small shared pieces of the Flipkart page, so every tab looks and behaves the same:
//   Toolbar    one row: segmented control for the sub-view, compact dropdown filters, search, CSV. Wraps on a phone.
//   Segmented  the sub-view switch. Violet marks the one that is on.
//   Dropdown   a labelled compact filter (the browser's own list).
//   Picker     the same, with the list drawn by the app: readable in the dark theme and above the table.
//   SearchField, CsvButton, InfoTip (the "i" that holds long explanations), Caption (one line of small text).
//   PageSection, StatTile, MiniStat for headings and numbers.
// Spacing is on an 8px scale: gap-2 (8), gap-4 (16), mb-4 (16), mb-6 (24).
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDownIcon, SearchIcon } from "@/components/icons";
import { formatNumber } from "@/lib/format";

/** Filters above a table: one Card, 12px padding, one wrapping row (phone: a 2-column grid). */
export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="sp-card toolbar mb-4">{children}</div>;
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
    <div role="group" aria-label={label} className="seg">
      {options.map((o) => {
        const on = value === o.key;
        return (
          <button key={o.key} type="button" aria-pressed={on} onClick={() => onChange(o.key)} className="seg-opt focus-ring">
            {o.label}
            {o.count !== undefined ? <span className="seg-count">{formatNumber(o.count)}</span> : null}
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
    <div className="toolbar-ctl">
      <label htmlFor={id} className="t-label shrink-0">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="focus-ring h-[38px] min-w-0 flex-1 truncate rounded-[var(--radius)] bg-transparent pl-1 pr-2 text-[13px] font-semibold sm:max-w-44"
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

/**
 * A labelled filter whose list the app draws itself (a listbox), so it is readable in the dark theme and opens above
 * the table instead of the browser's own popup. Keyboard: arrows, Home, End, Enter or Space to choose, Escape to
 * close. A tap or click outside closes it.
 */
export function Picker({
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
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    list.current?.focus();
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const show = () => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const choose = (i: number) => {
    const o = options[i];
    if (o) onChange(o.value);
    setOpen(false);
    button.current?.focus();
  };
  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const last = options.length - 1;
    const moves: Record<string, () => void> = {
      ArrowDown: () => setActive((i) => Math.min(last, i + 1)),
      ArrowUp: () => setActive((i) => Math.max(0, i - 1)),
      Home: () => setActive(0),
      End: () => setActive(last),
      Enter: () => choose(active),
      " ": () => choose(active),
      Escape: () => {
        setOpen(false);
        button.current?.focus();
      },
      Tab: () => setOpen(false),
    };
    const move = moves[e.key];
    if (!move) return;
    if (e.key !== "Tab") e.preventDefault();
    move();
  };

  return (
    <div ref={box} className="toolbar-ctl relative !p-0">
      <button
        ref={button}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            show();
          }
        }}
        className="focus-ring flex h-[38px] w-full items-center gap-1.5 rounded-[var(--radius)] pl-3 pr-2 text-left"
      >
        <span className="t-label shrink-0">{label}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink sm:max-w-44">{current?.label}</span>
        <ChevronDownIcon className={`h-4 w-4 shrink-0 text-muted transition-transform duration-160 ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <ul
          ref={list}
          id={`${id}-list`}
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          aria-activedescendant={`${id}-opt-${active}`}
          onKeyDown={onListKey}
          className="sp-pop vr-sheet vr-pop absolute left-0 top-full z-50 mt-1 max-h-72 min-w-full overflow-auto p-1 focus:outline-none"
        >
          {options.map((o, i) => {
            const selected = o.value === value;
            return (
              <li
                key={o.value}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={selected}
                onPointerEnter={() => setActive(i)}
                onClick={() => choose(i)}
                className={`flex min-h-10 cursor-pointer items-center whitespace-nowrap rounded-[var(--radius)] px-3 text-[13px] font-semibold ${
                  i === active ? "bg-accent-soft text-ink" : "text-ink"
                } ${selected ? "text-accent-text" : ""}`}
              >
                {o.label}
                {selected ? <span aria-hidden="true" className="ml-auto pl-3 text-accent-text">✓</span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

export function SearchField({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label?: string }) {
  const id = useId();
  return (
    <div className="toolbar-search relative">
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-faint" />
      <label htmlFor={id} className="sr-only">
        {label ?? placeholder}
      </label>
      <input
        id={id}
        type="search"
        className="input h-10 pl-10"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
      />
    </div>
  );
}

const OUTLINE_BUTTON = "g-btn g-btn-secondary focus-ring shrink-0";

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
        className="focus-ring flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-full text-muted transition-colors duration-160 hover:text-ink [&::-webkit-details-marker]:hidden"
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full border border-current text-xs font-bold leading-none">i</span>
      </summary>
      <div className="sp-pop sp-tip vr-sheet vr-pop absolute right-0 z-30 mt-1 w-72 max-w-[85vw] p-3 text-xs leading-relaxed sm:left-0 sm:right-auto">{children}</div>
    </details>
  );
}

/** One line of small text under the toolbar: counts and scope. */
export function Caption({ children }: { children: ReactNode }) {
  return <p className="t-caption mb-2">{children}</p>;
}

export function PageSection({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="t-card-title g-head flex items-center gap-2">
        {title}
        {count !== undefined ? <span className="tabular-nums g-chip">{formatNumber(count)}</span> : null}
      </h2>
      {children}
    </section>
  );
}

/** A number with a label above it. */
export function StatTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "bad" | "warn" | "ok" }) {
  const color = tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "";
  return (
    <div className="min-w-0">
      <span className="t-label block">{label}</span>
      <span className={`t-stat mt-2 block ${color}`}>{value}</span>
      {sub ? <span className="t-caption mt-1.5 block">{sub}</span> : null}
    </div>
  );
}

/** Mono, tabular figures, Indian grouping: the look of every number and ID. */
export function Num({ value, className = "" }: { value: number; className?: string }) {
  return <span className={`tabular-nums ${className}`}>{formatNumber(value)}</span>;
}
