import Link from "next/link";
import type { MonthPnl } from "@/components/pnl/pnl-board";
import { buttonClass, EmptyState, SectionHead } from "@/components/ui";
import { targetView } from "@/lib/business";
import { formatINR } from "@/lib/format";

const rs = (n: number) => formatINR(Math.round(n));

/** One target: target, so far, percent, the progress bar with today's marker, the pace and what is needed a day. */
function TargetCard({ title, target, soFar, today, covered }: { title: string; target: number | null; soFar: number; today: string; covered: number | null }) {
  const id = `tg-${title.toLowerCase()}`;
  if (target === null) {
    return (
      <section className="span-6 min-w-0" aria-label={title}>
        <EmptyState
          title={`No ${title.toLowerCase()} target set`}
          body="Set a monthly target in Settings › Targets."
          action={
            <Link prefetch={false} href="/admin/settings" className={buttonClass("secondary")}>
              Open Settings
            </Link>
          }
        />
      </section>
    );
  }
  const v = targetView(target, soFar, today, covered);
  const fill = target > 0 ? Math.min(100, (soFar / target) * 100) : 0;
  const marker = target > 0 ? Math.min(100, (v.expected / target) * 100) : 0;
  return (
    <section className="sp-card g-pad span-6 min-w-0" aria-labelledby={id}>
      <SectionHead id={id} title={title} sub={`Target ${rs(target)} a month`} />
      <p className="t-stat tabular-nums">{rs(soFar)}</p>
      <p className="t-caption mt-0.5">so far · {Math.round(v.pctOfTarget)}% of target</p>
      <div className="relative mt-4 h-2.5 rounded-full bg-surface2" role="img" aria-label={`${Math.round(v.pctOfTarget)}% of the target; today should be at ${Math.round(marker)}%`}>
        <div className="sp-bar h-full rounded-[6px] bg-accent" style={{ width: `${fill}%` }} />
        <span className="absolute -top-1 bottom-[-4px] w-[2px] bg-ink" style={{ left: `calc(${marker}% - 1px)` }} aria-hidden="true" />
      </div>
      {v.pace !== null && v.gap !== null ? (
        <p className={`mt-4 text-[14px] font-medium ${v.gap >= 0 ? "text-ok" : "text-warn"}`}>
          On pace for {rs(v.pace)}: {v.gap >= 0 ? "ahead" : "behind"} by {rs(Math.abs(v.gap))}
        </p>
      ) : (
        <p className="t-caption mt-4">No figures for this month yet.</p>
      )}
      <p className="t-caption mt-1">
        Needs {rs(v.perDay)} a day for the {v.daysLeft} {v.daysLeft === 1 ? "day" : "days"} left
      </p>
    </section>
  );
}

/**
 * Business › Targets (graphite-spec 12.1): this month's revenue and profit after ads from the Dashboard's own loader,
 * against the monthly targets in Settings, and the last four months against them.
 */
export function TargetsTab({ months, today, sales, profit }: { months: MonthPnl[]; today: string; sales: number | null; profit: number | null }) {
  const thisMonth = today.slice(0, 7);
  const now = months[0]?.month === thisMonth ? months[0] : null;
  // The Dashboard's "covered": the day of the month the figures run to.
  const covered = now?.to ? Number(now.to.slice(8, 10)) : null;
  const last4 = months.slice(0, 4).reverse();
  const max = Math.max(1, ...last4.map((m) => Math.max(m.total.sales, m.total.net)), sales ?? 0, profit ?? 0);
  const line = (v: number | null, label: string) =>
    v === null ? null : (
      <span className="pointer-events-none absolute inset-x-0 border-t border-dashed border-muted" style={{ bottom: `${(v / max) * 100}%` }} title={`${label} ${rs(v)}`} aria-hidden="true" />
    );
  return (
    <div className="g-grid items-start">
      <TargetCard title="Sales" target={sales} soFar={now?.total.sales ?? 0} today={today} covered={covered} />
      <TargetCard title="Profit" target={profit} soFar={now?.total.net ?? 0} today={today} covered={covered} />
      <section className="sp-card g-pad span-12 min-w-0" aria-labelledby="tg-months">
        <SectionHead id="tg-months" title="Last four months" sub="Revenue and profit after ads; the dashed lines are the targets" />
        {last4.length ? (
          <div>
            <div className="relative flex h-48 items-end gap-4">
              {line(sales, "Sales target")}
              {line(profit, "Profit target")}
              {last4.map((m, mi) => (
                <span key={m.month} className="flex h-full min-w-0 flex-1 items-end justify-center gap-1.5">
                  {[
                    { v: m.total.sales, c: "var(--accent)", l: "Revenue" },
                    { v: Math.max(0, m.total.net), c: "var(--ok)", l: "Profit" },
                  ].map((b, bi) => (
                    <span key={b.l} title={`${b.l} ${rs(b.v)}`} className="sp-bar-y w-5 rounded-[6px] sm:w-7" style={{ height: `${Math.max(3, (b.v / max) * 100)}%`, background: b.c, ["--i" as string]: mi * 2 + bi }} />
                  ))}
                </span>
              ))}
            </div>
            <div className="mt-2 flex gap-4">
              {last4.map((m) => (
                <span key={m.month} className="min-w-0 flex-1 text-center text-xs font-semibold">
                  {m.label.split(" ")[0].slice(0, 3)}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <p className="t-caption py-10 text-center">No months yet.</p>
        )}
        <p className="t-caption mt-3 flex flex-wrap gap-3">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--accent)" }} />
            Revenue
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--ok)" }} />
            Profit after ads
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 border-t border-dashed border-muted" />
            Target
          </span>
        </p>
      </section>
    </div>
  );
}
