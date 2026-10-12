"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { SearchIcon } from "@/components/icons";
import { ISSUE_LABEL, PLATFORM_LABEL, TICKET_STATUS_LABEL } from "@/lib/labels";
import type { TicketFilterValues } from "@/lib/ticket-options";
import { ISSUE_TYPES, PLATFORMS, TICKET_STATUSES } from "@/lib/types";

function toQuery(v: TicketFilterValues): string {
  const params = new URLSearchParams();
  if (v.q.trim()) params.set("q", v.q.trim());
  if (v.platform) params.set("platform", v.platform);
  if (v.status) params.set("status", v.status);
  if (v.issue) params.set("issue", v.issue);
  if (v.due) params.set("due", "1");
  const s = params.toString();
  return s ? `/tickets?${s}` : "/tickets";
}

type Props = {
  values: TicketFilterValues;
  /** The status actually applied when none is chosen ("active", or "any" while searching). */
  effectiveStatus: string;
};

export function TicketFilters({ values, effectiveStatus }: Props) {
  const router = useRouter();
  const [q, setQ] = useState(values.q);
  const [pending, startTransition] = useTransition();
  const latest = useRef(values);
  useEffect(() => {
    latest.current = values;
  }, [values]);

  const go = (next: TicketFilterValues) => startTransition(() => router.replace(toQuery(next), { scroll: false }));

  // Search as you type, after a short pause.
  useEffect(() => {
    if (q.trim() === latest.current.q) return;
    const timer = window.setTimeout(() => go({ ...latest.current, q }), 250);
    return () => window.clearTimeout(timer);
    // `go` only wraps the router, which is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const set = (patch: Partial<TicketFilterValues>) => go({ ...values, q, ...patch });
  const filtered = Boolean(values.q || values.platform || values.status || values.issue || values.due);
  const select = "input min-h-10 py-1.5";

  return (
    <div className="mb-4 flex flex-col gap-2">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
        <label htmlFor="ticket-search" className="sr-only">
          Search tickets
        </label>
        <input
          id="ticket-search"
          type="search"
          className="input pl-10"
          placeholder="Search ticket ID or SKU"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          enterKeyHint="search"
        />
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <select aria-label="Status" className={select} value={values.status || effectiveStatus} onChange={(e) => set({ status: e.target.value })}>
          <option value="active">Active</option>
          <option value="any">Any status</option>
          {TICKET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {TICKET_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select aria-label="Platform" className={select} value={values.platform} onChange={(e) => set({ platform: e.target.value })}>
          <option value="">All platforms</option>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {PLATFORM_LABEL[p]}
            </option>
          ))}
        </select>
        <select aria-label="Issue type" className={`${select} col-span-2 md:col-span-1`} value={values.issue} onChange={(e) => set({ issue: e.target.value })}>
          <option value="">All issue types</option>
          {ISSUE_TYPES.map((t) => (
            <option key={t} value={t}>
              {ISSUE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex min-h-9 flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={values.due}
          onClick={() => set({ due: !values.due })}
          className={`focus-ring min-h-9 rounded-full border px-3 text-sm font-bold ${
            values.due ? "border-warn bg-warn-soft text-warn" : "border-line bg-surface text-muted"
          }`}
        >
          Follow-up due
        </button>
        {filtered ? (
          <button
            type="button"
            onClick={() => {
              setQ("");
              go({ q: "", platform: "", status: "", issue: "", due: false });
            }}
            className="focus-ring min-h-9 rounded-full px-3 text-sm font-bold text-accent-text"
          >
            Clear filters
          </button>
        ) : null}
        {pending ? <span className="text-sm text-muted">Updating…</span> : null}
      </div>
    </div>
  );
}
