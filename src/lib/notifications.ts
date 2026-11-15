import type { NotificationRow } from "@/lib/types";

/**
 * Where tapping a notification goes. The Edge Function (supabase/functions/notify)
 * has the same rules for the link inside a push message: keep the two in step.
 */
/**
 * The Monday that starts the week a weekly summary covers: the summary is sent on a Monday morning (India time) about the
 * seven days before it, so this is the Monday a week before the day it was created. Missing date: now.
 */
export function weeklySummaryStart(createdAt?: string | null): string {
  const t = createdAt ? Date.parse(createdAt) : NaN;
  const ist = new Date((Number.isFinite(t) ? t : Date.now()) + 330 * 60_000);
  ist.setUTCDate(ist.getUTCDate() - 7 - ((ist.getUTCDay() + 6) % 7));
  return ist.toISOString().slice(0, 10);
}

export function notificationUrl(n: Pick<NotificationRow, "kind" | "post_id" | "ticket_id"> & { title?: string | null; created_at?: string | null }): string {
  if (n.post_id) return `/posts/${n.post_id}`;
  if (n.ticket_id) return `/tickets/${n.ticket_id}`;
  if (n.kind === "follow_up") return "/tickets?tab=due";
  if (n.kind === "overdue") return "/";
  if (n.kind === "dispatch_risk") return "/flipkart?tab=orders";
  if (n.kind === "money_reminder") return "/money?tab=uploads";
  if (n.kind === "stock_alert") return "/flipkart?tab=forecast";
  if (n.kind === "capacity_alert") return "/team";
  if (n.kind === "closing_report") return "/reports/closing";
  if (n.kind === "listing_alert") return "/flipkart?tab=listingcheck";
  if (n.kind === "weekly_summary") return `/business?tab=week&start=${weeklySummaryStart(n.created_at)}`;
  if (n.kind === "sync_alert") {
    // Which sync: the title says ("WhatsApp expenses…", "Flipkart orders…", "Flipkart stock…", "VR Prime stock…").
    const t = (n.title ?? "").toLowerCase();
    if (t.includes("whatsapp")) return "/notifications";
    if (t.includes("orders")) return "/flipkart?tab=orders";
    if (t.startsWith("flipkart stock")) return "/flipkart?tab=stock";
    return "/flipkart?tab=forecast";
  }
  return "/notifications";
}
