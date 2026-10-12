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
          body="You will see it here when work is assigned to you, someone comments on your post, or your post is marked done. Overdue work and ticket follow-ups are listed here every morning at 9:30."
        />
      )}
    </div>
  );
}
