"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { SearchIcon } from "@/components/icons";
import { ISSUE_LABEL, PLATFORM_LABEL } from "@/lib/labels";
import { ticketsUrl, type TicketFilterValues } from "@/lib/ticket-options";
import { ISSUE_TYPES, PLATFORMS } from "@/lib/types";

/** Search, platform and issue type. The tab (open, waiting, ...) is kept while these change. */
export function TicketFilters({ values }: { values: TicketFilterValues }) {
  const router = useRouter();
  const [q, setQ] = useState(values.q);
  const [pending, startTransition] = useTransition();
  const latest = useRef(values);
  useEffect(() => {
    latest.current = values;
  }, [values]);

  const go = (next: TicketFilterValues) => startTransition(() => router.replace(ticketsUrl(next), { scroll: false }));

  // Search as you type, after a short pause.
  useEffect(() => {
    if (q.trim() === latest.current.q) return;
    const timer = window.setTimeout(() => go({ ...latest.current, q }), 250);
    return () => window.clearTimeout(timer);
    // `go` only wraps the router, which is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const set = (patch: Partial<TicketFilterValues>) => go({ ...values, q, ...patch });
  const filtered = Boolean(values.q || values.platform || values.issue);
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
          placeholder="Search ticket ID, SKU or problem"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
          enterKeyHint="search"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <select aria-label="Platform" className={select} value={values.platform} onChange={(e) => set({ platform: e.target.value })}>
          <option value="">All platforms</option>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {PLATFORM_LABEL[p]}
            </option>
          ))}
        </select>
        <select aria-label="Issue type" className={select} value={values.issue} onChange={(e) => set({ issue: e.target.value })}>
          <option value="">All issue types</option>
          {ISSUE_TYPES.map((t) => (
            <option key={t} value={t}>
              {ISSUE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>

      {filtered || pending ? (
        <div className="flex min-h-9 items-center gap-2">
          {filtered ? (
            <button
              type="button"
              onClick={() => {
                setQ("");
                go({ q: "", platform: "", issue: "", tab: values.tab });
              }}
              className="focus-ring min-h-9 rounded-full px-3 text-sm font-bold text-accent-text"
            >
              Clear search and filters
            </button>
          ) : null}
          {pending ? <span className="text-sm text-muted">Updating…</span> : null}
        </div>
      ) : null}
    </div>
  );
}
