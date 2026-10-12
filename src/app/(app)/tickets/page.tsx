import type { Metadata } from "next";
import Link from "next/link";
import { TicketCard } from "@/components/tickets/ticket-card";
import { TicketFilters } from "@/components/tickets/ticket-filters";
import { TicketTotals } from "@/components/tickets/ticket-totals";
import { buttonClass, EmptyState, PageTitle } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatNumber, todayIST } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { TicketFilterValues } from "@/lib/ticket-options";
import {
  ISSUE_TYPES,
  OPEN_TICKET_STATUSES,
  PLATFORMS,
  TICKET_STATUSES,
  type IssueType,
  type Platform,
  type TicketStatus,
} from "@/lib/types";

export const metadata: Metadata = { title: "Tickets" };

const PAGE_SIZE = 200;

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** Reads filters from the URL, dropping anything that is not a known value. */
function readFilters(sp: Record<string, string | string[] | undefined>): TicketFilterValues {
  const platform = one(sp.platform);
  const status = one(sp.status);
  const issue = one(sp.issue);
  return {
    q: one(sp.q).slice(0, 100),
    platform: (PLATFORMS as readonly string[]).includes(platform) ? platform : "",
    status: ["active", "any", ...TICKET_STATUSES].includes(status) ? status : "",
    issue: (ISSUE_TYPES as readonly string[]).includes(issue) ? issue : "",
    due: one(sp.due) === "1",
  };
}

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const filters = readFilters(await searchParams);
  const today = todayIST();
  // With no status chosen: show tickets still being chased, but search across everything.
  const effectiveStatus = filters.status || (filters.q ? "any" : "active");

  const supabase = await createClient();
  let query = supabase.rpc("search_tickets", { q: filters.q }, { count: "exact" }).select("*");
  if (filters.platform) query = query.eq("platform", filters.platform as Platform);
  if (filters.issue) query = query.eq("issue_type", filters.issue as IssueType);
  if (filters.due) query = query.in("status", OPEN_TICKET_STATUSES).lte("next_follow_up", today);
  else if (effectiveStatus === "active") query = query.in("status", OPEN_TICKET_STATUSES);
  else if (effectiveStatus !== "any") query = query.eq("status", effectiveStatus as TicketStatus);
  // Soonest follow-up first, tickets with no follow-up date last, newest first within a day.
  query = query
    .order("next_follow_up", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  const [{ data: tickets, error, count }, totalsResult] = await Promise.all([query, supabase.rpc("ticket_totals")]);
  if (error || totalsResult.error) throw new Error("Could not load tickets");

  const totals = totalsResult.data[0] ?? { open_count: 0, open_amount: 0, recovered_amount: 0, follow_up_due: 0 };
  const total = count ?? tickets.length;
  const filtered = Boolean(filters.q || filters.platform || filters.status || filters.issue || filters.due);

  return (
    <>
      <PageTitle
        title="Tickets"
        sub={
          total > tickets.length
            ? `Showing the first ${formatNumber(tickets.length)} of ${formatNumber(total)}. Narrow the filters to see the rest.`
            : `${formatNumber(total)} ${total === 1 ? "ticket" : "tickets"}`
        }
        action={
          <Link prefetch={false} href="/tickets/new" className={buttonClass("primary", "shrink-0")}>
            + Ticket
          </Link>
        }
      />
      <TicketTotals totals={totals} />
      <TicketFilters values={filters} effectiveStatus={effectiveStatus} />

      {tickets.length ? (
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2 2xl:grid-cols-3">
          {tickets.map((ticket) => (
            <TicketCard key={ticket.id} ticket={ticket} today={today} />
          ))}
        </div>
      ) : filtered ? (
        <EmptyState
          title="No tickets match"
          body="Try a different ticket ID or SKU, or clear the filters. Resolved and rejected tickets only show when you pick that status or search."
        />
      ) : (
        <EmptyState
          title="No open tickets"
          body="When a marketplace ticket is raised, save it here so its follow-up is not forgotten. You can also raise one from a problem post."
          action={
            <Link prefetch={false} href="/tickets/new" className={buttonClass("primary")}>
              + Ticket
            </Link>
          }
        />
      )}
    </>
  );
}
