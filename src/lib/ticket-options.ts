// Plain values shared by server pages and client components (no "use client" here:
// a server page importing a value from a client module gets a stub, not the value).
import { addDays } from "@/lib/format";
import type { IssueType, Platform, TicketStatus } from "@/lib/types";

export type TicketFilterValues = {
  q: string;
  platform: string;
  status: string;
  issue: string;
  due: boolean;
};

export type TicketFormValues = {
  ticket_id: string;
  platform: Platform;
  issue_type: IssueType;
  post_id: string;
  sku: string;
  amount_involved: string;
  raised_on: string;
  next_follow_up: string;
  status: TicketStatus;
  resolution_notes: string;
  amount_recovered: string;
};

/** A new ticket: raised today, to be followed up in 3 days unless the person says otherwise. */
export function emptyTicket(today: string): TicketFormValues {
  return {
    ticket_id: "",
    platform: "flipkart",
    issue_type: "other",
    post_id: "",
    sku: "",
    amount_involved: "",
    raised_on: today,
    next_follow_up: addDays(today, 3),
    status: "open",
    resolution_notes: "",
    amount_recovered: "",
  };
}
