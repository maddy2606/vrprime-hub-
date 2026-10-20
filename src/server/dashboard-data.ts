import "server-only";
import { ALERT_KINDS } from "@/lib/alerts";
import { counts } from "@/lib/expenses";
import { todayIST } from "@/lib/format";
import { notificationUrl } from "@/lib/notifications";
import { logError } from "@/lib/redact";
import { createClient } from "@/lib/supabase/server";
import type { SessionUser } from "@/lib/types";
import { loadDeck, type DeckData } from "@/server/deck-data";
import { loadPnl, monthLabel, type PnlData } from "@/server/pnl-data";

// The owner's dashboard: money (P&L and ads), orders and dispatch, expenses against budgets, and alerts, from the loaders
// the P&L page, the Command Deck and the Expenses page already use.

type Loose = { from: (table: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

export type DashExpenses = {
  month: string;
  label: string;
  total: number;
  count: number;
  /** One row per warehouse (and "General"): what the group spent, and the month's running-costs budget if one is set. */
  rows: { key: string; name: string; color: string; spent: number; budget: number | null; href: string }[];
  hasBudget: boolean;
};
export type DashAlert = { id: string; kind: string; title: string; body: string | null; createdAt: string; href: string };
export type DashboardData = { deck: DeckData; pnl: PnlData; expenses: DashExpenses; alerts: DashAlert[]; today: string };

async function soft<T>(what: string, fallback: T, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    logError(`dashboard ${what}`, error);
    return fallback;
  }
}

async function loadExpenses(db: Loose, today: string, deck: DeckData): Promise<DashExpenses> {
  const month = today.slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  // The month in India time: from midnight IST on the 1st.
  const since = new Date(Date.UTC(y, m - 1, 1) - 5.5 * 3_600_000).toISOString();
  const [expRes, budRes] = await Promise.all([
    db.from("expenses").select("amount, status, verdict, warehouse_id").gte("spent_at", since).limit(5000),
    db.from("expense_budgets").select("warehouse_id, running").eq("month", month),
  ]);
  const spent = new Map<string, number>();
  let total = 0;
  let count = 0;
  for (const e of (expRes.data ?? []) as { amount: number | null; status: string; verdict: string; warehouse_id: string | null }[]) {
    if (!counts({ status: e.status, verdict: e.verdict })) continue;
    const k = e.warehouse_id ?? "general";
    spent.set(k, (spent.get(k) ?? 0) + Number(e.amount ?? 0));
    total += Number(e.amount ?? 0);
    count++;
  }
  const budget = new Map<string, number>();
  for (const b of (budRes.data ?? []) as { warehouse_id: string | null; running: number }[]) budget.set(b.warehouse_id ?? "general", Number(b.running));
  const rows = deck.warehouses.map((w) => ({ key: w.id, name: w.name, color: w.color, spent: spent.get(w.id) ?? 0, budget: budget.get(w.id) ?? null, href: "/expenses" }));
  if (spent.has("general") || budget.has("general")) rows.push({ key: "general", name: "General", color: "var(--muted)", spent: spent.get("general") ?? 0, budget: budget.get("general") ?? null, href: "/expenses" });
  return { month, label: monthLabel(month), total, count, rows, hasBudget: budget.size > 0 };
}

async function loadAlerts(db: Loose, userId: string): Promise<DashAlert[]> {
  const { data } = await db
    .from("notifications")
    .select("id, kind, title, body, created_at, post_id, ticket_id")
    .eq("user_id", userId)
    .is("read_at", null)
    .in("kind", ALERT_KINDS as unknown as string[])
    .gte("created_at", new Date(Date.now() - 3 * 86_400_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(6);
  return ((data ?? []) as { id: string; kind: string; title: string; body: string | null; created_at: string; post_id: string | null; ticket_id: string | null }[]).map((n) => ({
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    createdAt: n.created_at,
    href: notificationUrl({ kind: n.kind, title: n.title, post_id: n.post_id, ticket_id: n.ticket_id }),
  }));
}

export async function loadDashboard(user: SessionUser): Promise<DashboardData> {
  const today = todayIST();
  const db = (await createClient()) as unknown as Loose;
  const [deck, pnl] = await Promise.all([loadDeck(user), loadPnl()]);
  const [expenses, alerts] = await Promise.all([
    soft("expenses", { month: today.slice(0, 7), label: monthLabel(today.slice(0, 7)), total: 0, count: 0, rows: [], hasBudget: false }, () => loadExpenses(db, today, deck)),
    soft("alerts", [], () => loadAlerts(db, user.id)),
  ]);
  return { deck, pnl, expenses, alerts, today };
}
