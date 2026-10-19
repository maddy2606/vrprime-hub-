"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Sheet } from "@/components/shell/sheet";
import { useToast } from "@/components/toast";
import { buttonClass } from "@/components/ui";
import { budgetStatus, isLabour, splitByShare, type BudgetTone } from "@/lib/budget";
import { formatINR, formatNumber } from "@/lib/format";
import { saveBudget } from "@/server/actions/expenses";

export type BudgetLine = { warehouseId: string | null; labour: number; running: number };
export type BudgetWarehouse = { id: string; name: string; color: string };
export type BudgetPlan = {
  month: string;
  label: string;
  /** The month's saved budget; warehouseId null is general (not tied to one warehouse). */
  lines: BudgetLine[];
  /** The month before's budget: the starting point when this month has none yet. */
  lastLines: BudgetLine[];
  warehouses: BudgetWarehouse[];
  /** Monthly salaries per warehouse (Team page), people on the books, and orders over the last 30 days. */
  salaries: Record<string, number>;
  people: Record<string, number>;
  orders: Record<string, number>;
  /** Running costs per warehouse the month before ("general" for spending with no warehouse). */
  lastRunning: Record<string, number>;
  lastLabel: string;
};
export type BudgetExpense = { amount: number | null; category: string; warehouseId: string | null };

/** The key for spending not tied to one warehouse. */
export const GENERAL = "general";

const BAR: Record<BudgetTone, string> = { ok: "linear-gradient(90deg, var(--accent), var(--madder))", warn: "var(--warn-mark)", bad: "var(--bad)", neutral: "var(--line)" };
const TEXT: Record<BudgetTone, string> = { ok: "text-ok", warn: "text-warn", bad: "text-bad", neutral: "text-muted" };
const RANK: Record<BudgetTone, number> = { neutral: 0, ok: 1, warn: 2, bad: 3 };
const worst = (a: BudgetTone, b: BudgetTone) => (RANK[a] >= RANK[b] ? a : b);
const roundUp = (n: number, step: number) => (n > 0 ? Math.ceil(n / step) * step : 0);
const num = (s: string) => {
  const n = Number(s.replace(/[,₹\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};
const EMPTY = { labour: 0, running: 0, salaries: 0 };

/**
 * What each warehouse has spent in the month: running costs, and labour (its monthly salaries from the Team page, once
 * the month has begun, plus labour paid from the group).
 */
function spentBy(plan: BudgetPlan, expenses: BudgetExpense[], withSalaries: boolean) {
  const out: Record<string, { labour: number; running: number; salaries: number }> = {};
  const at = (k: string) => (out[k] ??= { labour: 0, running: 0, salaries: 0 });
  if (withSalaries) {
    for (const w of plan.warehouses) {
      const pay = plan.salaries[w.id] ?? 0;
      at(w.id).labour += pay;
      at(w.id).salaries = pay;
    }
  }
  for (const e of expenses) {
    const line = at(e.warehouseId ?? GENERAL);
    if (isLabour(e.category)) line.labour += e.amount ?? 0;
    else line.running += e.amount ?? 0;
  }
  return out;
}

/** Labour at its budget is expected (salaries are fixed), so it only turns red when over. */
const labourTone = (budget: number, spent: number): BudgetTone => (budget > 0 ? (spent > budget ? "bad" : "ok") : spent > 0 ? "bad" : "neutral");

function Meter({ label, spent, budget, tone, pace }: { label: string; spent: number; budget: number; tone: BudgetTone; pace?: number | null }) {
  const width = budget > 0 ? Math.min(100, (spent / budget) * 100) : spent > 0 ? 100 : 0;
  return (
    <span className="mt-3 block">
      <span className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-semibold text-muted">{label}</span>
        <span className="font-mono tabular-nums">
          <b className="text-ink">{formatINR(spent)}</b> <span className="text-muted">of {budget > 0 ? formatINR(budget) : "no budget"}</span>
        </span>
      </span>
      <span className="relative mt-1.5 block h-2 overflow-hidden rounded-full bg-surface2">
        <span className="sp-bar block h-full rounded-full" style={{ width: `${width}%`, background: BAR[tone] }} />
        {pace ? <span aria-hidden="true" className="absolute inset-y-0 w-0.5 bg-ink/70" style={{ left: `${pace}%` }} /> : null}
      </span>
    </span>
  );
}

/**
 * The month's budget per warehouse against what it has spent. Tapping a warehouse shows only its expenses below. With no
 * budget yet, it shows where the running costs went and offers to plan the month.
 */
export function BudgetSection({ plan, expenses, today, picked, onPick }: { plan: BudgetPlan; expenses: BudgetExpense[]; today: string; picked: string | null; onPick: (key: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const thisMonth = today.slice(0, 7);
  const started = plan.month <= thisMonth;
  const [y, m] = plan.month.split("-").map(Number);
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const day = Number(today.slice(8, 10));
  // How far through the month we are: a tick on each running-costs bar, so spending ahead of the month shows.
  const pace = plan.month === thisMonth ? Math.round((day / daysIn) * 100) : null;

  const budget = new Map(plan.lines.map((l) => [l.warehouseId ?? GENERAL, l]));
  const spent = spentBy(plan, expenses, started);
  const hasPlan = plan.lines.length > 0;
  const generalUsed = budget.has(GENERAL) || (spent[GENERAL]?.running ?? 0) + (spent[GENERAL]?.labour ?? 0) > 0;
  const rows = [...plan.warehouses.map((w) => ({ key: w.id, name: w.name, color: w.color })), ...(generalUsed ? [{ key: GENERAL, name: "General", color: "var(--muted)" }] : [])];
  const orderTotal = plan.warehouses.reduce((n, w) => n + (plan.orders[w.id] ?? 0), 0);
  const total = (of: (key: string) => { labour: number; running: number }, part: "labour" | "running" | "both") =>
    rows.reduce((n, r) => {
      const l = of(r.key);
      return n + (part === "both" ? l.labour + l.running : l[part]);
    }, 0);
  const budgetOf = (k: string) => budget.get(k) ?? EMPTY;
  const spentOf = (k: string) => spent[k] ?? EMPTY;
  const totalBudget = total(budgetOf, "both");
  const totalSpent = total(spentOf, "both");
  const run = budgetStatus(total(budgetOf, "running"), total(spentOf, "running"));
  const maxRunning = Math.max(1, ...rows.map((r) => spentOf(r.key).running));
  const pick = (key: string) => {
    onPick(picked === key ? null : key);
    if (picked !== key) document.getElementById("exp-list")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <section className="sp-card sp-card-lg mt-5 p-5 sm:p-6" aria-labelledby="budget-title">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="budget-title" className="font-display text-lg font-semibold">
            Budget by warehouse
          </h2>
          <p className="text-xs text-muted">
            {hasPlan ? `${plan.label}. Labour counts each warehouse's salaries plus labour paid in the group.` : `No budget for ${plan.label} yet. Running costs so far, by warehouse:`}
          </p>
        </div>
        <button type="button" onClick={() => setOpen(true)} className={buttonClass(hasPlan ? "secondary" : "primary")}>
          {hasPlan ? "Edit budget" : `Plan ${plan.label} budget`}
        </button>
      </header>

      {hasPlan ? (
        <>
          <dl className="grid grid-cols-2 gap-3 rounded-2xl bg-surface2/60 p-3 sm:grid-cols-3 sm:p-4">
            <div className="min-w-0">
              <dt className="text-[11px] font-bold uppercase tracking-wider text-muted">Budget</dt>
              <dd className="mt-1 font-mono text-lg font-bold tabular-nums sm:text-2xl">{formatINR(totalBudget)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[11px] font-bold uppercase tracking-wider text-muted">Spent</dt>
              <dd className="mt-1 font-mono text-lg font-bold tabular-nums sm:text-2xl">{formatINR(totalSpent)}</dd>
            </div>
            <div className="col-span-2 flex min-w-0 items-baseline justify-between gap-2 border-t border-line-soft pt-2 sm:col-span-1 sm:block sm:border-0 sm:pt-0">
              <dt className="text-[11px] font-bold uppercase tracking-wider text-muted">{totalBudget - totalSpent >= 0 ? "Left" : "Over"}</dt>
              <dd className={`mt-1 font-mono text-lg font-bold tabular-nums sm:text-2xl ${totalBudget - totalSpent < 0 ? "text-bad" : "text-ok"}`}>{formatINR(Math.abs(totalBudget - totalSpent))}</dd>
            </div>
          </dl>
          <p className="mb-4 mt-2 px-1 text-xs text-muted">
            Running costs: <b className={TEXT[run.tone]}>{run.pct === null ? "no budget" : `${run.pct}% used`}</b>
            {pace ? `, with ${pace}% of the month gone (day ${day} of ${daysIn}, the tick on each bar)` : ""}.
          </p>
        </>
      ) : null}

      <ul className={`grid gap-3 sm:grid-cols-2 ${hasPlan ? "xl:grid-cols-3" : ""}`}>
        {rows.map((r, i) => {
          const b = budgetOf(r.key);
          const s = spentOf(r.key);
          const runTone = budgetStatus(b.running, s.running).tone;
          const labTone = labourTone(b.labour, s.labour);
          const left = b.labour + b.running - (s.labour + s.running);
          const share = r.key !== GENERAL && orderTotal > 0 ? Math.round(((plan.orders[r.key] ?? 0) / orderTotal) * 100) : null;
          const on = picked === r.key;
          return (
            <li key={r.key}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => pick(r.key)}
                className={`focus-ring block w-full rounded-2xl border p-4 text-left transition ${on ? "border-accent bg-accent-soft/40" : "border-line-soft bg-surface/60 hover:border-accent/50"}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 text-sm font-bold">
                    <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
                    <span className="truncate">{r.name}</span>
                  </span>
                  {hasPlan ? (
                    <span className={`shrink-0 text-xs font-bold ${b.labour + b.running === 0 ? (s.labour + s.running > 0 ? "text-bad" : "text-muted") : TEXT[worst(runTone, labTone)]}`}>
                      {b.labour + b.running === 0 ? (s.labour + s.running > 0 ? "No budget" : "Nothing planned") : left >= 0 ? `${formatINR(left)} left` : `${formatINR(-left)} over`}
                    </span>
                  ) : (
                    <span className="shrink-0 font-mono text-sm font-bold tabular-nums">{formatINR(s.running)}</span>
                  )}
                </span>
                {hasPlan ? (
                  <>
                    <Meter label="Running costs" spent={s.running} budget={b.running} tone={runTone} pace={pace} />
                    {b.labour > 0 || s.labour > 0 ? <Meter label="Labour" spent={s.labour} budget={b.labour} tone={labTone} /> : null}
                  </>
                ) : (
                  <>
                    <span aria-hidden="true" className="mt-2.5 block h-1.5 overflow-hidden rounded-full bg-line-soft">
                      <span className="sp-bar block h-full rounded-full" style={{ width: `${(s.running / maxRunning) * 100}%`, background: BAR.ok, ["--i" as string]: i }} />
                    </span>
                    <span className="mt-2 block text-xs text-muted">
                      {r.key === GENERAL
                        ? "Not tied to one warehouse"
                        : `${share !== null ? `${share}% of orders · ` : ""}${plan.people[r.key] ?? 0} people · salaries ${formatINR(plan.salaries[r.key] ?? 0)}`}
                    </span>
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {!hasPlan ? (
        <p className="mt-3 text-xs text-muted">
          Plan sets how much each warehouse can spend in {plan.label}, labour included: labour starts from its salaries, and running costs can be shared out by its
          orders.
        </p>
      ) : null}
      <BudgetSheet open={open} onClose={() => setOpen(false)} plan={plan} />
    </section>
  );
}

type Draft = Record<string, { labour: string; running: string }>;
const text = (n: number) => (n > 0 ? String(n) : "");

/** Where planning starts: the month's saved budget; else the month before's; else salaries and last month's running costs. */
function startingDraft(plan: BudgetPlan): { draft: Draft; from: string | null } {
  const keys = [...plan.warehouses.map((w) => w.id), GENERAL];
  const lines = plan.lines.length ? plan.lines : plan.lastLines;
  if (lines.length) {
    const saved = new Map(lines.map((l) => [l.warehouseId ?? GENERAL, l]));
    return {
      draft: Object.fromEntries(keys.map((k) => [k, { labour: text(saved.get(k)?.labour ?? 0), running: text(saved.get(k)?.running ?? 0) }])),
      from: plan.lines.length ? null : `Starting from the ${plan.lastLabel} budget.`,
    };
  }
  return {
    draft: Object.fromEntries(keys.map((k) => [k, { labour: text(k === GENERAL ? 0 : (plan.salaries[k] ?? 0)), running: text(roundUp(plan.lastRunning[k] ?? 0, 500)) }])),
    from: `Starting from salaries and what each warehouse spent in ${plan.lastLabel}.`,
  };
}

/** Planning the month: labour and running costs per warehouse, with running costs shared out by orders if wanted. */
function BudgetSheet({ open, onClose, plan }: { open: boolean; onClose: () => void; plan: BudgetPlan }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft>({});
  const [from, setFrom] = useState<string | null>(null);
  const [total, setTotal] = useState("");
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const start = startingDraft(plan);
      setDraft(start.draft);
      setFrom(start.from);
      setTotal(text(plan.warehouses.reduce((n, w) => n + num(start.draft[w.id]?.running ?? ""), 0)));
    }
  }

  const keys = [...plan.warehouses.map((w) => ({ key: w.id, name: w.name, color: w.color })), { key: GENERAL, name: "General", color: "var(--muted)" }];
  const value = (k: string, field: "labour" | "running") => draft[k]?.[field] ?? "";
  const set = (k: string, field: "labour" | "running", v: string) => setDraft((d) => ({ ...d, [k]: { labour: d[k]?.labour ?? "", running: d[k]?.running ?? "", [field]: v } }));
  const orderTotal = plan.warehouses.reduce((n, w) => n + (plan.orders[w.id] ?? 0), 0);
  const split = () => {
    const amount = num(total);
    if (!amount) {
      toast.result({ ok: false, message: "Type the running costs for all warehouses together first." });
      return;
    }
    const parts = splitByShare(amount, Object.fromEntries(plan.warehouses.map((w) => [w.id, plan.orders[w.id] ?? 0])));
    for (const w of plan.warehouses) set(w.id, "running", String(parts[w.id] ?? 0));
  };
  const useLastSpend = () => {
    for (const k of keys) set(k.key, "running", text(roundUp(plan.lastRunning[k.key] ?? 0, 500)));
    setTotal(text(plan.warehouses.reduce((n, w) => n + roundUp(plan.lastRunning[w.id] ?? 0, 500), 0)));
  };
  const sumLabour = keys.reduce((n, k) => n + num(value(k.key, "labour")), 0);
  const sumRunning = keys.reduce((n, k) => n + num(value(k.key, "running")), 0);
  const save = () =>
    startTransition(async () => {
      const lines = keys.map((k) => ({ warehouseId: k.key === GENERAL ? null : k.key, labour: num(value(k.key, "labour")), running: num(value(k.key, "running")) }));
      if (toast.result(await saveBudget({ month: plan.month, lines }))) {
        router.refresh();
        onClose();
      }
    });

  return (
    <Sheet open={open} onClose={onClose} title={`Budget for ${plan.label}`} subtitle="How much each warehouse can spend this month, labour included.">
      {from ? <p className="mb-3 rounded-lg bg-accent-soft px-3 py-2 text-sm font-semibold text-accent-text">{from} Change anything before saving.</p> : null}
      <div className="rounded-2xl border border-line bg-surface p-3">
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Running costs for all warehouses (₹)
          <input className="input font-mono" inputMode="numeric" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="100000" />
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={split} disabled={orderTotal === 0} className={buttonClass("primary", "flex-1")}>
            Split by orders
          </button>
          <button type="button" onClick={useLastSpend} className={buttonClass("secondary", "flex-1")}>
            Use {plan.lastLabel} spend
          </button>
        </div>
        <p className="mt-2 text-xs text-muted">
          Split by orders shares the total by each warehouse&apos;s orders over the last 30 days. Running costs are everything but labour: packing, transport,
          food, repairs and the rest.
        </p>
      </div>

      <ul className="mt-4 flex flex-col gap-3">
        {keys.map((k) => {
          const share = k.key !== GENERAL && orderTotal > 0 ? Math.round(((plan.orders[k.key] ?? 0) / orderTotal) * 100) : null;
          return (
            <li key={k.key} className="rounded-2xl border border-line-soft bg-surface/60 p-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2 text-sm font-bold">
                  <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: k.color }} />
                  <span className="truncate">{k.name}</span>
                </span>
                <span className="shrink-0 font-mono text-sm font-bold tabular-nums">{formatINR(num(value(k.key, "labour")) + num(value(k.key, "running")))}</span>
              </div>
              <p className="mb-2 text-xs text-muted">
                {k.key === GENERAL
                  ? "Spending not tied to one warehouse."
                  : `${formatNumber(plan.orders[k.key] ?? 0)} orders in 30 days${share !== null ? ` (${share}%)` : ""} · ${plan.people[k.key] ?? 0} people · salaries ${formatINR(plan.salaries[k.key] ?? 0)}`}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                  Labour (₹)
                  <input className="input font-mono" inputMode="numeric" value={value(k.key, "labour")} onChange={(e) => set(k.key, "labour", e.target.value)} placeholder="0" />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                  Running costs (₹)
                  <input className="input font-mono" inputMode="numeric" value={value(k.key, "running")} onChange={(e) => set(k.key, "running", e.target.value)} placeholder="0" />
                </label>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-surface2/60 p-3 text-sm">
        <span className="min-w-0 text-muted">
          Labour <b className="font-mono text-ink">{formatINR(sumLabour)}</b> · Running <b className="font-mono text-ink">{formatINR(sumRunning)}</b>
        </span>
        <span className="shrink-0 font-mono text-base font-bold tabular-nums">{formatINR(sumLabour + sumRunning)}</span>
      </div>
      <button type="button" disabled={pending} onClick={save} className={buttonClass("primary", "mt-3 w-full")}>
        {pending ? "Saving…" : `Save ${plan.label} budget`}
      </button>
    </Sheet>
  );
}
