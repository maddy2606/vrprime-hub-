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
  const [{ count }, lookups, runs, money] = await Promise.all([
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
    getLookups(),
    supabase.from("order_runs").select("finished_at").eq("status", "done").order("finished_at", { ascending: false }).limit(1),
    user.role === "owner" ? isMoneyEnabled() : Promise.resolve(false),
  ]);
  const mine = lookups.warehouses.filter((w) => user.warehouseIds.includes(w.id)).map((w) => w.name);
  const scope = user.role === "warehouse" ? (mine.length ? mine.join(", ") : "No warehouse yet") : "All warehouses";
  return (
    <AppShell user={user} unread={count ?? 0} money={money} scope={scope} syncedAt={runs.data?.[0]?.finished_at ?? null}>
      {children}
    </AppShell>
  );
}
