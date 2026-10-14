import type { Metadata } from "next";
import Link from "next/link";
import { TicketCard, type TicketPost } from "@/components/tickets/ticket-card";
import { TicketFilters } from "@/components/tickets/ticket-filters";
import { buttonClass, EmptyState, PageTitle } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import { formatNumber, todayIST } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { TICKET_TABS, type TicketFilterValues, type TicketTab } from "@/lib/ticket-options";
import { ISSUE_TYPES, OPEN_TICKET_STATUSES, PLATFORMS, type IssueType, type Platform } from "@/lib/types";

export const metadata: Metadata = { title: "Tickets" };

const PAGE_SIZE = 200;

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** Reads filters from the URL, dropping anything that is not a known value. */
function readFilters(sp: Record<string, string | string[] | undefined>): TicketFilterValues {
  const platform = one(sp.platform);
  const issue = one(sp.issue);
  const tab = one(sp.tab);
  return {
    q: one(sp.q).slice(0, 100),
    platform: (PLATFORMS as readonly string[]).includes(platform) ? platform : "",
    issue: (ISSUE_TYPES as readonly string[]).includes(issue) ? issue : "",
    // `due=1` is the address older notifications used for the Follow-up due tab.
    tab: (TICKET_TABS as readonly string[]).includes(tab) ? (tab as TicketTab) : one(sp.due) === "1" ? "due" : "open",
  };
}

const EMPTY: Record<TicketTab, { title: string; body: string }> = {
  open: {
    title: "No open tickets",
    body: "When you open a ticket on the marketplace, save it here so its follow-up is not forgotten. You can also raise one from a problem post.",
  },
  waiting: {
    title: "Nothing is waiting for the marketplace",
    body: "Tickets you mark as waiting for the marketplace show up here.",
  },
  due: { title: "No follow-ups due", body: "Tickets whose follow-up date is today or earlier show up here." },
  closed: { title: "No closed tickets yet", body: "Resolved and rejected tickets show up here." },
};

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const filters = readFilters(await searchParams);
  const today = todayIST();

  const supabase = await createClient();
  let query = supabase.rpc("search_tickets", { q: filters.q }).select("*");
  if (filters.platform) query = query.eq("platform", filters.platform as Platform);
  if (filters.issue) query = query.eq("issue_type", filters.issue as IssueType);
  switch (filters.tab) {
    case "open":
      query = query.eq("status", "open");
      break;
    case "waiting":
      query = query.eq("status", "waiting_marketplace");
      break;
    case "due":
      query = query.in("status", OPEN_TICKET_STATUSES).lte("next_follow_up", today);
      break;
    case "closed":
      query = query.in("status", ["resolved", "rejected"]);
      break;
  }
  // Soonest follow-up first (tickets without one last). Closed tickets: most recently changed first.
  query =
    filters.tab === "closed"
      ? query.order("updated_at", { ascending: false })
      : query.order("next_follow_up", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false });
  query = query.limit(PAGE_SIZE);

  const [{ data: tickets, error }, countsResult, lookups] = await Promise.all([
    query,
    supabase.rpc("ticket_counts", {
      q: filters.q,
      p_platform: filters.platform || null,
      p_issue: filters.issue || null,
    }),
    getLookups(),
  ]);
  if (error || countsResult.error) throw new Error("Could not load tickets");
  const counts = countsResult.data[0] ?? { open_count: 0, waiting_count: 0, follow_up_due: 0, closed_count: 0 };

  // The problem each ticket was raised from. RLS decides which posts this person can see.
  const postIds = [...new Set(tickets.map((t) => t.post_id).filter((id): id is string => Boolean(id)))];
  const posts = new Map<string, TicketPost>();
  if (postIds.length) {
    const { data } = await supabase.from("posts").select("id, number, title, warehouse_id").in("id", postIds);
    for (const p of data ?? []) posts.set(p.id, p);
  }

  const searching = Boolean(filters.q || filters.platform || filters.issue);
  const tabTotal = { open: counts.open_count, waiting: counts.waiting_count, due: counts.follow_up_due, closed: counts.closed_count }[
    filters.tab
  ];

  return (
    <>
      <PageTitle
        title="Tickets"
        sub={`${formatNumber(counts.open_count)} open · ${formatNumber(counts.waiting_count)} waiting · ${formatNumber(counts.follow_up_due)} follow-up due`}
        action={
          <Link prefetch={false} href="/tickets/new" className={buttonClass("primary", "shrink-0")}>
            + Ticket
          </Link>
        }
      />
      <TicketFilters values={filters} counts={counts} />

      {tickets.length ? (
        <>
          {tabTotal > tickets.length ? (
            <p className="mb-2 text-sm text-muted">
              Showing the first {formatNumber(tickets.length)} of {formatNumber(tabTotal)}. Search or filter to see the rest.
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2 2xl:grid-cols-3">
            {tickets.map((ticket) => {
              const post = ticket.post_id ? (posts.get(ticket.post_id) ?? null) : null;
              return (
                <TicketCard
                  key={ticket.id}
                  ticket={ticket}
                  post={post}
                  warehouseName={post?.warehouse_id ? lookups.warehouseName(post.warehouse_id) : null}
                  today={today}
                />
              );
            })}
          </div>
        </>
      ) : searching ? (
        <EmptyState
          title="No tickets match here"
          body="Nothing in this group matches your search. The numbers on the tabs show where the matches are, or clear the search."
        />
      ) : (
        <EmptyState
          {...EMPTY[filters.tab]}
          action={
            filters.tab === "open" ? (
              <Link prefetch={false} href="/tickets/new" className={buttonClass("primary")}>
                + Ticket
              </Link>
            ) : undefined
          }
        />
      )}
    </>
  );
}
