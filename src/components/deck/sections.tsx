import Link from "next/link";
import { AreaChart, Bar, PairedRows, ShareBar, Sparkline, TrendChart } from "@/components/signal/charts";
import { CountUp } from "@/components/signal/count-up";
import { Lanes, type Lane } from "@/components/signal/lanes";
import { QueueList } from "@/components/deck/queue";
import { buttonClass, Chip, Headline, SectionHead, Stat, StatStrip, withNumbers } from "@/components/ui";
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
export function DeckHeadline({ d }: { d: DeckData }) {
  const { hero } = d;
  const time = formatDateTime(d.nowIso).replace(/^Today /, "");
  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0 max-w-3xl">
        <p className="text-xs font-medium text-muted">
          Operations · {formatDate(d.today)} · {time}
        </p>
        <Headline text={hero.headline} tone={hero.tone} className={`mt-2 ${hero.tone === "ok" ? "text-ok" : ""}`} />
        <p className="mt-2 text-sm text-muted sm:text-[15px]">{withNumbers(hero.reassurance, "ink")}</p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <a href="#queue" className={buttonClass("primary")}>
          Open priority queue
        </a>
        <Link prefetch={false} href="/flipkart" className={buttonClass("outline")}>
          Jump to Flipkart
        </Link>
      </div>
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
export function DispatchBoard({ d }: { d: DeckData }) {
  const t = d.todayCard;
  const cap = t?.capacity ?? null;
  const used = t && cap && cap.comfortable > 0 ? Math.round((t.due / cap.comfortable) * 100) : null;
  const tone = used === null ? null : used > 100 ? "bad" : used > 85 ? "warn" : "ok";
  const lanes = deckLanes(d);
  const active = d.whStages.reduce((n, r) => n + r.to_accept + r.to_pack + r.to_dispatch, 0);
  return (
    <section className="sp-card sp-card-lg grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(17rem,2fr)_3fr] lg:gap-10" aria-labelledby="today-title">
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-2">
          <h2 id="today-title" className="text-sm font-medium text-muted">
            To dispatch today
          </h2>
          {t && t.late > 0 ? (
            <Link prefetch={false} href="/flipkart?tab=orders&view=list" className="focus-ring rounded-full">
              <Chip tone="bad">{formatNumber(t.late)} late</Chip>
            </Link>
          ) : null}
        </div>
        {t ? (
          <>
            <p className="mt-2">
              <CountUp value={t.due} className="display-num block text-[4.25rem] text-ink sm:text-[5.5rem]" />
            </p>
            <p className="mt-2 text-sm text-muted">
              orders still to go out today{t.warehouses ? ` across ${t.warehouses} ${t.warehouses === 1 ? "warehouse" : "warehouses"}` : ""}
            </p>
            {cap && used !== null ? (
              <div className="mt-5">
                <div className="h-2 overflow-hidden rounded-full bg-surface2" role="img" aria-label={`${used}% of the ${formatNumber(cap.comfortable)} orders the team packs comfortably in a day`}>
                  <div className="sp-bar h-full rounded-full" style={{ width: `${Math.min(100, used)}%`, background: tone === "ok" ? "var(--accent)" : tone === "warn" ? "var(--warn-mark)" : "var(--bad)" }} />
                </div>
                <p className="mt-2 flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-muted">
                  <span>
                    <b className={`font-mono font-semibold ${tone === "ok" ? "text-ink" : tone === "warn" ? "text-warn" : "text-bad"}`}>{used}%</b> of what the team packs in a day
                  </span>
                  <span className="font-mono tabular-nums">
                    {formatNumber(cap.comfortable)} a day · {cap.staff} {cap.staff === 1 ? "person" : "people"}
                  </span>
                </p>
              </div>
            ) : null}
            <StatStrip className="mt-6 !grid-cols-3" ariaLabel="Yesterday, the 7-day average and the busiest warehouse">
              <Stat label="Yesterday" value={t.yesterday === null ? "—" : formatNumber(t.yesterday)} sub={<Delta pct={t.yesterdayChange} against="the day before" />} />
              <Stat label="7-day avg" value={t.avg7 === null ? "—" : formatNumber(t.avg7)} sub={<Delta pct={t.avg7Change} against="the week before" />} />
              <Stat
                label="Busiest"
                value={t.busiest ? formatNumber(t.busiest.orders) : "—"}
                sub={
                  t.busiest ? (
                    <span className="flex min-w-0 items-center gap-1.5 font-semibold text-ink">
                      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: t.busiest.color }} />
                      <span className="truncate">{t.busiest.name}</span>
                    </span>
                  ) : undefined
                }
              />
            </StatStrip>
          </>
        ) : (
          <p className="mt-3 text-sm text-muted">Orders have not been read from Flipkart yet. The day&apos;s number appears after the first read.</p>
        )}
      </div>
      <div className="min-w-0 lg:border-l lg:border-line lg:pl-10">
        <SectionHead
          title="Where the orders are"
          sub="Every active order by warehouse and stage, as Seller Hub counts them. Tap a lane for its orders."
          action={
            <p className="text-right">
              <span className="font-mono text-2xl font-semibold tabular-nums">{formatNumber(active)}</span>
              <span className="ml-1.5 text-xs text-muted">active</span>
            </p>
          }
        />
        {lanes.length === 0 ? (
          <p className="py-8 text-sm text-muted">No warehouse is set up for you yet.</p>
        ) : (
          <Lanes lanes={lanes} ariaLabel={`Active orders by warehouse and stage: ${d.whStages.map((r) => `${r.name}: ${r.to_accept} to accept, ${r.to_pack} to pack, ${r.to_dispatch} to dispatch`).join("; ")}`} />
        )}
      </div>
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
    <section className="sp-card p-5" aria-labelledby="trend-title">
      <SectionHead
        id="trend-title"
        title="Orders a day"
        sub={`Placed on Flipkart, last ${pts.length} days`}
        action={
          last ? (
            <p className="text-right">
              <span className="font-mono text-2xl font-semibold tabular-nums">{formatNumber(last.orders)}</span>
              <span className="ml-1.5 text-xs text-muted">yesterday</span>
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
        <p className="py-10 text-center text-sm text-muted">The graph starts once a few days of orders are saved.</p>
      )}
    </section>
  );
}

const PULSE_TONE: Record<"bad" | "warn" | "cyan", "bad" | "warn" | "accent"> = { bad: "bad", warn: "warn", cyan: "accent" };

/** The three signals of the day as a strip: each a link, with its trend under the number. */
export function Pulses({ d }: { d: DeckData }) {
  if (!d.pulses.length) return null;
  return (
    <StatStrip ariaLabel="Today's signals">
      {d.pulses.map((p) => (
        <Stat
          key={p.key}
          label={p.label}
          value={<CountUp value={p.value} />}
          sub={p.sub}
          tone={PULSE_TONE[p.tone]}
          href={p.href}
          size="lg"
          chart={<Sparkline values={p.spark} tone={p.tone} label={p.sparkLabel} className="h-8 w-full max-w-[12rem]" />}
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

export function PriorityQueue({ d }: { d: DeckData }) {
  const clear = d.queue.length === 0;
  return (
    <section id="queue" className="sp-card scroll-mt-24 overflow-hidden" aria-labelledby="queue-title">
      <SectionHead
        id="queue-title"
        className="!mb-0 px-4 pb-3 pt-4"
        title="Priority queue"
        sub="Ranked: late first, then what is about to be"
        action={clear ? <Chip tone="ok">All clear</Chip> : <Chip tone={d.urgent > 0 ? "bad" : "neutral"}>{formatNumber(d.queue.length)} to do</Chip>}
      />
      {clear ? (
        <div className="flex flex-col items-center px-5 pb-10 pt-6 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-ok-soft text-ok">
            <CheckIcon className="h-7 w-7" />
          </span>
          <p className="mt-3 text-base font-semibold">Queue is clear</p>
          <p className="mt-1 max-w-xs text-sm text-muted">No late orders, nothing dry, no follow-ups due and no work waiting for you.</p>
        </div>
      ) : (
        <div className="border-t border-line-soft">
          <QueueList rows={d.queue.map((q) => ({ key: q.key, kind: q.kind, tag: q.tag, title: q.title, detail: q.detail, actions: q.actions }))} />
        </div>
      )}
    </section>
  );
}

export function DispatchChart({ d }: { d: DeckData }) {
  const x = d.dispatch;
  return (
    <section className="sp-card p-5" aria-labelledby="disp-title">
      <SectionHead
        id="disp-title"
        title="Dispatch, last 7 days"
        sub="Units dispatched per day"
        action={
          x ? (
            <p className="text-right">
              <CountUp value={x.total} className="text-2xl font-semibold" />
              <span className="ml-1.5 text-xs text-muted">units</span>
              <span className="block font-mono text-xs text-muted">{formatNumber(x.avg)} a day on average</span>
            </p>
          ) : undefined
        }
      />
      {x && x.total > 0 ? (
        <AreaChart data={x.points} ariaLabel={`Units dispatched per day, last 7 days: ${x.points.map((p) => `${p.label} ${formatNumber(p.value)}`).join(", ")}`} formatY={(n) => (n >= 1000 ? `${formatNumber(Math.round(n / 100) / 10)}k` : formatNumber(Math.round(n)))} />
      ) : (
        <p className="py-10 text-center text-sm text-muted">No dispatches are saved for the last 7 days yet.</p>
      )}
    </section>
  );
}

/** Stock at a glance: five figures with their trend, each a link to the list behind it. */
export function StockHealth({ d }: { d: DeckData }) {
  const k = d.kpis;
  const delta = k.unitsChange;
  return (
    <section aria-labelledby="stock-title">
      <SectionHead id="stock-title" title="Stock health" sub={k.snapshot ? `From the stock read of ${formatDate(k.snapshot, d.today)}` : undefined} />
      <StatStrip>
        <Stat
          label="Units in stock"
          value={<CountUp value={k.units ?? 0} />}
          sub={delta === null ? "active listings" : delta === 0 ? "no change since last reading" : `${delta > 0 ? "+" : "−"}${formatNumber(Math.abs(delta))} since last reading`}
          chart={<Sparkline values={k.stockSeries.units} tone="cyan" label="Units in stock at each stock reading" className="h-7 w-full max-w-[10rem]" />}
          href="/flipkart?tab=stock"
        />
        <Stat label="Low stock" value={<CountUp value={k.low ?? 0} />} tone={(k.low ?? 0) > 0 ? "warn" : "ok"} sub="in stock, but low at a warehouse" chart={<Sparkline values={k.stockSeries.low} tone="warn" label="Low-stock SKUs at each stock reading" className="h-7 w-full max-w-[10rem]" />} href="/flipkart?tab=stock&view=low&hide=1" />
        <Stat label="Out of stock" value={<CountUp value={k.out ?? 0} />} tone={(k.out ?? 0) > 0 ? "bad" : "ok"} sub="active, no units anywhere" chart={<Sparkline values={k.stockSeries.out} tone="bad" label="Out-of-stock SKUs at each stock reading" className="h-7 w-full max-w-[10rem]" />} href="/flipkart?tab=stock&view=out&hide=1" />
        <Stat label="Open tickets" value={<CountUp value={k.openTickets} />} tone="accent" sub="open or waiting" chart={<Sparkline values={k.ticketSeries} tone="accent" label="Tickets raised per day, last 14 days" className="h-7 w-full max-w-[10rem]" />} href="/tickets" />
        <Stat label="Weight alerts" value={<CountUp value={k.weight ?? 0} />} tone={(k.weight ?? 0) > 0 ? "warn" : "ok"} sub="over the size and weight limit" href="/flipkart?tab=stock&view=weight&hide=1" />
      </StatStrip>
    </section>
  );
}

export function Movers({ d }: { d: DeckData }) {
  return (
    <section className="sp-card p-5" aria-labelledby="mov-title">
      <SectionHead
        id="mov-title"
        title="Forecast, top movers"
        sub={`Next 30 days, from ${formatNumber(d.moversDays)} days of dispatches`}
        action={
          <Link prefetch={false} href="/flipkart?tab=forecast" className="focus-ring inline-flex min-h-9 items-center rounded-md px-2 text-sm font-semibold text-accent-text hover:bg-accent-soft">
            Full forecast
          </Link>
        }
      />
      {d.movers.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">There is no dispatch history yet to forecast from.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-line-soft">
          {d.movers.map((m, i) => {
            const cover = m.cover;
            const tone: SignalTone = cover === null ? "neutral" : cover < 7 ? "bad" : cover < 14 ? "warn" : "ok";
            return (
              <li key={m.sku} className="grid grid-cols-[1.25rem_1fr_auto] items-center gap-x-3 gap-y-1.5 py-3">
                <span className="font-mono text-xs text-faint">{i + 1}</span>
                <span className="min-w-0">
                  <span className="block truncate font-mono text-[13px] font-semibold">{m.sku}</span>
                  {m.title ? <span className="block truncate text-xs text-muted">{m.title}</span> : null}
                </span>
                <span className="text-right">
                  <span className="block font-mono text-sm font-semibold tabular-nums">{formatNumber(Math.round(m.f30))}</span>
                  <span className="block text-[11px] text-muted">{formatNumber(Math.round(m.rate))} a day</span>
                </span>
                <span />
                <Bar share={m.share} tone="cyan" index={i} />
                <span className="text-right">
                  <Chip tone={tone === "neutral" ? "neutral" : tone}>
                    {cover === null ? "No cover data" : cover <= 0 ? "Out of stock" : cover < 10 ? `${cover.toFixed(1)} days left` : `${formatNumber(Math.round(cover))} days left`}
                  </Chip>
                </span>
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
    <section className="sp-card p-5" aria-labelledby="whs-title">
      <SectionHead
        id="whs-title"
        title="Stock by warehouse"
        sub="Units in stock on active listings, and where SKUs are empty or low"
        action={
          rows.length ? (
            <p className="text-right">
              <span className="font-mono text-2xl font-semibold tabular-nums">{formatNumber(total)}</span>
              <span className="ml-1.5 text-xs text-muted">units</span>
            </p>
          ) : undefined
        }
      />
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">Stock has not been read from Flipkart yet.</p>
      ) : (
        <div className="flex flex-col gap-6">
          <ShareBar
            parts={parts}
            values={Object.fromEntries(rows.map((r) => [r.id, r.units]))}
            unit="units"
            ariaLabel={`Units in stock by warehouse: ${rows.map((r) => `${r.name} ${formatNumber(r.units)}`).join(", ")}`}
          />
          <div className="bp-rule pt-4">
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

/** The whole Command Deck, in reading order: the sentence, the board, the signals, the queue, then the detail. */
export function CommandDeck({ d }: { d: DeckData }) {
  return (
    <div className="flex flex-col gap-6">
      <DeckHeadline d={d} />
      {d.notes.length ? (
        <p role="status" className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-muted">
          {d.notes.join(" ")}
        </p>
      ) : null}
      <DispatchBoard d={d} />
      <Pulses d={d} />
      <div className="grid items-start gap-6 lg:grid-cols-[3fr_2fr]">
        <PriorityQueue d={d} />
        <OrdersTrend d={d} />
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <StockByWarehouse d={d} />
        <DispatchChart d={d} />
      </div>
      <StockHealth d={d} />
      <Movers d={d} />
    </div>
  );
}
