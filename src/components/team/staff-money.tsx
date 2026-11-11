"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Sheet } from "@/components/shell/sheet";
import { useToast } from "@/components/toast";
import { buttonClass } from "@/components/ui";
import { formatINR } from "@/lib/format";
import { STAFF_MONEY_KINDS, staffMoneyByMonth, staffMoneySummary, type StaffMoneyEntry, type StaffMoneyKind } from "@/lib/staff-money";
import { addStaffMoney, deleteStaffMoney } from "@/server/actions/team";

const TONE: Record<StaffMoneyKind, string> = { advance: "text-warn", expense: "text-info", recovered: "text-ok" };
const SIGN: Record<StaffMoneyKind, string> = { advance: "+", expense: "", recovered: "−" };
const dayLabel = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

/** The small line under a person's name: advance still due, for the owner. */
export function AdvanceDue({ entries, month }: { entries: StaffMoneyEntry[]; month: string }) {
  const s = staffMoneySummary(entries, month);
  if (s.due === 0 && s.thisMonth.expense === 0) return null;
  return (
    <span className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] font-bold">
      {s.due !== 0 ? <span className={s.due > 0 ? "text-warn" : "text-ok"}>{s.due > 0 ? `Advance due ${formatINR(s.due)}` : `Recovered ${formatINR(-s.due)} extra`}</span> : null}
      {s.thisMonth.expense > 0 ? <span className="text-info">Expenses {formatINR(s.thisMonth.expense)} this month</span> : null}
    </span>
  );
}

/** One person's advances and expenses: add one in a few taps, see everything date by date. */
export function StaffMoneySheet({ person, entries, today, onClose }: { person: { id: string; name: string } | null; entries: StaffMoneyEntry[]; today: string; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<StaffMoneyKind>("advance");
  const [day, setDay] = useState(today);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [forId, setForId] = useState<string | null>(null);
  if (person && person.id !== forId) {
    setForId(person.id);
    setKind("advance");
    setDay(today);
    setAmount("");
    setNote("");
  }
  if (!person) return null;

  const month = today.slice(0, 7);
  const s = staffMoneySummary(entries, month);
  const groups = staffMoneyByMonth(entries);
  const save = () =>
    startTransition(async () => {
      if (toast.result(await addStaffMoney(person.id, kind, day, amount, note))) {
        setAmount("");
        setNote("");
        router.refresh();
      }
    });
  const remove = (e: StaffMoneyEntry) =>
    startTransition(async () => {
      if (window.confirm(`Delete this ${e.kind} of ${formatINR(e.amount)} on ${dayLabel.format(new Date(`${e.day}T00:00:00Z`))}?`) && toast.result(await deleteStaffMoney(e.id))) router.refresh();
    });

  return (
    <Sheet open onClose={onClose} title={person.name} subtitle="Advances and expenses, date by date">
      <dl className="grid grid-cols-3 gap-2 rounded-2xl bg-surface2/60 p-3">
        <div className="min-w-0">
          <dt className="text-[11px] font-bold uppercase tracking-wider text-muted">Advance due</dt>
          <dd className={`mt-1 font-mono text-lg font-bold tabular-nums ${s.due > 0 ? "text-warn" : ""}`}>{formatINR(s.due)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] font-bold uppercase tracking-wider text-muted">Advance this month</dt>
          <dd className="mt-1 font-mono text-lg font-bold tabular-nums">{formatINR(s.thisMonth.advance)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] font-bold uppercase tracking-wider text-muted">Expenses this month</dt>
          <dd className="mt-1 font-mono text-lg font-bold tabular-nums">{formatINR(s.thisMonth.expense)}</dd>
        </div>
      </dl>

      <div className="mt-4 rounded-2xl border border-line bg-surface p-3">
        <div role="radiogroup" aria-label="Type" className="grid grid-cols-3 gap-1 rounded-xl border border-line bg-panel2 p-0.5">
          {STAFF_MONEY_KINDS.map((k) => (
            <button
              key={k.kind}
              type="button"
              role="radio"
              aria-checked={kind === k.kind}
              onClick={() => setKind(k.kind)}
              className={`focus-ring min-h-10 rounded-[10px] text-sm font-bold transition ${kind === k.kind ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"}`}
            >
              {k.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted">{STAFF_MONEY_KINDS.find((k) => k.kind === kind)?.hint}</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            Amount (₹)
            <input className="input font-mono" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="2000" autoFocus />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            Date
            <input className="input" type="date" max={today} value={day} onChange={(e) => setDay(e.target.value)} />
          </label>
        </div>
        <label className="mt-2 flex flex-col gap-1 text-xs font-semibold text-muted">
          Note (optional)
          <input className="input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder={kind === "expense" ? "Petrol for delivery" : kind === "recovered" ? "Cut from October salary" : "For family function"} />
        </label>
        <button type="button" disabled={pending || !amount.trim()} onClick={save} className={buttonClass("primary", "mt-3 w-full")}>
          {pending ? "Saving…" : `Save ${STAFF_MONEY_KINDS.find((k) => k.kind === kind)?.label.toLowerCase()}`}
        </button>
      </div>

      <h3 className="mb-2 mt-5 text-sm font-bold">History</h3>
      {groups.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-sm text-muted">Nothing yet. Advances and expenses you save show here, by date.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <section key={g.month} aria-label={monthLabel(g.month)}>
              <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 px-1">
                <span className="text-sm font-bold">{monthLabel(g.month)}</span>
                <span className="text-[11px] text-muted">
                  {(["advance", "expense", "recovered"] as const)
                    .filter((k) => g.totals[k] > 0)
                    .map((k) => `${STAFF_MONEY_KINDS.find((x) => x.kind === k)?.label} ${formatINR(g.totals[k])}`)
                    .join(" · ")}
                </span>
              </div>
              <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line-soft">
                {g.entries.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-3 py-2.5">
                    <span className="w-20 shrink-0 text-xs text-muted">{dayLabel.format(new Date(`${e.day}T00:00:00Z`))}</span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-xs font-bold ${TONE[e.kind]}`}>{STAFF_MONEY_KINDS.find((k) => k.kind === e.kind)?.label}</span>
                      {e.note ? <span className="block truncate text-xs text-muted">{e.note}</span> : null}
                    </span>
                    <span className={`shrink-0 font-mono text-sm font-bold tabular-nums ${TONE[e.kind]}`}>
                      {SIGN[e.kind]}
                      {formatINR(e.amount)}
                    </span>
                    <button type="button" disabled={pending} onClick={() => remove(e)} aria-label={`Delete ${e.kind} of ${formatINR(e.amount)}`} className="focus-ring -mr-1 min-h-9 shrink-0 rounded-lg px-2 text-xs font-bold text-muted hover:text-bad disabled:opacity-50">
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Sheet>
  );
}
