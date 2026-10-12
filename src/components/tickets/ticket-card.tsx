import Link from "next/link";
import { Chip } from "@/components/ui";
import { dueState, formatDate, formatINR, ticketNumber } from "@/lib/format";
import { ISSUE_LABEL, PLATFORM_LABEL, TICKET_STATUS_LABEL, TICKET_STATUS_TONE } from "@/lib/labels";
import { OPEN_TICKET_STATUSES, type Ticket } from "@/lib/types";

/** Whether a ticket still needs chasing, and how urgently. */
export function followUpState(ticket: Pick<Ticket, "status" | "next_follow_up">, today: string) {
  if (!OPEN_TICKET_STATUSES.includes(ticket.status) || !ticket.next_follow_up) return "none" as const;
  const state = dueState(ticket.next_follow_up, today);
  return state === "overdue" ? ("overdue" as const) : state === "today" ? ("today" as const) : ("later" as const);
}

export function FollowUpChip({ ticket, today }: { ticket: Pick<Ticket, "status" | "next_follow_up">; today: string }) {
  const state = followUpState(ticket, today);
  if (state === "none" || !ticket.next_follow_up) return null;
  if (state === "overdue") return <Chip tone="bad">Follow-up was {formatDate(ticket.next_follow_up, today)}</Chip>;
  if (state === "today") return <Chip tone="warn">Follow up today</Chip>;
  return <Chip tone="neutral">Follow up {formatDate(ticket.next_follow_up, today)}</Chip>;
}

export function TicketCard({ ticket, today }: { ticket: Ticket; today: string }) {
  const state = followUpState(ticket, today);
  return (
    <Link
      prefetch={false}
      href={`/tickets/${ticket.id}`}
      className={`focus-ring block min-w-0 rounded-xl border bg-surface p-3 transition hover:border-accent ${
        state === "overdue" ? "border-bad/60" : state === "today" ? "border-warn/60" : "border-line"
      }`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-xs font-medium text-muted">{ticketNumber(ticket.number)}</span>
        <Chip tone="accent">{PLATFORM_LABEL[ticket.platform]}</Chip>
        <Chip>{ISSUE_LABEL[ticket.issue_type]}</Chip>
        <span className="ml-auto">
          <Chip tone={TICKET_STATUS_TONE[ticket.status]}>{TICKET_STATUS_LABEL[ticket.status]}</Chip>
        </span>
      </div>
      <p className="mt-2 break-all font-mono text-[15px] font-bold leading-snug">{ticket.ticket_id}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted">
        {ticket.sku ? <span className="max-w-full truncate font-mono">{ticket.sku}</span> : null}
        {ticket.amount_involved !== null ? (
          <span className="font-semibold text-ink">{formatINR(ticket.amount_involved)}</span>
        ) : null}
        {ticket.amount_recovered ? <span className="text-ok">recovered {formatINR(ticket.amount_recovered)}</span> : null}
        <span className="ml-auto">
          <FollowUpChip ticket={ticket} today={today} />
        </span>
      </div>
    </Link>
  );
}
