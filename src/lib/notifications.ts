import type { NotificationRow } from "@/lib/types";

/**
 * Where tapping a notification goes. The Edge Function (supabase/functions/notify)
 * has the same rules for the link inside a push message: keep the two in step.
 */
export function notificationUrl(n: Pick<NotificationRow, "kind" | "post_id" | "ticket_id"> & { title?: string | null }): string {
  if (n.post_id) return `/posts/${n.post_id}`;
  if (n.ticket_id) return `/tickets/${n.ticket_id}`;
  if (n.kind === "follow_up") return "/tickets?tab=due";
  if (n.kind === "overdue") return "/";
  if (n.kind === "dispatch_risk") return "/flipkart?tab=orders";
  if (n.kind === "money_reminder") return "/money?tab=uploads";
  if (n.kind === "stock_alert") return "/flipkart?tab=forecast";
  if (n.kind === "capacity_alert") return "/team";
  if (n.kind === "sync_alert") {
    // Which sync: the title says ("WhatsApp expenses…", "Flipkart orders…", "Flipkart stock…", "VR Prime stock…").
    const t = (n.title ?? "").toLowerCase();
    if (t.includes("whatsapp")) return "/expenses";
    if (t.includes("orders")) return "/flipkart?tab=orders";
    if (t.startsWith("flipkart stock")) return "/flipkart?tab=stock";
    return "/flipkart?tab=forecast";
  }
  return "/notifications";
}
