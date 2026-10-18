"use client";

import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import { useToast } from "@/components/toast";
import { buttonClass, Chip } from "@/components/ui";
import type { AttendanceStatus } from "@/lib/capacity";
import { addDays, formatDate } from "@/lib/format";
import { markAttendance, markWarehousePresent } from "@/server/actions/team";

type Person = { id: string; name: string; warehouseId: string; status: AttendanceStatus | null };
type Warehouse = { id: string; name: string; color: string };

const OPTIONS: { status: AttendanceStatus; label: string; on: string }[] = [
  { status: "present", label: "Present", on: "bg-ok text-bad-ink" },
  { status: "half", label: "Half day", on: "bg-warn text-bad-ink" },
  { status: "absent", label: "Absent", on: "bg-bad text-bad-ink" },
  { status: "leave", label: "Leave", on: "bg-info text-bad-ink" },
];

/**
 * One tap per person. Each tap is saved straight away (the buttons answer at once and settle to what was saved); tapping
 * the chosen button again clears the mark. Owner and admin only: the page is not shown to anyone else.
 */
export function AttendancePanel({ day, today, warehouses, people }: { day: string; today: string; warehouses: Warehouse[]; people: Person[] }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [marks, setMark] = useOptimistic<Record<string, AttendanceStatus | null>, { id: string; status: AttendanceStatus | null }>(
    Object.fromEntries(people.map((p) => [p.id, p.status])),
    (cur, upd) => ({ ...cur, [upd.id]: upd.status }),
  );

  const choose = (id: string, status: AttendanceStatus | null) => {
    startTransition(async () => {
      setMark({ id, status });
      const result = await markAttendance(id, day, status);
      if (!result.ok) toast.show(result.message, "bad");
    });
  };
  const allPresent = (warehouseId: string) => {
    startTransition(async () => {
      for (const p of people) if (p.warehouseId === warehouseId && marks[p.id] == null) setMark({ id: p.id, status: "present" });
      toast.result(await markWarehousePresent(warehouseId, day));
    });
  };

  const prev = addDays(day, -1);
  const next = addDays(day, 1);
  return (
    <section className="sp-card p-4 sm:p-5" aria-labelledby="att-title" aria-busy={pending}>
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="att-title" className="font-display text-lg font-semibold">Attendance</h2>
          <p className="text-xs text-muted">{day === today ? "Today" : formatDate(day, today)} · mark who came in; planning uses this</p>
        </div>
        <nav aria-label="Choose a day" className="flex items-center gap-1.5">
          <Link prefetch={false} href={`/team?day=${prev}`} className={buttonClass("outline", "px-3")} aria-label="Previous day">
            ←
          </Link>
          <Link prefetch={false} href="/team" aria-current={day === today ? "date" : undefined} className={buttonClass(day === today ? "primary" : "outline", "px-4")}>
            Today
          </Link>
          {day < today ? (
            <Link prefetch={false} href={next >= today ? "/team" : `/team?day=${next}`} className={buttonClass("outline", "px-3")} aria-label="Next day">
              →
            </Link>
          ) : (
            <span className={buttonClass("outline", "px-3 opacity-40")} aria-hidden="true">
              →
            </span>
          )}
        </nav>
      </header>

      {warehouses.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">Add your team first.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {warehouses.map((w) => {
            const here = people.filter((p) => p.warehouseId === w.id);
            const marked = here.filter((p) => marks[p.id] != null).length;
            const inCount = here.filter((p) => marks[p.id] === "present" || marks[p.id] === "half").length;
            return (
              <div key={w.id} className="rounded-xl border border-line-soft p-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="flex items-center gap-2 text-sm font-bold">
                    <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: w.color }} />
                    {w.name}
                  </h3>
                  <span className="flex items-center gap-2">
                    <Chip tone={marked === here.length ? "ok" : "neutral"}>{marked === here.length ? `${inCount} of ${here.length} in` : `${marked} of ${here.length} marked`}</Chip>
                    {marked < here.length ? (
                      <button type="button" onClick={() => allPresent(w.id)} className="focus-ring min-h-9 rounded-lg px-2 text-xs font-bold text-accent-text hover:bg-accent-soft">
                        Mark the rest present
                      </button>
                    ) : null}
                  </span>
                </div>
                <ul className="flex flex-col gap-3">
                  {here.map((p) => (
                    <li key={p.id}>
                      <p className="mb-1 text-sm font-bold">{p.name}</p>
                      <div role="group" aria-label={`${p.name}, ${formatDate(day, today)}`} className="grid grid-cols-4 gap-1">
                        {OPTIONS.map((o) => {
                          const on = marks[p.id] === o.status;
                          return (
                            <button
                              key={o.status}
                              type="button"
                              aria-pressed={on}
                              onClick={() => choose(p.id, on ? null : o.status)}
                              className={`focus-ring min-h-11 rounded-lg border px-1 text-xs font-bold transition ${on ? `${o.on} border-transparent` : "border-line bg-surface text-muted hover:text-ink"}`}
                            >
                              {o.label}
                            </button>
                          );
                        })}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
