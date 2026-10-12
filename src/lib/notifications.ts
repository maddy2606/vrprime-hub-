import type { NotificationRow } from "@/lib/types";

/**
 * Where tapping a notification goes. The Edge Function (supabase/functions/notify)
 * has the same rules for the link inside a push message: keep the two in step.
 */
export function notificationUrl(n: Pick<NotificationRow, "kind" | "post_id" | "ticket_id">): string {
  if (n.post_id) return `/posts/${n.post_id}`;
  if (n.ticket_id) return `/tickets/${n.ticket_id}`;
  if (n.kind === "follow_up") return "/tickets?due=1";
  if (n.kind === "overdue") return "/";
  return "/notifications";
}
