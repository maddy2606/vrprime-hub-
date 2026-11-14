import "server-only";
import { ALERT_KINDS } from "@/lib/alerts";
import { todayIST } from "@/lib/format";
import { notificationUrl } from "@/lib/notifications";
import { logError } from "@/lib/redact";
import { createClient } from "@/lib/supabase/server";
import type { SessionUser } from "@/lib/types";
import { loadDeck, type DeckData } from "@/server/deck-data";
import { loadPnl, type PnlData } from "@/server/pnl-data";

// The owner's dashboard: money (P&L and ads), orders and dispatch, and alerts, from the loaders
// the P&L page, and the Command Deck already use.

type Loose = { from: (table: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

export type DashAlert = { id: string; kind: string; title: string; body: string | null; createdAt: string; href: string };
export type DashboardData = { deck: DeckData; pnl: PnlData; alerts: DashAlert[]; today: string };

async function soft<T>(what: string, fallback: T, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    logError(`dashboard ${what}`, error);
    return fallback;
  }
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
  const alerts = await soft("alerts", [], () => loadAlerts(db, user.id));
  return { deck, pnl, alerts, today };
}
