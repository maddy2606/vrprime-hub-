import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { isMoneyEnabled } from "@/server/money-flag";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  // RLS limits this to the signed-in person's own notifications.
  const supabase = await createClient();
  // The unread count for the bell, and the newest unread ones for the alerts panel that opens with the site.
  const [{ data: alerts, count }, lookups, runs, money] = await Promise.all([
    supabase.from("notifications").select("*", { count: "exact" }).is("read_at", null).order("created_at", { ascending: false }).limit(60),
    getLookups(),
    supabase.from("order_runs").select("finished_at").eq("status", "done").order("finished_at", { ascending: false }).limit(1),
    user.role === "owner" ? isMoneyEnabled() : Promise.resolve(false),
  ]);
  const mine = lookups.warehouses.filter((w) => user.warehouseIds.includes(w.id)).map((w) => w.name);
  const scope = user.role === "warehouse" ? (mine.length ? mine.join(", ") : "No warehouse yet") : "All warehouses";
  return (
    <AppShell
      user={user}
      unread={count ?? 0}
      alerts={alerts ?? []}
      money={money}
      scope={scope}
      syncedAt={runs.data?.[0]?.finished_at ?? null}
    >
      {children}
    </AppShell>
  );
}
