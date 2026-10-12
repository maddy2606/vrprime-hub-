import Link from "next/link";
import { formatNumber } from "@/lib/format";
import { ticketsUrl, type TicketFilterValues, type TicketTab } from "@/lib/ticket-options";

export type TicketCounts = { open_count: number; waiting_count: number; follow_up_due: number; closed_count: number };

const TABS: { key: TicketTab; label: string; count: (c: TicketCounts) => number }[] = [
  { key: "open", label: "Open", count: (c) => c.open_count },
  { key: "waiting", label: "Waiting for marketplace", count: (c) => c.waiting_count },
  { key: "due", label: "Follow-up due", count: (c) => c.follow_up_due },
  { key: "closed", label: "Closed", count: (c) => c.closed_count },
];

/** The four groups, each with a count for the current search and filters. */
export function TicketTabs({ filters, counts }: { filters: TicketFilterValues; counts: TicketCounts }) {
  return (
    <nav aria-label="Ticket groups" className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {TABS.map((tab) => {
        const active = filters.tab === tab.key;
        const count = tab.count(counts);
        const urgent = tab.key === "due" && count > 0;
        return (
          <Link
            key={tab.key}
            prefetch={false}
            href={ticketsUrl(filters, tab.key)}
            aria-current={active ? "page" : undefined}
            className={`focus-ring flex min-h-16 min-w-0 flex-col justify-between rounded-xl border p-3 ${
              active ? "border-accent bg-accent-soft" : urgent ? "border-bad/50 bg-surface" : "border-line bg-surface"
            }`}
          >
            <span className={`text-xs font-bold leading-tight ${active ? "text-accent-text" : "text-muted"}`}>{tab.label}</span>
            <span
              className={`mt-1 text-xl font-extrabold leading-none tracking-tight ${
                active ? "text-accent-text" : urgent ? "text-bad" : "text-ink"
              }`}
            >
              {formatNumber(count)}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
