// Plain values shared by server pages and client components (no "use client" here:
// a server page importing a value from a client module gets a stub, not the value).
import { addDays } from "@/lib/format";
import type { IssueType, Platform, TicketStatus } from "@/lib/types";

/** The four groups on the Tickets page. "open" is the default. */
export const TICKET_TABS = ["open", "waiting", "due", "closed"] as const;
export type TicketTab = (typeof TICKET_TABS)[number];

export type TicketFilterValues = {
  q: string;
  platform: string;
  issue: string;
  tab: TicketTab;
};

export type TicketFormValues = {
  ticket_id: string;
  platform: Platform;
  issue_type: IssueType;
  post_id: string;
  sku: string;
  raised_on: string;
  next_follow_up: string;
  status: TicketStatus;
  /** Free-text notes (stored in the resolution_notes column). */
  resolution_notes: string;
};

/** The page address for a set of filters. The default tab is left out. */
export function ticketsUrl(v: TicketFilterValues, tab: TicketTab = v.tab): string {
  const params = new URLSearchParams();
  if (v.q.trim()) params.set("q", v.q.trim());
  if (v.platform) params.set("platform", v.platform);
  if (v.issue) params.set("issue", v.issue);
  if (tab !== "open") params.set("tab", tab);
  const s = params.toString();
  return s ? `/tickets?${s}` : "/tickets";
}

/** A new ticket: raised today, to be followed up in 3 days unless the person says otherwise. */
export function emptyTicket(today: string): TicketFormValues {
  return {
    ticket_id: "",
    platform: "flipkart",
    issue_type: "other",
    post_id: "",
    sku: "",
    raised_on: today,
    next_follow_up: addDays(today, 3),
    status: "open",
    resolution_notes: "",
  };
}
