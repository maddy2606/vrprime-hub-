import Link from "next/link";
import { ClosingTable } from "@/components/reports/closing-table";
import { buttonClass, EmptyState, PageTitle } from "@/components/ui";
import type { ClosingRow } from "@/lib/closing-report";
import { addDays, formatDate } from "@/lib/format";

/**
 * Closing report (graphite-spec 12.4): title, the day as subtitle, previous and next day arrows (the attendance panel's
 * day picker), then the table. `base` is the page's address so the preview can reuse it.
 */
export function ClosingReport({ day, today, rows, ready, base = "/reports/closing" }: { day: string; today: string; rows: ClosingRow[]; ready: boolean; base?: string }) {
  const prev = addDays(day, -1);
  const next = addDays(day, 1);
  const sep = base.includes("?") ? "&" : "?";
  const href = (d: string) => (d >= today ? base : `${base}${sep}day=${d}`);
  return (
    <div>
      <PageTitle
        title="Closing report"
        sub={day === today ? `Today · ${formatDate(day, today)}` : formatDate(day, today)}
        action={
          <nav aria-label="Choose a day" className="flex items-center gap-1.5">
            <Link prefetch={false} href={href(prev)} className={buttonClass("outline", "px-3")} aria-label="Previous day">
              ←
            </Link>
            {day < today ? (
              <Link prefetch={false} href={href(next)} className={buttonClass("outline", "px-3")} aria-label="Next day">
                →
              </Link>
            ) : (
              <span className={buttonClass("outline", "px-3 opacity-40")} aria-hidden="true">
                →
              </span>
            )}
          </nav>
        }
      />
      {!ready ? (
        <EmptyState title="The closing report is not set up yet" body="It starts once migration 20261116093000_closing_report.sql is applied." />
      ) : rows.length ? (
        <ClosingTable rows={rows} />
      ) : (
        <EmptyState title="No closing report for this day." body="It is written at 9:50 pm India time, after the last order read of the day." />
      )}
    </div>
  );
}
