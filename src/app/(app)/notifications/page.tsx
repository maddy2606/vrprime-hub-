import type { Metadata } from "next";
import { MarkAllReadButton, NotificationList } from "@/components/notifications/notification-list";
import { PushSettings } from "@/components/notifications/push-settings";
import { EmptyState, PageTitle } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Notifications" };

const SHOWN = 100;

export default async function NotificationsPage() {
  const user = await requireUser();
  const supabase = await createClient();
  // RLS: only this person's own notifications come back.
  const { data: items, error } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(SHOWN);
  if (error) throw new Error("Could not load notifications");

  const unread = items.filter((n) => !n.read_at).length;
  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle
        title="Notifications"
        sub={unread ? `${unread} unread` : items.length ? "You are all caught up" : undefined}
        action={unread ? <MarkAllReadButton /> : undefined}
      />
      <PushSettings userId={user.id} />
      {items.length ? (
        <NotificationList items={items} />
      ) : (
        <EmptyState
          title="No notifications yet"
          body="Alerts (stock running out, orders that may miss dispatch, sync problems, too few people for the orders) and updates on your work show up here."
        />
      )}
    </div>
  );
}
