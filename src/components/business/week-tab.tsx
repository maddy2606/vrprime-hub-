import Link from "next/link";
import { TrendIcon } from "@/components/icons";
import { buttonClass, Chip, EmptyState, ItemRow, SectionHead } from "@/components/ui";
import { change, changeTone, movers, signed, signedPct, WEEK_ROWS, type WeekFigures } from "@/lib/business";
import { addDays, formatDate, formatINR, formatNumber } from "@/lib/format";

const TONE_CLASS = { ok: "text-ok", bad: "text-bad", muted: "text-muted" } as const;

/** Two thin bars, this week over last week, sharing one scale (Bar's track, --accent and --muted marks). */
function PairBars({ cur, prev }: { cur: number; prev: number }) {
  const max = Math.max(cur, prev, 1);
  return (
    <span className="flex w-full min-w-[80px] flex-col gap-1" aria-hidden="true">
      <span className="h-1.5 overflow-hidden rounded-full bg-surface2">
        <span className="sp-bar block h-full rounded-[6px] bg-accent" style={{ width: `${(cur / max) * 100}%` }} />
      </span>
      <span className="h-1.5 overflow-hidden rounded-full bg-surface2">
        <span className="sp-bar block h-full rounded-[6px] bg-muted" style={{ width: `${(prev / max) * 100}%` }} />
      </span>
    </span>
  );
}

/**
 * Business › This week (graphite-spec 12.1): the week against the same days of the week before, then the five products
 * rising and falling the most.
 */
export function WeekTab({
  start,
  days,
  today,
  cur,
  prev,
  ready,
  base = "/business",
}: {
  start: string;
  days: number;
  today: string;
  cur: WeekFigures;
  prev: WeekFigures;
  ready: boolean;
  base?: string;
}) {
  const end = addDays(start, 6);
  const current = end >= today;
  const sep = base.includes("?") ? "&" : "?";
  const weekHref = (s: string) => `${base}${sep}tab=week&start=${s}`;
  const range = `${formatDate(start, today)} to ${formatDate(current ? today : end, today)}`;
  const nav = (
    <nav aria-label="Choose a week" className="flex items-center gap-1.5">
      <Link prefetch={false} href={weekHref(addDays(start, -7))} className={buttonClass("outline", "px-3")} aria-label="Previous week">
        ←
      </Link>
      {current ? (
        <span className={buttonClass("outline", "px-3 opacity-40")} aria-hidden="true">
          →
        </span>
      ) : (
        <Link prefetch={false} href={weekHref(addDays(start, 7))} className={buttonClass("outline", "px-3")} aria-label="Next week">
          →
        </Link>
      )}
    </nav>
  );
  if (!ready) {
    return <EmptyState title="The Business page is not set up yet" body="It starts once migration 20261116090000_business.sql is applied." />;
  }
  const { rising, falling } = movers(cur.byProduct, prev.byProduct);
  return (
    <div className="g-grid items-start">
      <section className="sp-card g-pad span-12 min-w-0" aria-labelledby="week-title">
        <SectionHead
          id="week-title"
          title={current ? "This week" : "Week"}
          sub={`${range} · against the same ${days === 7 ? "7 days" : `${days} ${days === 1 ? "day" : "days"}`} of the week before`}
          action={nav}
        />
        <div className="overflow-x-auto">
          <table className="ledger w-full">
            <thead>
              <tr>
                <th scope="col" className="text-left">Figure</th>
                <th scope="col" className="text-right">This week</th>
                <th scope="col" className="text-right">Last week</th>
                <th scope="col" className="text-right">Change</th>
                <th scope="col" className="w-[22%]"><span className="sr-only">This week and last week</span></th>
              </tr>
            </thead>
            <tbody>
              {WEEK_ROWS.map((r) => {
                const a = cur[r.key];
                const b = prev[r.key];
                const c = change(a, b);
                const fmt = r.money ? (n: number) => formatINR(Math.round(n)) : formatNumber;
                return (
                  <tr key={r.key}>
                    <td className="text-left">
                      <span className="font-medium">{r.label}</span>
                      {r.key === "adSpend" ? <span className="t-caption block">Ads report read up to {cur.adsReadTo ? formatDate(cur.adsReadTo, today) : "—"}</span> : null}
                    </td>
                    <td className="num tabular-nums">{fmt(a)}</td>
                    <td className="num tabular-nums text-muted">{fmt(b)}</td>
                    <td className={`num tabular-nums ${TONE_CLASS[changeTone(r.key, a, b)]}`}>
                      {signed(c.diff, fmt)} <span className="text-[12px]">({signedPct(c.pct)})</span>
                    </td>
                    <td>
                      <PairBars cur={a} prev={b} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      {[
        { title: "Rising", list: rising, tint: "green" as const, tone: "ok" as const, flip: false, none: "No product sold clearly more than the week before." },
        { title: "Falling", list: falling, tint: "red" as const, tone: "bad" as const, flip: true, none: "No product sold clearly less than the week before." },
      ].map((card) => (
        <section key={card.title} className="sp-card g-pad span-6 min-w-0" aria-labelledby={`mv-${card.title}`}>
          <SectionHead id={`mv-${card.title}`} title={card.title} sub="Units against the week before; products under 5 units in both weeks are left out" />
          {card.list.length ? (
            <div className="item-list">
              {card.list.map((m) => (
                <ItemRow
                  key={m.key}
                  icon={<TrendIcon className={card.flip ? "-scale-y-100" : undefined} />}
                  tint={card.tint}
                  title={m.name}
                  detail={`${formatNumber(m.units)} units, was ${formatNumber(m.was)}`}
                  end={<Chip tone={card.tone}>{signed(m.diff, formatNumber)}</Chip>}
                />
              ))}
            </div>
          ) : (
            <p className="t-caption py-6 text-center">{card.none}</p>
          )}
        </section>
      ))}
    </div>
  );
}
