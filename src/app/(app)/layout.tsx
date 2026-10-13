import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isMoneyEnabled } from "@/server/money-flag";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  // RLS limits this to the signed-in person's own notifications.
  const supabase = await createClient();
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  const money = user.role === "owner" && (await isMoneyEnabled());
  return (
    <AppShell user={user} unread={count ?? 0} money={money}>
      {children}
    </AppShell>
  );
}
