import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExpensesBoard, type ExpenseRow, type MonthTotal, type WhatsAppState } from "@/components/expenses/expenses-board";
import { requireUser } from "@/lib/auth";
import { counts, monthOf } from "@/lib/expenses";
import { todayIST } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Expenses" };

// The tables are newer than the generated types.
type Loose = { from: (table: string) => any; storage: { from: (bucket: string) => any } }; // eslint-disable-line @typescript-eslint/no-explicit-any

const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

/** Warehouse expenses from the WhatsApp group, month by month. Owner only. */
export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  if (user.role !== "owner") notFound();
  const db = (await createClient()) as unknown as Loose;
  const sp = await searchParams;

  const [stateRes, allRes] = await Promise.all([
    db.from("whatsapp_state").select("linked_as, group_id, group_name, groups, last_fetch_at, last_result, last_error, busy_until").maybeSingle(),
    db
      .from("expenses")
      .select("id, key, spent_at, sender, reason, category, amount, amount_from, text_amount, read_amount, paid_to, reference, status, verdict, edited, read_done, image_path, thumb_path")
      .order("spent_at", { ascending: false })
      .limit(10000),
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
  const thisMonth = todayIST().slice(0, 7);
  if (!byMonth.has(thisMonth)) byMonth.set(thisMonth, { month: thisMonth, label: monthLabel(thisMonth), total: 0, count: 0 });
  const months = [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month));
  const asked = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : null;
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
    manual: e.key === null,
    readDone: e.read_done,
    isPdf: typeof e.image_path === "string" && e.image_path.endsWith(".pdf"),
    thumbUrl: e.thumb_path ? (urls.get(e.thumb_path) ?? null) : null,
    imageUrl: e.image_path ? (urls.get(e.image_path) ?? null) : null,
  }));

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

  return <ExpensesBoard month={month} months={months} previous={prev} expenses={expenses} whatsapp={whatsapp} today={todayIST()} />;
}
