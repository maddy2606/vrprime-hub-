import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { BudgetLine, BudgetPlan } from "@/components/expenses/budget";
import { ExpensesBoard, type ExpenseRow, type MonthTotal, type WhatsAppState } from "@/components/expenses/expenses-board";
import { requireUser } from "@/lib/auth";
import { isLabour, nextMonth, previousMonth } from "@/lib/budget";
import { counts, monthOf } from "@/lib/expenses";
import { todayIST } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { warehouseColor } from "@/lib/theme";

export const metadata: Metadata = { title: "Expenses" };

// The tables are newer than the generated types.
type Loose = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
  storage: { from: (bucket: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
};

const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
const shiftDay = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Warehouse expenses from the WhatsApp group, month by month, with each month's budget per warehouse. Owner only. */
export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  if (user.role !== "owner") notFound();
  const db = (await createClient()) as unknown as Loose;
  const sp = await searchParams;
  const today = todayIST();
  const thisMonth = today.slice(0, 7);
  const asked = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : null;

  const [stateRes, allRes, whRes, staffRes, payRes, loadRes] = await Promise.all([
    db.from("whatsapp_state").select("linked_as, group_id, group_name, groups, last_fetch_at, last_result, last_error, busy_until").maybeSingle(),
    db
      .from("expenses")
      .select("id, key, spent_at, sender, reason, category, amount, amount_from, text_amount, read_amount, paid_to, reference, status, verdict, edited, read_done, image_path, thumb_path, warehouse_id")
      .order("spent_at", { ascending: false })
      .limit(10000),
    db.from("warehouses").select("id, name, sort_order").order("sort_order"),
    db.from("staff").select("id, warehouse_id").eq("active", true),
    db.from("staff_pay").select("staff_id, monthly_salary"),
    // Orders placed per warehouse, the last 31 days: each warehouse's share of the work.
    db.rpc("team_order_load", { p_days: 31 }),
  ]);
  const all = (allRes.data ?? []) as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any

  const byMonth = new Map<string, MonthTotal>();
  for (const e of all) {
    const m = monthOf(e.spent_at);
    const t = byMonth.get(m) ?? { month: m, label: monthLabel(m), total: 0, count: 0 };
    if (counts({ status: String(e.status), verdict: String(e.verdict) })) {
      t.total += Number(e.amount ?? 0);
      t.count += 1;
    }
    byMonth.set(m, t);
  }
  // This month and the next are always there, so next month's budget can be planned ahead.
  for (const m of [thisMonth, nextMonth(thisMonth)]) if (!byMonth.has(m)) byMonth.set(m, { month: m, label: monthLabel(m), total: 0, count: 0 });
  const months = [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month));
  const month = asked && byMonth.has(asked) ? asked : thisMonth;

  const rows = all.filter((e) => monthOf(e.spent_at) === month);
  // Private screenshots: links that work for two hours, made for this month only.
  const paths = rows.flatMap((e) => [e.thumb_path, e.image_path].filter(Boolean)) as string[];
  const urls = new Map<string, string>();
  for (let i = 0; i < paths.length; i += 100) {
    const { data } = await db.storage.from("expenses").createSignedUrls(paths.slice(i, i + 100), 7200);
    for (const s of data ?? []) if (s.signedUrl && s.path) urls.set(s.path, s.signedUrl);
  }

  const expenses: ExpenseRow[] = rows.map((e) => ({
    id: e.id,
    spentAt: e.spent_at,
    sender: e.sender,
    reason: e.reason,
    category: e.category,
    amount: e.amount === null ? null : Number(e.amount),
    amountFrom: e.amount_from,
    textAmount: e.text_amount === null ? null : Number(e.text_amount),
    readAmount: e.read_amount === null ? null : Number(e.read_amount),
    paidTo: e.paid_to,
    reference: e.reference,
    status: e.status,
    verdict: e.verdict,
    warehouseId: e.warehouse_id ?? null,
    manual: e.key === null,
    readDone: e.read_done,
    isPdf: typeof e.image_path === "string" && e.image_path.endsWith(".pdf"),
    thumbUrl: e.thumb_path ? (urls.get(e.thumb_path) ?? null) : null,
    imageUrl: e.image_path ? (urls.get(e.image_path) ?? null) : null,
  }));

  // ---- The budget plan ------------------------------------------------------------------------------------------------
  const warehouses = ((whRes.data ?? []) as { id: string; name: string }[]).map((w, i) => ({ id: w.id, name: w.name, color: warehouseColor(w.name, i) }));
  // Monthly salaries per warehouse, from the Team page (people still on the books).
  const pay = new Map(((payRes.data ?? []) as { staff_id: string; monthly_salary: number }[]).map((p) => [p.staff_id, Number(p.monthly_salary)]));
  const salaries: Record<string, number> = {};
  const people: Record<string, number> = {};
  for (const s of (staffRes.data ?? []) as { id: string; warehouse_id: string }[]) {
    salaries[s.warehouse_id] = (salaries[s.warehouse_id] ?? 0) + (pay.get(s.id) ?? 0);
    people[s.warehouse_id] = (people[s.warehouse_id] ?? 0) + 1;
  }
  const orders: Record<string, number> = {};
  const since = shiftDay(today, -30);
  for (const r of (Array.isArray(loadRes.data) ? loadRes.data : []) as { kind: string; day: string; warehouse_id: string | null; orders: number }[]) {
    if (r.kind === "placed" && r.warehouse_id && r.day >= since && r.day < today) orders[r.warehouse_id] = (orders[r.warehouse_id] ?? 0) + Number(r.orders);
  }
  // Last month's running costs per warehouse ("general" for those with none), a starting point for this month's plan.
  const before = previousMonth(month);
  const lastRunning: Record<string, number> = {};
  for (const e of all) {
    if (monthOf(e.spent_at) !== before || !counts({ status: String(e.status), verdict: String(e.verdict) }) || isLabour(e.category)) continue;
    const k = e.warehouse_id ?? "general";
    lastRunning[k] = (lastRunning[k] ?? 0) + Number(e.amount ?? 0);
  }
  // This month's budget, and the month before's (where planning starts when this month has none).
  const { data: budgetRows } = await db.from("expense_budgets").select("month, warehouse_id, labour, running").in("month", [month, before]);
  const linesFor = (m: string): BudgetLine[] =>
    ((budgetRows ?? []) as { month: string; warehouse_id: string | null; labour: number; running: number }[])
      .filter((b) => b.month === m)
      .map((b) => ({ warehouseId: b.warehouse_id, labour: Number(b.labour), running: Number(b.running) }));
  const plan: BudgetPlan = {
    month,
    label: monthLabel(month),
    lines: linesFor(month),
    lastLines: linesFor(before),
    warehouses,
    salaries,
    people,
    orders,
    lastRunning,
    lastLabel: monthLabel(before),
  };

  const s = stateRes.data as Record<string, any> | null; // eslint-disable-line @typescript-eslint/no-explicit-any
  const whatsapp: WhatsAppState = {
    linkedAs: s?.linked_as ?? null,
    groupId: s?.group_id ?? null,
    groupName: s?.group_name ?? null,
    groups: Array.isArray(s?.groups) ? s.groups : [],
    lastFetchAt: s?.last_fetch_at ?? null,
    lastResult: s?.last_result ?? null,
    lastError: s?.last_error ?? null,
  };
  const prev = months.find((m) => m.month < month) ?? null;

  return <ExpensesBoard month={month} months={months} previous={prev} expenses={expenses} whatsapp={whatsapp} today={today} plan={plan} />;
}
