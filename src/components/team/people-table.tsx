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
  const toggle = (p: PersonView) => startTransition(async () => void toast.result(await setStaffActive(p.id, !p.active)));
  return (
    <section className="sp-card min-w-0 p-4 sm:p-5" aria-labelledby="people-title">
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
      {/* Phone: one card per person, no sideways scrolling. */}
      <ul className="flex flex-col gap-2 sm:hidden">
        {sorted.map((p) => {
          const w = by.get(p.warehouseId);
          return (
            <li key={p.id} className={`rounded-xl border border-line-soft bg-surface/60 p-3 ${p.active ? "" : "opacity-60"}`}>
              <div className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: w?.color }} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{p.name}</p>
                  <p className="text-xs text-muted">
                    {w?.name ?? "Unknown warehouse"}
                    {isOwner && p.salary !== null ? <span className="font-mono tabular-nums"> · {formatINR(p.salary)}</span> : null}
                  </p>
                </div>
                {!p.active ? <Chip tone="neutral">Removed</Chip> : null}
                {isOwner ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => toggle(p)}
                    className="focus-ring -mr-1 -mt-1 min-h-11 shrink-0 rounded-lg px-2.5 text-xs font-bold text-accent-text hover:bg-accent-soft disabled:opacity-50"
                  >
                    {p.active ? "Remove" : "Add back"}
                  </button>
                ) : null}
              </div>
              <dl className="mt-2 grid grid-cols-4 gap-1.5 text-center">
                {(
                  [
                    ["Present", p.month.present, "text-ok"],
                    ["Half", p.month.half, "text-warn"],
                    ["Absent", p.month.absent, "text-bad"],
                    ["Leave", p.month.leave, "text-info"],
                  ] as const
                ).map(([label, n, tone]) => (
                  <div key={label} className="rounded-lg bg-surface2/70 px-1 py-1.5">
                    <dt className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</dt>
                    <dd className={`font-mono text-base font-bold tabular-nums ${tone}`}>{n}</dd>
                  </div>
                ))}
              </dl>
            </li>
          );
        })}
      </ul>

      {/* Wider screens: the table. */}
      <div className="hidden sm:block">
        <table className="w-full text-sm">
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
                        onClick={() => toggle(p)}
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
