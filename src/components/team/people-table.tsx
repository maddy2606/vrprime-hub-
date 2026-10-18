"use client";

import { useTransition } from "react";
import { useToast } from "@/components/toast";
import { Chip } from "@/components/ui";
import { formatINR } from "@/lib/format";
import type { PersonView } from "@/server/team-data";
import { setStaffActive } from "@/server/actions/team";

type Warehouse = { id: string; name: string; color: string };

/** Everyone on the books with this month's attendance. Salary and the remove button are for the owner only. */
export function PeopleTable({ monthLabel, isOwner, warehouses, people }: { monthLabel: string; isOwner: boolean; warehouses: Warehouse[]; people: PersonView[] }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const by = new Map(warehouses.map((w) => [w.id, w]));
  const sorted = [...people].sort((a, b) => (by.get(a.warehouseId)?.name ?? "").localeCompare(by.get(b.warehouseId)?.name ?? "") || a.name.localeCompare(b.name));
  const salaryTotal = people.filter((p) => p.active).reduce((n, p) => n + (p.salary ?? 0), 0);
  if (people.length === 0) return null;
  return (
    <section className="sp-card p-4 sm:p-5" aria-labelledby="people-title">
      <header className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="people-title" className="font-display text-lg font-semibold">The team, {monthLabel}</h2>
          <p className="text-xs text-muted">Days in each state this month</p>
        </div>
        {isOwner && salaryTotal > 0 ? (
          <p className="text-right text-sm">
            <span className="text-xs text-muted">Monthly salaries </span>
            <span className="font-bold tabular-nums">{formatINR(salaryTotal)}</span>
          </p>
        ) : null}
      </header>
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] font-bold uppercase tracking-wider text-muted">
              <th scope="col" className="py-2 pr-3">Person</th>
              <th scope="col" className="px-2 text-right">Present</th>
              <th scope="col" className="px-2 text-right">Half</th>
              <th scope="col" className="px-2 text-right">Absent</th>
              <th scope="col" className="px-2 text-right">Leave</th>
              {isOwner ? <th scope="col" className="px-2 text-right">Salary</th> : null}
              {isOwner ? <th scope="col" className="pl-2"><span className="sr-only">Actions</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => {
              const w = by.get(p.warehouseId);
              return (
                <tr key={p.id} className={`border-b border-line-soft ${p.active ? "" : "opacity-60"}`}>
                  <th scope="row" className="py-2 pr-3 text-left font-bold">
                    <span className="flex items-center gap-2">
                      <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: w?.color }} />
                      <span>
                        {p.name}
                        <span className="block text-[11px] font-normal text-muted">{w?.name ?? "Unknown warehouse"}</span>
                      </span>
                      {!p.active ? <Chip tone="neutral">Removed</Chip> : null}
                    </span>
                  </th>
                  <td className="px-2 text-right font-mono tabular-nums text-ok">{p.month.present}</td>
                  <td className="px-2 text-right font-mono tabular-nums text-warn">{p.month.half}</td>
                  <td className="px-2 text-right font-mono tabular-nums text-bad">{p.month.absent}</td>
                  <td className="px-2 text-right font-mono tabular-nums text-info">{p.month.leave}</td>
                  {isOwner ? <td className="px-2 text-right font-mono tabular-nums">{p.salary === null ? "—" : formatINR(p.salary)}</td> : null}
                  {isOwner ? (
                    <td className="pl-2 text-right">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => startTransition(async () => void toast.result(await setStaffActive(p.id, !p.active)))}
                        className="focus-ring min-h-9 rounded-lg px-2 text-xs font-bold text-accent-text hover:bg-accent-soft disabled:opacity-50"
                      >
                        {p.active ? "Remove" : "Add back"}
                      </button>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
