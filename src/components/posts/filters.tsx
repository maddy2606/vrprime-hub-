"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { SearchIcon } from "@/components/icons";
import { PRIORITY_LABEL, STATUS_LABEL, TYPE_LABEL } from "@/lib/labels";
import { SORTS, type FilterValues } from "@/lib/post-options";
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
};

export function Filters({ values, effectiveStatus, people, warehouses, meId }: Props) {
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
  const select = "input min-h-10 py-1.5";

  return (
    <div className="mb-4 flex flex-col gap-2">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
        <label htmlFor="search" className="sr-only">
          Search posts
        </label>
        <input
          id="search"
          type="search"
          className="input pl-10"
          placeholder="Search number, title, SKU, ticket, invoice, person"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
          enterKeyHint="search"
        />
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 2xl:grid-cols-6">
        <select aria-label="Status" className={select} value={values.status || effectiveStatus} onChange={(e) => set({ status: e.target.value })}>
          <option value="active">Active</option>
          <option value="any">Any status</option>
          {POST_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select aria-label="Type" className={select} value={values.type} onChange={(e) => set({ type: e.target.value })}>
          <option value="">All types</option>
          {POST_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <select aria-label="Warehouse" className={select} value={values.warehouse} onChange={(e) => set({ warehouse: e.target.value })}>
          <option value="">All warehouses</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <select aria-label="Assignee" className={select} value={values.assignee} onChange={(e) => set({ assignee: e.target.value })}>
          <option value="">Anyone</option>
          <option value={meId}>Me</option>
          <option value="none">Nobody</option>
          {people
            .filter((p) => p.id !== meId)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
        <select aria-label="Priority" className={select} value={values.priority} onChange={(e) => set({ priority: e.target.value })}>
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABEL[p]}
            </option>
          ))}
        </select>
        <select aria-label="Sort by" className={select} value={values.sort} onChange={(e) => set({ sort: e.target.value })}>
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              Sort: {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex min-h-9 flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={values.overdue}
          onClick={() => set({ overdue: !values.overdue })}
          className={`focus-ring min-h-9 rounded-full border px-3 text-sm font-bold ${
            values.overdue ? "border-bad bg-bad-soft text-bad" : "border-line bg-surface text-muted"
          }`}
        >
          Overdue only
        </button>
        {activeCount || values.q ? (
          <button
            type="button"
            onClick={() => {
              setQ("");
              go({ q: "", type: "", status: "", warehouse: "", assignee: "", priority: "", overdue: false, sort: values.sort });
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
