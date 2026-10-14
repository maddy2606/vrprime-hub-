"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Dropdown, SearchField, Segmented, Toolbar } from "@/components/flipkart/kit";
import { ISSUE_LABEL, PLATFORM_LABEL } from "@/lib/labels";
import { ticketsUrl, type TicketFilterValues, type TicketTab } from "@/lib/ticket-options";
import type { TicketCounts } from "@/components/tickets/ticket-tabs";

const TABS: { key: TicketTab; label: string; count: (c: TicketCounts) => number }[] = [
  { key: "open", label: "Open", count: (c) => c.open_count },
  { key: "waiting", label: "Waiting", count: (c) => c.waiting_count },
  { key: "due", label: "Follow-up due", count: (c) => c.follow_up_due },
  { key: "closed", label: "Closed", count: (c) => c.closed_count },
];
import { ISSUE_TYPES, PLATFORMS } from "@/lib/types";

/** One toolbar: the ticket groups with their counts, platform, issue type and search. Changing any keeps the others. */
export function TicketFilters({ values, counts }: { values: TicketFilterValues; counts: TicketCounts }) {
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

  return (
    <div className="mb-4">
      <Toolbar>
        <Segmented<TicketTab>
          label="Ticket groups"
          value={values.tab}
          onChange={(tab) => set({ tab })}
          options={TABS.map((t) => ({ key: t.key, label: t.label, count: t.count(counts) }))}
        />
        <Dropdown
          label="Platform"
          value={values.platform}
          onChange={(platform) => set({ platform })}
          options={[{ value: "", label: "All" }, ...PLATFORMS.map((p) => ({ value: p, label: PLATFORM_LABEL[p] }))]}
        />
        <Dropdown
          label="Issue"
          value={values.issue}
          onChange={(issue) => set({ issue })}
          options={[{ value: "", label: "All" }, ...ISSUE_TYPES.map((t) => ({ value: t, label: ISSUE_LABEL[t] }))]}
        />
        <SearchField value={q} onChange={setQ} placeholder="Search ticket ID, SKU or problem" label="Search tickets" />
      </Toolbar>
      {filtered || pending ? (
        <div className="-mt-2 flex min-h-9 items-center gap-2">
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
