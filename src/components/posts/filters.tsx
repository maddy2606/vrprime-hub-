"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Dropdown, SearchField, Segmented, Toolbar } from "@/components/flipkart/kit";
import { PRIORITY_LABEL, STATUS_LABEL, TYPE_LABEL } from "@/lib/labels";
import { NEW_LISTING_VIEWS, SORTS, type FilterValues } from "@/lib/post-options";
import { POST_STATUSES, POST_TYPES, PRIORITIES, type Person, type Warehouse } from "@/lib/types";

function toQuery(v: FilterValues): string {
  const params = new URLSearchParams();
  if (v.q.trim()) params.set("q", v.q.trim());
  if (v.type) params.set("type", v.type);
  if (v.status) params.set("status", v.status);
  if (v.warehouse) params.set("warehouse", v.warehouse);
  if (v.assignee) params.set("assignee", v.assignee);
  if (v.priority) params.set("priority", v.priority);
  if (v.overdue) params.set("overdue", "1");
  if (v.nl) params.set("nl", v.nl);
  if (v.sort && v.sort !== "updated") params.set("sort", v.sort);
  const s = params.toString();
  return s ? `/all?${s}` : "/all";
}

type Props = {
  values: FilterValues;
  /** The status actually applied when none is chosen ("active", or "any" while searching). */
  effectiveStatus: string;
  people: Person[];
  warehouses: Warehouse[];
  meId: string;
  /** Owner and admin only: how many requests are in each New listings view. Null hides the view. */
  newListingCounts?: { open: number; live: number; missing: number } | null;
};

export function Filters({ values, effectiveStatus, people, warehouses, meId, newListingCounts = null }: Props) {
  const router = useRouter();
  const [q, setQ] = useState(values.q);
  const [pending, startTransition] = useTransition();
  const latest = useRef(values);
  useEffect(() => {
    latest.current = values;
  }, [values]);

  const go = (next: FilterValues) => startTransition(() => router.replace(toQuery(next), { scroll: false }));

  // Search as you type, after a short pause.
  useEffect(() => {
    if (q.trim() === latest.current.q) return;
    const timer = window.setTimeout(() => go({ ...latest.current, q }), 250);
    return () => window.clearTimeout(timer);
    // `go` only wraps the router, which is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const set = (patch: Partial<FilterValues>) => go({ ...values, q, ...patch });
  const activeCount = [values.type, values.status, values.warehouse, values.assignee, values.priority].filter(Boolean)
    .length + (values.overdue ? 1 : 0);
  const nlOn = Boolean(values.nl);
  const opt = (rows: { value: string; label: string }[]) => rows;

  return (
    <div className="mb-4">
      <Toolbar>
        {newListingCounts ? (
          <Segmented<"posts" | "nl">
            label="Posts or new listings"
            value={nlOn ? "nl" : "posts"}
            onChange={(k) => set(k === "nl" ? { nl: "open", type: "", status: "", overdue: false } : { nl: "" })}
            options={[
              { key: "posts", label: "Posts" },
              { key: "nl", label: "New listings" },
            ]}
          />
        ) : null}
        {nlOn && newListingCounts ? (
          <Segmented<string>
            label="New listings view"
            value={values.nl}
            onChange={(nl) => set({ nl })}
            options={NEW_LISTING_VIEWS.map((view) => ({ key: view.value, label: view.label, count: newListingCounts[view.value] }))}
          />
        ) : null}
        {nlOn ? null : (
          <Dropdown
            label="Status"
            value={values.status || effectiveStatus}
            onChange={(status) => set({ status })}
            options={opt([{ value: "active", label: "Active" }, { value: "any", label: "Any status" }, ...POST_STATUSES.map((st) => ({ value: st, label: STATUS_LABEL[st] }))])}
          />
        )}
        {nlOn ? null : (
          <Dropdown
            label="Type"
            value={values.type}
            onChange={(type) => set({ type })}
            options={opt([{ value: "", label: "All" }, ...POST_TYPES.filter((t) => t !== "new_listing" || newListingCounts).map((t) => ({ value: t, label: TYPE_LABEL[t] }))])}
          />
        )}
        <Dropdown label="Warehouse" value={values.warehouse} onChange={(warehouse) => set({ warehouse })} options={opt([{ value: "", label: "All" }, ...warehouses.map((w) => ({ value: w.id, label: w.name }))])} />
        <Dropdown
          label="Assignee"
          value={values.assignee}
          onChange={(assignee) => set({ assignee })}
          options={opt([{ value: "", label: "Anyone" }, { value: meId, label: "Me" }, { value: "none", label: "Nobody" }, ...people.filter((p) => p.id !== meId).map((p) => ({ value: p.id, label: p.name }))])}
        />
        <Dropdown label="Priority" value={values.priority} onChange={(priority) => set({ priority })} options={opt([{ value: "", label: "Any" }, ...PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))])} />
        <Dropdown label="Sort" value={values.sort} onChange={(sort) => set({ sort })} options={SORTS.map((o) => ({ value: o.value, label: o.label }))} />
        <SearchField value={q} onChange={setQ} placeholder="Search number, title, SKU, ticket, person" label="Search posts" />
        <button
          type="button"
          aria-pressed={values.overdue}
          onClick={() => set({ overdue: !values.overdue })}
          className={`focus-ring min-h-11 rounded-xl border px-3 text-sm font-bold transition sm:min-h-9 ${
            values.overdue ? "border-bad bg-bad-soft text-bad" : "border-line bg-surface text-muted hover:text-ink"
          }`}
        >
          Overdue only
        </button>
      </Toolbar>
      {activeCount || values.q || pending ? (
        <div className="-mt-2 flex min-h-9 flex-wrap items-center gap-2">
          {activeCount || values.q ? (
            <button
              type="button"
              onClick={() => {
                setQ("");
                go({ q: "", type: "", status: "", warehouse: "", assignee: "", priority: "", overdue: false, nl: values.nl, sort: values.sort });
              }}
              className="focus-ring min-h-9 rounded-full px-3 text-sm font-bold text-accent-text"
            >
              Clear filters
            </button>
          ) : null}
          {pending ? <span className="text-sm text-muted">Updating…</span> : null}
        </div>
      ) : null}
    </div>
  );
}
