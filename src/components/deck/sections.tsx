import Link from "next/link";
import type { ReactNode } from "react";
import { AreaChart, Bar, PairedRows, ShareBar, Sparkline, TrendChart } from "@/components/signal/charts";
import { CountUp } from "@/components/signal/count-up";
import { Lanes, type Lane } from "@/components/signal/lanes";
import { QueueList } from "@/components/deck/queue";
import { buttonClass, Chip, Headline, SectionHead, Stat, StatStrip, withNumbers } from "@/components/ui";
import type { QueueKind } from "@/lib/deck";
import { formatDate, formatNumber } from "@/lib/format";
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
 * The page header (graphite-spec 9.1): the title, the headline sentence as the subtitle with the reassurance under it,
 * the two places to go next on the right; the notes line and the push banner under it.
 */
export function DeckHeadline({ d, push }: { d: Pick<DeckData, "hero" | "notes">; push?: ReactNode }) {
  return (
    <DeckHeader push={push}>
      <HeadlineLines d={d} />
    </DeckHeader>
  );
}

/** The headline sentence, the reassurance line and any notes, under the title. */
export function HeadlineLines({ d }: { d: Pick<DeckData, "hero" | "notes"> }) {
  const { hero } = d;
  return (
    <>
      <Headline text={hero.headline} tone={hero.tone} className="mt-1" />
      <p className="t-caption mt-1">{withNumbers(hero.reassurance, "ink")}</p>
      {d.notes.length ? (
        <p role="status" className="t-caption mt-1">
          {d.notes.join(" ")}
        </p>
      ) : null}
    </>
  );
}

/** The header: the title and the two buttons, with the headline lines (`children`) under the title. */
export function DeckHeader({ children, push }: { children: ReactNode; push?: ReactNode }) {
  return (
    <header className="span-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 max-w-3xl">
          <h1 className="t-h1">Command Centre</h1>
          {children}
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

/** The deck's flow map rows: each warehouse's orders by stage, the late count, the next pickup, units out. */
function deckLanes(d: Pick<DeckData, "warehouses" | "whStages">): Lane[] {
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
      figure: { value: w.active, label: "active" },
      out: w.out,
      href: w.href,
    };
  });
}

const PULSE_TONE: Record<"bad" | "warn" | "cyan", "bad" | "warn" | "accent"> = { bad: "bad", warn: "warn", cyan: "accent" };

/**
 * The KPI row of four (graphite-spec 9.1): To dispatch today (the capacity sentence for the owner and admins, else "across
 * N warehouses"; the late Chip beside the label), then the three pulses with their sparklines and links.
 */
export function DeckKpis({ d }: { d: Pick<DeckData, "todayCard" | "pulses"> }) {
  return (
    <StatStrip ariaLabel="To dispatch today and today's signals" className="span-12">
      <TodayStat d={d} />
      <PulseStats d={d} />
    </StatStrip>
  );
}

/** The first KPI: To dispatch today. */
export function TodayStat({ d }: { d: Pick<DeckData, "todayCard"> }) {
  const t = d.todayCard;
  const cap = t?.capacity ?? null;
  const used = t && cap && cap.comfortable > 0 ? Math.round((t.due / cap.comfortable) * 100) : null;
  const tone = used === null ? null : used > 100 ? "bad" : used > 85 ? "warn" : "ok";
  const context = !t ? (
    "Orders have not been read from Flipkart yet. The day's number appears after the first read."
  ) : cap && used !== null ? (
    <span aria-label={`${used}% of the ${formatNumber(cap.comfortable)} orders the team packs comfortably in a day`}>
      <b className={`font-semibold ${tone === "ok" ? "text-ink" : tone === "warn" ? "text-warn" : "text-bad"}`}>{used}%</b> of what the team packs in a day · {formatNumber(cap.comfortable)} a day · {cap.staff}{" "}
      {cap.staff === 1 ? "person" : "people"}
    </span>
  ) : t.warehouses ? (
    `across ${t.warehouses} ${t.warehouses === 1 ? "warehouse" : "warehouses"}`
  ) : undefined;
  return (
    <Stat
        label="To dispatch today"
        kind="orders"
        value={t ? t.due : "—"}
        sub={context}
        aside={
          t && t.late > 0 ? (
            <Link prefetch={false} href="/flipkart?tab=orders&view=list" className="focus-ring rounded-[8px]">
              <Chip tone="bad" live>
                {formatNumber(t.late)} late
              </Chip>
            </Link>
          ) : undefined
        }
      />
  );
}

/** The other three KPIs: Late dispatch, Out of stock, Due tomorrow, with their sparklines. */
export function PulseStats({ d }: { d: Pick<DeckData, "pulses"> }) {
  return (
    <>
      {d.pulses.map((p) => (
        <Stat key={p.key} label={p.label} value={p.value} sub={p.sub} tone={PULSE_TONE[p.tone]} href={p.href} spark={{ values: p.spark, tone: p.tone, label: p.sparkLabel }} />
      ))}
    </>
  );
}

/** The flow map Card (graphite-spec 9.1, 8 cols): "Order flow map" with a Live pill. */
export function FlowCard({ d }: { d: Pick<DeckData, "warehouses" | "whStages"> }) {
  const lanes = deckLanes(d);
  return (
    <section className="sp-card g-pad span-8" aria-labelledby="lanes-title">
      <SectionHead
        id="lanes-title"
        title="Order flow map"
        sub="Every active order by warehouse and stage, as Seller Hub counts them. Tap a row for its orders."
        action={
          <Chip tone="ok">
            <span aria-hidden="true" className="vr-blink inline-block h-1.5 w-1.5 rounded-full bg-ok" />
            Live
          </Chip>
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

/**
 * Orders pulse (graphite-spec 9.1, right column): "N yesterday", orders placed per day for the last 14 full days with the
 * 7-day average, then Yesterday, 7-day avg and Busiest.
 */
export function OrdersPulse({ d }: { d: Pick<DeckData, "trend" | "todayCard"> }) {
  const pts = d.trend;
  const t = d.todayCard;
  const avg = t?.avg7 ?? null;
  const last = pts[pts.length - 1];
  const enough = pts.length >= 2 && pts.some((p) => p.orders > 0);
  const cell = (label: string, value: ReactNode, sub: ReactNode) => (
    <div className="min-w-0">
      <dt className="t-label truncate">{label}</dt>
      <dd className="m-0 mt-0.5 truncate font-display text-[18px] font-bold leading-6 tabular-nums text-ink">{value}</dd>
      {sub ? <dd className="m-0 mt-1 min-w-0">{sub}</dd> : null}
    </div>
  );
  return (
    <section className="sp-card g-pad" aria-labelledby="trend-title">
      <SectionHead id="trend-title" title="Orders pulse" sub={`Placed on Flipkart, last ${pts.length} days`} />
      {last ? (
        <p>
          <CountUp value={last.orders} className="t-stat" />
          <span className="t-caption ml-1.5">yesterday</span>
        </p>
      ) : null}
      {enough ? (
        <div className="mt-3">
          <TrendChart
            data={pts.map((p) => ({ label: p.label, value: p.orders }))}
            avg={avg}
            avgLabel={avg === null ? "" : `7-day avg ${formatNumber(avg)}`}
            ariaLabel={`Orders placed per day, last ${pts.length} days: ${pts.map((p) => `${p.label} ${formatNumber(p.orders)}`).join(", ")}`}
          />
        </div>
      ) : (
        <p className="t-caption py-10 text-center">The graph starts once a few days of orders are saved.</p>
      )}
      {t ? (
        <dl className="m-0 mt-4 grid grid-cols-3 gap-3 border-t border-line pt-4" aria-label="Yesterday, the 7-day average and the busiest warehouse">
          {cell("Yesterday", t.yesterday === null ? "—" : formatNumber(t.yesterday), <Delta pct={t.yesterdayChange} against="the day before" />)}
          {cell("7-day avg", t.avg7 === null ? "—" : formatNumber(t.avg7), <Delta pct={t.avg7Change} against="the week before" />)}
          {cell(
            "Busiest",
            t.busiest ? formatNumber(t.busiest.orders) : "—",
            t.busiest ? (
              <span className="t-caption flex min-w-0 items-center gap-1.5 font-semibold text-ink">
                <span aria-hidden="true" className="wh-dot" style={{ background: t.busiest.color, color: t.busiest.color }} />
                <span className="truncate">{t.busiest.name}</span>
              </span>
            ) : null,
          )}
        </dl>
      ) : null}
    </section>
  );
}

function CheckIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
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
  className,
  empty,
  shown,
  expand,
}: {
  id: string;
  title: string;
  sub: string;
  rows: DeckData["queue"];
  urgent: boolean;
  extra?: ReactNode;
  className: string;
  empty: string;
  shown: number;
  expand: "more" | "all";
}) {
  const clear = rows.length === 0;
  return (
    <section id={id} className={`sp-card g-pad scroll-mt-24 ${className}`} aria-labelledby={`${id}-title`}>
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
      {clear ? (
        <div className="flex flex-col items-center px-5 pb-8 pt-2 text-center">
          <CheckIcon className="h-8 w-8 text-faint" />
          <p className="t-card-title mt-3">All clear</p>
          <p className="t-caption mt-1 max-w-xs">{empty}</p>
        </div>
      ) : (
        <QueueList shown={shown} expand={expand} rows={rows.map((q) => ({ key: q.key, kind: q.kind, tag: q.tag, title: q.title, detail: q.detail, actions: q.actions }))} />
      )}
    </section>
  );
}

/** "Orders and stock" (graphite-spec 9.1, right column): the first 4 item rows, "View all" opens the rest in place. */
export function OrdersQueue({ d }: { d: Pick<DeckData, "queue"> }) {
  const orders = d.queue.filter((q) => ORDER_KINDS.includes(q.kind));
  return (
    <QueueCard
      id="queue"
      className=""
      title="Orders and stock"
      sub="Ranked: late first, then what is about to be"
      rows={orders}
      urgent={orders.some((q) => q.kind === "late" || q.kind === "overfill")}
      empty="No late orders, no orders without stock and nothing dry."
      shown={4}
      expand="all"
    />
  );
}

/** "Work and tickets" (graphite-spec 9.1, 4 cols), with the "N open tickets" pill in its header. */
export function WorkQueue({ d }: { d: Pick<DeckData, "queue"> & { kpis: Pick<DeckData["kpis"], "openTickets"> } }) {
  const work = d.queue.filter((q) => WORK_KINDS.includes(q.kind));
  return (
    <QueueCard
      id="queue-work"
      className="span-4"
      title="Work and tickets"
      sub="Work waiting for you and ticket follow-ups due"
      rows={work}
      urgent={false}
      extra={
        <Link prefetch={false} href="/tickets" className="focus-ring rounded-[8px]">
          <Chip tone="accent">{formatNumber(d.kpis.openTickets)} open tickets</Chip>
        </Link>
      }
      empty="No follow-ups due and no work waiting for you."
      shown={6}
      expand="more"
    />
  );
}

export function DispatchChart({ d }: { d: Pick<DeckData, "dispatch"> }) {
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
              <span className="t-caption block tabular-nums">{formatNumber(x.avg)} a day on average</span>
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

/** One Stock health row: the Label (with its line under it) left, the number right, a 72px sparkline; a link. */
function HealthRow({ label, value, sub, tone, spark, href }: { label: string; value: number; sub: string; tone: SignalTone; spark?: { values: number[]; label: string }; href: string }) {
  const color = tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "text-ink";
  return (
    <li>
      <Link prefetch={false} href={href} className="focus-ring flex min-h-[52px] items-center gap-3 rounded-[12px] px-2 py-2 transition-colors duration-160 hover:bg-panel2">
        <span className="min-w-0 flex-1">
          <span className="t-label block truncate">{label}</span>
          <span className="t-caption block truncate">{sub}</span>
        </span>
        <span className={`shrink-0 font-display text-[18px] font-bold leading-6 tabular-nums ${color}`}>{formatNumber(value)}</span>
        <span className="w-[72px] shrink-0">{spark && spark.values.length > 1 ? <Sparkline values={spark.values} tone={tone} label={spark.label} className="kpi-spark" /> : null}</span>
      </Link>
    </li>
  );
}

/** Stock at a glance (graphite-spec 9.1, 4 cols): five list rows, each a link to the list behind it. */
export function StockHealth({ d }: { d: Pick<DeckData, "kpis" | "today"> }) {
  const k = d.kpis;
  const delta = k.unitsChange;
  return (
    <section className="sp-card g-pad span-4" aria-labelledby="stock-title">
      <SectionHead id="stock-title" title="Stock health" sub={k.snapshot ? `From the stock read of ${formatDate(k.snapshot, d.today)}` : undefined} />
      <ul className="m-0 flex list-none flex-col divide-y divide-line-soft p-0">
        <HealthRow
          label="Units in stock"
          value={k.units ?? 0}
          tone="cyan"
          sub={delta === null ? "active listings" : delta === 0 ? "no change since last reading" : `${delta > 0 ? "+" : "−"}${formatNumber(Math.abs(delta))} since last reading`}
          spark={{ values: k.stockSeries.units, label: "Units in stock at each stock reading" }}
          href="/flipkart?tab=stock"
        />
        <HealthRow label="Low stock" value={k.low ?? 0} tone={(k.low ?? 0) > 0 ? "warn" : "ok"} sub="in stock, but low at a warehouse" spark={{ values: k.stockSeries.low, label: "Low-stock SKUs at each stock reading" }} href="/flipkart?tab=stock&view=low&hide=1" />
        <HealthRow label="Out of stock" value={k.out ?? 0} tone={(k.out ?? 0) > 0 ? "bad" : "ok"} sub="active, no units anywhere" spark={{ values: k.stockSeries.out, label: "Out-of-stock SKUs at each stock reading" }} href="/flipkart?tab=stock&view=out&hide=1" />
        <HealthRow label="Open tickets" value={k.openTickets} tone="accent" sub="open or waiting" spark={{ values: k.ticketSeries, label: "Tickets raised per day, last 14 days" }} href="/tickets" />
        <HealthRow label="Weight alerts" value={k.weight ?? 0} tone={(k.weight ?? 0) > 0 ? "warn" : "ok"} sub="over the size and weight limit" href="/flipkart?tab=stock&view=weight&hide=1" />
      </ul>
    </section>
  );
}

export function Movers({ d }: { d: Pick<DeckData, "movers" | "moversDays"> }) {
  return (
    <section className="sp-card g-pad span-7" aria-labelledby="mov-title">
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
        <ol className="m-0 grid list-none grid-cols-1 p-0">
          {d.movers.map((m, i) => {
            const cover = m.cover;
            const tone: SignalTone = cover === null ? "neutral" : cover < 7 ? "bad" : cover < 14 ? "warn" : "ok";
            return (
              <li key={m.sku} className="border-b border-line-soft last:border-b-0">
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
export function StockByWarehouse({ d }: { d: Pick<DeckData, "whStock"> }) {
  const rows = d.whStock;
  const total = rows.reduce((n, r) => n + r.units, 0);
  const parts = rows.map((r) => ({ key: r.id, label: r.name, color: r.color }));
  return (
    <section className="sp-card g-pad span-4" aria-labelledby="whs-title">
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
      <span className="text-xs tabular-nums text-faint">{rank}</span>
      <span className="min-w-0">
        <span className="block truncate font-mono text-[13px] font-medium">{sku}</span>
        {title ? <span className="t-caption block truncate">{title}</span> : null}
      </span>
      <span className="text-right">
        <span className="block text-[13px] font-medium tabular-nums">{figure}</span>
        <span className="t-caption block">{rate}</span>
      </span>
      <span />
      <Bar share={share} tone="accent" index={rank - 1} />
      <span className="text-right">
        <Chip tone={chip.tone}>{chip.label}</Chip>
      </span>
    </div>
  );
}

/** The whole Command Centre (graphite-spec 9.1), in reading order on a 12-column grid. */
export function CommandDeck({ d, push }: { d: DeckData; push?: ReactNode }) {
  return (
    <div className="g-grid vr-stagger items-start">
      <DeckHeadline d={d} push={push} />
      <DeckKpis d={d} />
      <FlowCard d={d} />
      <div className="span-4 flex min-w-0 flex-col gap-[14px]">
        <OrdersQueue d={d} />
        <OrdersPulse d={d} />
      </div>
      <WorkQueue d={d} />
      <StockByWarehouse d={d} />
      <StockHealth d={d} />
      <DispatchChart d={d} />
      <Movers d={d} />
    </div>
  );
}
