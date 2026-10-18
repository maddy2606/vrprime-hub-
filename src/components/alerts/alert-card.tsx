import type { ReactNode } from "react";
import {
  AlertIcon,
  BellIcon,
  BoardIcon,
  BoxIcon,
  CheckIcon,
  ClockIcon,
  InboxIcon,
  RefreshIcon,
  RupeeIcon,
  TicketIcon,
  TruckIcon,
  UsersIcon,
} from "@/components/icons";
import { Chip } from "@/components/ui";
import { alertLines, kindTone } from "@/lib/alerts";
import { NOTIFICATION_ICON_LABEL, type Tone } from "@/lib/labels";
import type { NotificationRow } from "@/lib/types";

const KIND_ICON: Record<string, (p: { className?: string }) => ReactNode> = {
  sync_alert: RefreshIcon,
  dispatch_risk: TruckIcon,
  stock_alert: BoxIcon,
  overdue: ClockIcon,
  listing_not_found: AlertIcon,
  capacity_alert: UsersIcon,
  follow_up: TicketIcon,
  money_reminder: RupeeIcon,
  assigned: BoardIcon,
  comment: InboxIcon,
  done: CheckIcon,
  listing_live: CheckIcon,
};

const TONE_BAR: Record<Tone, string> = {
  bad: "bg-bad",
  warn: "bg-warn",
  info: "bg-info",
  accent: "bg-accent",
  ok: "bg-ok",
  neutral: "bg-line",
};

const TONE_ICON: Record<Tone, string> = {
  bad: "bg-bad-soft text-bad",
  warn: "bg-warn-soft text-warn",
  info: "bg-info-soft text-info",
  accent: "bg-accent-soft text-accent-text",
  ok: "bg-ok-soft text-ok",
  neutral: "bg-surface2 text-muted",
};

export function KindIcon({ kind, className = "h-5 w-5" }: { kind: string; className?: string }) {
  const Icon = KIND_ICON[kind] ?? BellIcon;
  return <Icon className={className} />;
}

/** The body as short lines: one per product or warehouse, with its badge on the right. */
export function AlertBody({ kind, body, max = 6 }: { kind: string; body: string | null; max?: number }) {
  const { lead, lines } = alertLines(kind, body);
  return (
    <>
      {lead ? <p className="mt-1 break-words text-sm text-muted">{lead}</p> : null}
      {lines.length ? (
        <ul className="mt-2 flex flex-col gap-1">
          {lines.slice(0, max).map((line, i) =>
            line.badge ? (
              <li key={i} className="flex min-h-9 items-center justify-between gap-3 rounded-lg bg-surface2/70 px-2.5 py-1 text-sm">
                <span className="min-w-0 truncate font-semibold">{line.text}</span>
                <Chip tone={line.badge.tone}>{line.badge.label}</Chip>
              </li>
            ) : (
              <li key={i} className="px-2.5 text-xs text-muted">
                {line.text}
              </li>
            ),
          )}
          {lines.length > max ? <li className="px-2.5 text-xs font-semibold text-muted">+{lines.length - max} more</li> : null}
        </ul>
      ) : null}
    </>
  );
}

/**
 * One notification as a card: a colour bar and icon for how urgent it is, what kind it is, when, the title and the body
 * as lines. `children` goes underneath (the buttons in the alerts panel).
 */
export function NotificationCard({
  n,
  when,
  unread = false,
  note,
  children,
}: {
  n: NotificationRow;
  /** "12m ago" in the panel, "Today 9:30 am" in the list. */
  when: string;
  unread?: boolean;
  /** A line under the body, such as "+3 earlier alerts like this". */
  note?: string;
  children?: ReactNode;
}) {
  const tone = kindTone(n.kind);
  // The icon sits in the top row, so the title, the lines and the buttons get the card's full width on a phone.
  return (
    <div className={`relative overflow-hidden rounded-2xl border ${unread ? "border-line bg-surface" : "border-line-soft bg-surface/70"}`}>
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${TONE_BAR[tone]} ${unread ? "" : "opacity-40"}`} />
      <div className="py-3 pl-4 pr-3.5">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${TONE_ICON[tone]}`}>
            <KindIcon kind={n.kind} className="h-[18px] w-[18px]" />
          </span>
          <Chip tone={tone}>{NOTIFICATION_ICON_LABEL[n.kind] ?? "Update"}</Chip>
          {unread ? <span aria-label="Unread" className="h-2 w-2 shrink-0 rounded-full bg-accent" /> : null}
          <span className="ml-auto shrink-0 text-xs text-muted">{when}</span>
        </div>
        <p className={`mt-2 break-words text-[15px] leading-snug ${unread ? "font-extrabold" : "font-bold text-ink/85"}`}>{n.title}</p>
        <AlertBody kind={n.kind} body={n.body} />
        {note ? <p className="mt-2 text-xs font-semibold text-muted">{note}</p> : null}
        {children}
      </div>
    </div>
  );
}
