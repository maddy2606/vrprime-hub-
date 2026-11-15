import Link from "next/link";
import type { ReactNode } from "react";
import { AreaChart, Bar, PairedRows, ShareBar, Sparkline, TrendChart } from "@/components/signal/charts";
import { CountUp } from "@/components/signal/count-up";
import { Lanes, type Lane } from "@/components/signal/lanes";
import { QueueList } from "@/components/deck/queue";
import { buttonClass, Chip, Headline, SectionHead, Stat, StatStrip, withNumbers } from "@/components/ui";
import type { QueueKind } from "@/lib/deck";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { COLOR, type SignalTone } from "@/lib/theme";
import type { DeckData } from "@/server/deck-data";

/** Up or down against the period before, as a coloured tag; "steady" within 2%. */
function Delta({ pct, against }: { pct: number | null; against: string }) {
  if (pct === null) return null;
  if (Math.abs(pct) < 2) return <Chip tone="neutral">steady</Chip>;
  return (
    <Chip tone={pct > 0 ? "ok" : "bad"}>
      {pct > 0 ? "▲" : "▼"} {Math.abs(pct)}%<span className="sr-only"> {pct > 0 ? "up" : "down"} on {against}</span>
    </Chip>
  );
}

/**
 * The first thing on the page: the state of the day as one sentence, its numbers picked out in the day's colour, the
 * reassurance under it, and the two places to go next.
 */
export function DeckHeadline({ d, push }: { d: DeckData; push?: ReactNode }) {
  const { hero } = d;
  const time = formatDateTime(d.nowIso).replace(/^Today /, "");
  return (
    <header className="span-12">
      <div className="flex flex-col gap-4 min-[1100px]:flex-row min-[1100px]:items-end min-[1100px]:justify-between">
        <div className="min-w-0 max-w-3xl">
          <p className="t-label">
            Operations · {formatDate(d.today)} · {time}
          </p>
          <Headline text={hero.headline} tone={hero.tone} className={`mt-2 ${hero.tone === "ok" ? "text-ok" : ""}`} />
          <p className="t-caption mt-2">{withNumbers(hero.reassurance, "ink")}</p>
          {d.notes.length ? (
            <p role="status" className="t-caption mt-1">
              {d.notes.join(" ")}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <a href="#queue" className={buttonClass("primary")}>
            Open priority queue
          </a>
          <Link prefetch={false} href="/flipkart" className={buttonClass("secondary")}>
            Jump to Flipkart
          </Link>
        </div>
      </div>
      {push ? <div className="mt-4 [&>section]:mb-0">{push}</div> : null}
    </header>
  );
}

/** The deck's lanes: each warehouse's orders by stage, its health, the late count and the next dispatch time. */
function deckLanes(d: DeckData): Lane[] {
  const stages = new Map(d.whStages.map((s) => [s.id, s]));
  return d.warehouses.map((w) => {
    const s = stages.get(w.id);
    return {
      id: w.id,
      name: w.name,
      color: w.color,
      stages: { to_accept: s?.to_accept ?? 0, to_pack: s?.to_pack ?? 0, to_dispatch: s?.to_dispatch ?? 0 },
      late: w.late,
      next: w.next,
      chip: w.health.chip,
      note: `${w.health.pct}% on time`,
      figure: { value: w.active, label: w.out === null ? "active" : `active · ${formatNumber(w.out)} out` },
      href: w.href,
    };
  });
}

/**
 * The dispatch board, the page's one big picture: orders still to go out today against what the team packs, with
 * yesterday and the week beside it; and the warehouse lanes, where every active order is and how late the gate is.
 */
/** The hero card (spec 8.1, 5 cols): orders still to go out today, the capacity bar, and yesterday, the week, the busiest. */
export function TodayHero({ d }: { d: DeckData }) {
  const t = d.todayCard;
  const cap = t?.capacity ?? null;
  const used = t && cap && cap.comfortable > 0 ? Math.round((t.due / cap.comfortable) * 100) : null;
  const tone = used === null ? null : used > 100 ? "bad" : used > 85 ? "warn" : "ok";
  return (
    <section className="sp-card sp-hero g-pad span-5" aria-labelledby="today-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="today-title" className="t-label">
          To dispatch today
        </h2>
        {t && t.late > 0 ? (
          <Link prefetch={false} href="/flipkart?tab=orders&view=list" className="focus-ring rounded-full">
            <Chip tone="bad" live>
              {formatNumber(t.late)} late
            </Chip>
          </Link>
        ) : null}
      </div>
      {t ? (
        <>
          <p className="mt-3">
            <CountUp value={t.due} className={`t-hero inline-block ${t.late > 0 ? "is-bad" : ""}`} />
          </p>
          <p className="t-body mt-2 text-muted">
            orders still to go out today{t.warehouses ? ` across ${t.warehouses} ${t.warehouses === 1 ? "warehouse" : "warehouses"}` : ""}
          </p>
          {cap && used !== null ? (
            <div className="mt-5">
              <div className="g-track" role="img" aria-label={`${used}% of the ${formatNumber(cap.comfortable)} orders the team packs comfortably in a day`}>
                <span className="sp-bar" style={{ width: `${Math.min(100, used)}%` }} />
              </div>
              <p className="t-caption mt-2 flex flex-wrap justify-between gap-x-3 gap-y-1">
                <span>
                  <b className={`font-mono font-semibold ${tone === "ok" ? "text-ink" : tone === "warn" ? "text-warn" : "text-bad"}`}>{used}%</b> of what the team packs in a day
                </span>
                <span className="font-mono tabular-nums">
                  {formatNumber(cap.comfortable)} a day · {cap.staff} {cap.staff === 1 ? "person" : "people"}
                </span>
              </p>
            </div>
          ) : null}
          <StatStrip className="mt-5" ariaLabel="Yesterday, the 7-day average and the busiest warehouse">
            <Stat label="Yesterday" value={t.yesterday === null ? "—" : t.yesterday} sub={<Delta pct={t.yesterdayChange} against="the day before" />} />
            <Stat label="7-day avg" value={t.avg7 === null ? "—" : t.avg7} sub={<Delta pct={t.avg7Change} against="the week before" />} />
            <Stat
              label="Busiest"
              value={t.busiest ? t.busiest.orders : "—"}
              sub={
                t.busiest ? (
                  <span className="flex min-w-0 items-center gap-1.5 font-semibold text-ink">
                    <span aria-hidden="true" className="wh-dot" style={{ background: t.busiest.color, color: t.busiest.color }} />
                    <span className="truncate">{t.busiest.name}</span>
                  </span>
                ) : undefined
              }
            />
          </StatStrip>
        </>
      ) : (
        <p className="t-caption mt-3">Orders have not been read from Flipkart yet. The day&apos;s number appears after the first read.</p>
      )}
    </section>
  );
}

/** The warehouse lanes card (spec 8.1, 7 cols). */
export function LanesCard({ d }: { d: DeckData }) {
  const lanes = deckLanes(d);
  const active = d.whStages.reduce((n, r) => n + r.to_accept + r.to_pack + r.to_dispatch, 0);
  return (
    <section className="sp-card g-pad span-7" aria-labelledby="lanes-title">
      <SectionHead
        id="lanes-title"
        title="Where the orders are"
        sub="Every active order by warehouse and stage, as Seller Hub counts them. Tap a lane for its orders."
        action={
          <p className="text-right">
            <CountUp value={active} className="t-stat" />
            <span className="t-caption ml-1.5">active</span>
          </p>
        }
      />
      {lanes.length === 0 ? (
        <p className="t-caption py-8">No warehouse is set up for you yet.</p>
      ) : (
        <Lanes lanes={lanes} ariaLabel={`Active orders by warehouse and stage: ${d.whStages.map((r) => `${r.name}: ${r.to_accept} to accept, ${r.to_pack} to pack, ${r.to_dispatch} to dispatch`).join("; ")}`} />
      )}
    </section>
  );
}

/** Orders placed per day, the last 14 full days, with the 7-day average and the latest day picked out. */
export function OrdersTrend({ d }: { d: DeckData }) {
  const pts = d.trend;
  const avg = d.todayCard?.avg7 ?? null;
  const last = pts[pts.length - 1];
  const enough = pts.length >= 2 && pts.some((p) => p.orders > 0);
  return (
    <section className="sp-card g-pad span-7" aria-labelledby="trend-title">
      <SectionHead
        id="trend-title"
        title="Orders a day"
        sub={`Placed on Flipkart, last ${pts.length} days`}
        action={
          last ? (
            <p className="text-right">
              <CountUp value={last.orders} className="t-stat" />
              <span className="t-caption ml-1.5">yesterday</span>
            </p>
          ) : undefined
        }
      />
      {enough ? (
        <TrendChart
          data={pts.map((p) => ({ label: p.label, value: p.orders }))}
          avg={avg}
          avgLabel={avg === null ? "" : `7-day avg ${formatNumber(avg)}`}
          ariaLabel={`Orders placed per day, last ${pts.length} days: ${pts.map((p) => `${p.label} ${formatNumber(p.orders)}`).join(", ")}`}
        />
      ) : (
        <p className="t-caption py-10 text-center">The graph starts once a few days of orders are saved.</p>
      )}
    </section>
  );
}

const PULSE_TONE: Record<"bad" | "warn" | "cyan", "bad" | "warn" | "accent"> = { bad: "bad", warn: "warn", cyan: "accent" };

/** The three signals of the day as a strip: each a link, with its trend under the number. */
export function Pulses({ d }: { d: DeckData }) {
  if (!d.pulses.length) return null;
  return (
    <StatStrip ariaLabel="Today's signals" className="span-12">
      {d.pulses.map((p) => (
        <Stat
          key={p.key}
          label={p.label}
          value={p.value}
          sub={p.sub}
          tone={PULSE_TONE[p.tone]}
          href={p.href}
          chart={<Sparkline values={p.spark} tone={p.tone} label={p.sparkLabel} className="h-9 w-full" />}
        />
      ))}
    </StatStrip>
  );
}

function CheckIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

const ORDER_KINDS: QueueKind[] = ["late", "risk", "overfill", "dry"];
const WORK_KINDS: QueueKind[] = ["work", "ticket"];

/** One of the two priority queue cards, built from the same ranked list (same order within each card). */
function QueueCard({
  id,
  title,
  sub,
  rows,
  urgent,
  extra,
  span,
  empty,
}: {
  id: string;
  title: string;
  sub: string;
  rows: DeckData["queue"];
  urgent: boolean;
  extra?: ReactNode;
  span: string;
  empty: string;
}) {
  const clear = rows.length === 0;
  return (
    <section id={id} className={`sp-card ${span} scroll-mt-24 overflow-hidden`} aria-labelledby={`${id}-title`}>
      <div className="g-pad pb-0">
        <SectionHead
          id={`${id}-title`}
          title={title}
          sub={sub}
          action={
            <>
              {extra}
              {clear ? <Chip tone="ok">All clear</Chip> : <Chip tone={urgent ? "bad" : "neutral"}>{formatNumber(rows.length)} to do</Chip>}
            </>
          }
        />
      </div>
      {clear ? (
        <div className="flex flex-col items-center px-5 pb-10 pt-2 text-center">
          <CheckIcon className="h-8 w-8 text-faint" />
          <p className="t-card-title mt-3">All clear</p>
          <p className="t-caption mt-1 max-w-xs">{empty}</p>
        </div>
      ) : (
        <div className="border-t border-line-soft">
          <QueueList rows={rows.map((q) => ({ key: q.key, kind: q.kind, tag: q.tag, title: q.title, detail: q.detail, actions: q.actions }))} />
        </div>
      )}
    </section>
  );
}

export function PriorityQueue({ d }: { d: DeckData }) {
  const orders = d.queue.filter((q) => ORDER_KINDS.includes(q.kind));
  const work = d.queue.filter((q) => WORK_KINDS.includes(q.kind));
  return (
    <>
      <QueueCard
        id="queue"
        span="span-7"
        title="Orders and stock"
        sub="Ranked: late first, then what is about to be"
        rows={orders}
        urgent={orders.some((q) => q.kind === "late" || q.kind === "overfill")}
        empty="No late orders, no orders without stock and nothing dry."
      />
      <QueueCard
        id="queue-work"
        span="span-5"
        title="Work and tickets"
        sub="Work waiting for you and ticket follow-ups due"
        rows={work}
        urgent={false}
        extra={
          <Link prefetch={false} href="/tickets" className="focus-ring rounded-full">
            <Chip tone="accent">{formatNumber(d.kpis.openTickets)} open tickets</Chip>
          </Link>
        }
        empty="No follow-ups due and no work waiting for you."
      />
    </>
  );
}

export function DispatchChart({ d }: { d: DeckData }) {
  const x = d.dispatch;
  return (
    <section className="sp-card g-pad span-5" aria-labelledby="disp-title">
      <SectionHead
        id="disp-title"
        title="Dispatch, last 7 days"
        sub="Units dispatched per day"
        action={
          x ? (
            <p className="text-right">
              <CountUp value={x.total} className="t-stat" />
              <span className="t-caption ml-1.5">units</span>
              <span className="t-caption block font-mono">{formatNumber(x.avg)} a day on average</span>
            </p>
          ) : undefined
        }
      />
      {x && x.total > 0 ? (
        <AreaChart data={x.points} ariaLabel={`Units dispatched per day, last 7 days: ${x.points.map((p) => `${p.label} ${formatNumber(p.value)}`).join(", ")}`} formatY={(n) => (n >= 1000 ? `${formatNumber(Math.round(n / 100) / 10)}k` : formatNumber(Math.round(n)))} />
      ) : (
        <p className="t-caption py-10 text-center">No dispatches are saved for the last 7 days yet.</p>
      )}
    </section>
  );
}

/** Stock at a glance: five figures with their trend, each a link to the list behind it. */
export function StockHealth({ d }: { d: DeckData }) {
  const k = d.kpis;
  const delta = k.unitsChange;
  return (
    <section aria-labelledby="stock-title" className="span-6">
      <SectionHead id="stock-title" title="Stock health" sub={k.snapshot ? `From the stock read of ${formatDate(k.snapshot, d.today)}` : undefined} />
      <StatStrip className="wrap-5">
        <Stat
          label="Units in stock"
          value={k.units ?? 0}
          sub={delta === null ? "active listings" : delta === 0 ? "no change since last reading" : `${delta > 0 ? "+" : "−"}${formatNumber(Math.abs(delta))} since last reading`}
          chart={<Sparkline values={k.stockSeries.units} tone="cyan" label="Units in stock at each stock reading" className="h-9 w-full" />}
          href="/flipkart?tab=stock"
        />
        <Stat label="Low stock" value={k.low ?? 0} tone={(k.low ?? 0) > 0 ? "warn" : "ok"} sub="in stock, but low at a warehouse" chart={<Sparkline values={k.stockSeries.low} tone="warn" label="Low-stock SKUs at each stock reading" className="h-9 w-full" />} href="/flipkart?tab=stock&view=low&hide=1" />
        <Stat label="Out of stock" value={k.out ?? 0} tone={(k.out ?? 0) > 0 ? "bad" : "ok"} sub="active, no units anywhere" chart={<Sparkline values={k.stockSeries.out} tone="bad" label="Out-of-stock SKUs at each stock reading" className="h-9 w-full" />} href="/flipkart?tab=stock&view=out&hide=1" />
        <Stat label="Open tickets" value={k.openTickets} tone="accent" sub="open or waiting" chart={<Sparkline values={k.ticketSeries} tone="accent" label="Tickets raised per day, last 14 days" className="h-9 w-full" />} href="/tickets" />
        <Stat label="Weight alerts" value={k.weight ?? 0} tone={(k.weight ?? 0) > 0 ? "warn" : "ok"} sub="over the size and weight limit" href="/flipkart?tab=stock&view=weight&hide=1" />
      </StatStrip>
    </section>
  );
}

export function Movers({ d }: { d: DeckData }) {
  return (
    <section className="sp-card g-pad span-12" aria-labelledby="mov-title">
      <SectionHead
        id="mov-title"
        title="Forecast, top movers"
        sub={`Next 30 days, from ${formatNumber(d.moversDays)} days of dispatches`}
        action={
          <Link prefetch={false} href="/flipkart?tab=forecast" className={buttonClass("ghost")}>
            Full forecast
          </Link>
        }
      />
      {d.movers.length === 0 ? (
        <p className="t-caption py-6 text-center">There is no dispatch history yet to forecast from.</p>
      ) : (
        <ol className="m-0 grid list-none grid-cols-1 gap-x-8 p-0 min-[1100px]:grid-cols-2">
          {d.movers.map((m, i) => {
            const cover = m.cover;
            const tone: SignalTone = cover === null ? "neutral" : cover < 7 ? "bad" : cover < 14 ? "warn" : "ok";
            return (
              <li key={m.sku} className="border-b border-line-soft">
                <ForecastRow
                  rank={i + 1}
                  sku={m.sku}
                  title={m.title}
                  figure={formatNumber(Math.round(m.f30))}
                  rate={`${formatNumber(Math.round(m.rate))} a day`}
                  share={m.share}
                  chip={{ tone: tone === "neutral" ? "neutral" : tone, label: cover === null ? "No cover data" : cover <= 0 ? "Out of stock" : cover < 10 ? `${cover.toFixed(1)} days left` : `${formatNumber(Math.round(cover))} days left` }}
                />
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** Where the stock sits (one bar, a part per warehouse), then each warehouse's empty and low SKUs side by side. */
export function StockByWarehouse({ d }: { d: DeckData }) {
  const rows = d.whStock;
  const total = rows.reduce((n, r) => n + r.units, 0);
  const parts = rows.map((r) => ({ key: r.id, label: r.name, color: r.color }));
  return (
    <section className="sp-card g-pad span-6" aria-labelledby="whs-title">
      <SectionHead
        id="whs-title"
        title="Stock by warehouse"
        sub="Units in stock on active listings, and where SKUs are empty or low"
        action={
          rows.length ? (
            <p className="text-right">
              <CountUp value={total} className="t-stat" />
              <span className="t-caption ml-1.5">units</span>
            </p>
          ) : undefined
        }
      />
      {rows.length === 0 ? (
        <p className="t-caption py-8 text-center">Stock has not been read from Flipkart yet.</p>
      ) : (
        <div className="flex flex-col gap-6">
          <ShareBar
            parts={parts}
            values={Object.fromEntries(rows.map((r) => [r.id, r.units]))}
            unit="units"
            ariaLabel={`Units in stock by warehouse: ${rows.map((r) => `${r.name} ${formatNumber(r.units)}`).join(", ")}`}
          />
          <div className="border-t border-line-soft pt-4">
            <PairedRows
              rows={rows.map((r) => ({ key: r.id, label: r.name, color: r.color, values: { out: r.out, low: r.low } }))}
              measures={[
                { key: "out", label: "Empty (0 units)", color: COLOR.danger },
                { key: "low", label: "Low", color: COLOR.warn },
              ]}
              ariaLabel={`SKUs empty and low by warehouse: ${rows.map((r) => `${r.name} ${formatNumber(r.out)} empty, ${formatNumber(r.low)} low`).join("; ")}`}
            />
          </div>
        </div>
      )}
    </section>
  );
}

/** One forecast row: rank, SKU and title, the 30-day figure and rate, the share bar, and the days-of-cover chip. */
export function ForecastRow({
  rank,
  sku,
  title,
  figure,
  rate,
  share,
  chip,
}: {
  rank: number;
  sku: ReactNode;
  title?: ReactNode;
  figure: ReactNode;
  rate: ReactNode;
  share: number;
  chip: { tone: "ok" | "warn" | "bad" | "neutral"; label: string };
}) {
  return (
    <div className="grid grid-cols-[1.25rem_1fr_auto] items-center gap-x-3 gap-y-2 py-3">
      <span className="font-mono text-xs text-faint">{rank}</span>
      <span className="min-w-0">
        <span className="block truncate font-mono text-[13px] font-medium">{sku}</span>
        {title ? <span className="t-caption block truncate">{title}</span> : null}
      </span>
      <span className="text-right">
        <span className="block font-mono text-[13px] font-medium tabular-nums">{figure}</span>
        <span className="t-caption block">{rate}</span>
      </span>
      <span />
      <Bar share={share} tone="cyan" index={rank - 1} />
      <span className="text-right">
        <Chip tone={chip.tone}>{chip.label}</Chip>
      </span>
    </div>
  );
}

/** The whole Command Deck (glass-spec 8.1), in reading order on a 12-column grid. */
export function CommandDeck({ d, push }: { d: DeckData; push?: ReactNode }) {
  return (
    <div className="g-grid vr-stagger items-start">
      <DeckHeadline d={d} push={push} />
      <TodayHero d={d} />
      <LanesCard d={d} />
      <Pulses d={d} />
      <PriorityQueue d={d} />
      <OrdersTrend d={d} />
      <DispatchChart d={d} />
      <StockByWarehouse d={d} />
      <StockHealth d={d} />
      <Movers d={d} />
    </div>
  );
}
