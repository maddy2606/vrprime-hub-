"use client";

import { useState, useTransition } from "react";
import { useToast } from "@/components/toast";
import { buttonClass, Chip } from "@/components/ui";
import { formatINR } from "@/lib/format";
import type { PersonView } from "@/server/team-data";
import { setStaffActive } from "@/server/actions/team";
import { AdvanceDue, StaffMoneySheet } from "./staff-money";

type Warehouse = { id: string; name: string; color: string };

/**
 * Everyone on the books with this month's attendance. Salary, advances and expenses, and the remove button are for the
 * owner only.
 */
export function PeopleTable({ monthLabel, isOwner, warehouses, people, today }: { monthLabel: string; isOwner: boolean; warehouses: Warehouse[]; people: PersonView[]; today: string }) {
  const toast = useToast();
  const [open, setOpen] = useState<PersonView | null>(null);
  const month = today.slice(0, 7);
  const [pending, startTransition] = useTransition();
  const by = new Map(warehouses.map((w) => [w.id, w]));
  const place = (p: PersonView) => (p.warehouseId ? by.get(p.warehouseId) : undefined);
  const placeName = (p: PersonView) => place(p)?.name ?? (p.remote ? "Remote · attendance only" : "Unknown warehouse");
  // Warehouses A to Z, remote people last.
  const sorted = [...people].sort((a, b) => Number(a.remote) - Number(b.remote) || placeName(a).localeCompare(placeName(b)) || a.name.localeCompare(b.name));
  const salaryTotal = people.filter((p) => p.active).reduce((n, p) => n + (p.salary ?? 0), 0);
  if (people.length === 0) return null;
  const toggle = (p: PersonView) => startTransition(async () => void toast.result(await setStaffActive(p.id, !p.active)));
  return (
    <section className="sp-card min-w-0 overflow-hidden" aria-labelledby="people-title">
      <header className="g-pad flex flex-wrap items-end justify-between gap-2 pb-3">
        <div>
          <h2 id="people-title" className="t-card-title">The team, {monthLabel}</h2>
          <p className="t-caption mt-1">Days in each state this month</p>
        </div>
        {isOwner && salaryTotal > 0 ? (
          <p className="t-body text-right">
            <span className="t-caption">Monthly salaries </span>
            <span className="font-medium tabular-nums">{formatINR(salaryTotal)}</span>
          </p>
        ) : null}
      </header>
      <div className="overflow-x-auto border-t border-line-soft">
        <table className="ledger">
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col" className="num">Present</th>
              <th scope="col" className="num">Half</th>
              <th scope="col" className="num">Absent</th>
              <th scope="col" className="num">Leave</th>
              {isOwner ? <th scope="col" className="num">Salary</th> : null}
              {isOwner ? <th scope="col"><span className="sr-only">Actions</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => {
              const w = place(p);
              return (
                <tr key={p.id} className={p.active ? "" : "opacity-60"}>
                  <th scope="row" className="text-left font-semibold">
                    <span className="flex items-center gap-2">
                      <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: w?.color }} />
                      <span>
                        {p.name}
                        <span className="t-caption block">{placeName(p)}</span>
                        {isOwner && p.money ? <AdvanceDue entries={p.money} month={month} /> : null}
                      </span>
                      {!p.active ? <Chip tone="neutral">Removed</Chip> : null}
                    </span>
                  </th>
                  <td className="num text-ok">{p.month.present}</td>
                  <td className="num text-warn">{p.month.half}</td>
                  <td className="num text-bad">{p.month.absent}</td>
                  <td className="num text-info">{p.month.leave}</td>
                  {isOwner ? <td className="num">{p.salary === null ? "—" : formatINR(p.salary)}</td> : null}
                  {isOwner ? (
                    <td className="whitespace-nowrap text-right">
                      <button type="button" onClick={() => setOpen(p)} className={buttonClass("ghost")}>
                        Advance / expense
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => toggle(p)}
                        className={buttonClass("ghost")}
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
      {isOwner ? <StaffMoneySheet person={open} entries={open?.money ?? []} today={today} onClose={() => setOpen(null)} /> : null}
    </section>
  );
}
