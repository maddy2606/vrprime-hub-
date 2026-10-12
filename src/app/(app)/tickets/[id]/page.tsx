import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { BackIcon } from "@/components/icons";
import { FollowUpChip } from "@/components/tickets/ticket-card";
import { TicketForm } from "@/components/tickets/ticket-form";
import { buttonClass, Chip } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatDateTime, postNumber, todayIST, ticketNumber } from "@/lib/format";
import { ISSUE_LABEL, PLATFORM_LABEL, TICKET_STATUS_LABEL, TICKET_STATUS_TONE } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Read once per request, shared by the tab title and the page. RLS hides tickets this
// person may not see, so "not visible" and "does not exist" look the same.
const getTicket = cache(async (id: string) => {
  if (!UUID.test(id)) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("tickets").select("*").eq("id", id).maybeSingle();
  return data;
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const ticket = await getTicket((await params).id);
  return { title: ticket ? `${ticketNumber(ticket.number)} ${ticket.ticket_id}` : "Ticket" };
}

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const ticket = await getTicket((await params).id);
  if (!ticket) notFound();

  const supabase = await createClient();
  const { data: post } = ticket.post_id
    ? await supabase.from("posts").select("id, number, title").eq("id", ticket.post_id).maybeSingle()
    : { data: null };
  const today = todayIST();

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-3">
        <Link prefetch={false} href="/tickets" className={buttonClass("ghost", "-ml-3 px-3")}>
          <BackIcon className="h-5 w-5" /> All tickets
        </Link>
      </div>

      <div className="mb-4 rounded-xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-sm font-medium text-muted">{ticketNumber(ticket.number)}</span>
          <Chip tone="accent">{PLATFORM_LABEL[ticket.platform]}</Chip>
          <Chip>{ISSUE_LABEL[ticket.issue_type]}</Chip>
          <Chip tone={TICKET_STATUS_TONE[ticket.status]}>{TICKET_STATUS_LABEL[ticket.status]}</Chip>
          <FollowUpChip ticket={ticket} today={today} />
        </div>
        <h1 className="mt-3 break-all font-mono text-xl font-extrabold leading-snug tracking-tight">{ticket.ticket_id}</h1>
        <p className="mt-1 text-xs text-muted">Saved {formatDateTime(ticket.created_at)}</p>
        {post ? (
          <Link prefetch={false} href={`/posts/${post.id}`} className="focus-ring mt-3 block rounded-lg bg-canvas p-3 text-sm font-bold">
            <span className="block text-xs font-semibold text-muted">Linked post</span>
            <span className="font-mono">{postNumber(post.number)}</span> {post.title}
          </Link>
        ) : null}
      </div>

      <TicketForm
        ticketId={ticket.id}
        today={today}
        linkedPost={null}
        initial={{
          ticket_id: ticket.ticket_id,
          platform: ticket.platform,
          issue_type: ticket.issue_type,
          post_id: ticket.post_id ?? "",
          sku: ticket.sku ?? "",
          raised_on: ticket.raised_on,
          next_follow_up: ticket.next_follow_up ?? "",
          status: ticket.status,
          resolution_notes: ticket.resolution_notes ?? "",
        }}
      />
    </div>
  );
}
