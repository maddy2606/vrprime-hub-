import Link from "next/link";
import { Chip } from "@/components/ui";
import { dueState, formatDate, postNumber, ticketNumber } from "@/lib/format";
import { ISSUE_LABEL, PLATFORM_LABEL, TICKET_STATUS_LABEL, TICKET_STATUS_TONE } from "@/lib/labels";
import { OPEN_TICKET_STATUSES, type Ticket } from "@/lib/types";

/** The problem post a ticket was raised from, as shown on the ticket row. */
export type TicketPost = { id: string; number: number; title: string; warehouse_id: string | null };

/** Whether a ticket still needs chasing: "due" means its follow-up is today or already past. */
export function followUpState(ticket: Pick<Ticket, "status" | "next_follow_up">, today: string) {
  if (!OPEN_TICKET_STATUSES.includes(ticket.status) || !ticket.next_follow_up) return "none" as const;
  const state = dueState(ticket.next_follow_up, today);
  return state === "overdue" || state === "today" ? ("due" as const) : ("later" as const);
}

/** Small chip used on the post page and ticket page. Red when the follow-up is today or past. */
export function FollowUpChip({ ticket, today }: { ticket: Pick<Ticket, "status" | "next_follow_up">; today: string }) {
  const state = followUpState(ticket, today);
  if (state === "none" || !ticket.next_follow_up) return null;
  if (state === "due") {
    return <Chip tone="bad">{dueState(ticket.next_follow_up, today) === "today" ? "Follow up today" : `Follow-up was ${formatDate(ticket.next_follow_up, today)}`}</Chip>;
  }
  return <Chip tone="neutral">Follow up {formatDate(ticket.next_follow_up, today)}</Chip>;
}

type Props = {
  ticket: Ticket;
  post: TicketPost | null;
  warehouseName: string | null;
  today: string;
};

/**
 * One ticket on the Tickets page. Tapping the row opens the ticket; tapping the
 * problem's title opens the post. (The row link is stretched over the whole card,
 * and the post link sits above it.)
 */
export function TicketCard({ ticket, post, warehouseName, today }: Props) {
  const due = followUpState(ticket, today) === "due";
  return (
    <div
      className={`relative min-w-0 rounded-xl border bg-surface p-3 transition focus-within:border-accent hover:border-accent ${
        due ? "border-bad/60" : "border-line"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-xs font-medium text-muted">{ticketNumber(ticket.number)}</span>
        <span className="ml-auto">
          <Chip tone={TICKET_STATUS_TONE[ticket.status]}>{TICKET_STATUS_LABEL[ticket.status]}</Chip>
        </span>
      </div>

      <Link
        prefetch={false}
        href={`/tickets/${ticket.id}`}
        className="focus-ring mt-2 block break-all font-mono text-[15px] font-bold leading-snug after:absolute after:inset-0 after:rounded-xl"
      >
        {ticket.ticket_id}
      </Link>

      {post ? (
        <p className="mt-1 break-words text-sm leading-snug">
          <Link
            prefetch={false}
            href={`/posts/${post.id}`}
            className="focus-ring relative z-10 font-semibold text-accent-text hover:underline"
          >
            <span className="font-mono">{postNumber(post.number)}</span> · {post.title}
          </Link>
        </p>
      ) : (
        <p className="mt-1 text-sm text-muted">Not linked to a post</p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Chip tone="accent">{PLATFORM_LABEL[ticket.platform]}</Chip>
        <Chip>{ISSUE_LABEL[ticket.issue_type]}</Chip>
        {warehouseName ? <Chip>{warehouseName}</Chip> : null}
      </div>

      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
        <span>Raised {formatDate(ticket.raised_on, today)}</span>
        {followUpState(ticket, today) !== "none" && ticket.next_follow_up ? (
          <span className={due ? "font-bold text-bad" : undefined}>
            Follow-up {dueState(ticket.next_follow_up, today) === "today" ? "today" : formatDate(ticket.next_follow_up, today)}
          </span>
        ) : null}
      </p>
    </div>
  );
}
