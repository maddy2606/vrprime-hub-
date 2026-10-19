import Link from "next/link";
import { Bar, AreaChart, Gauge, PairedRows, ShareBar, StackedRows, TrendChart } from "@/components/signal/charts";
import { CountUp } from "@/components/signal/count-up";
import { KpiTile } from "@/components/signal/kpi";
import { Sparkline } from "@/components/signal/charts";
import { QueueList } from "@/components/deck/queue";
import { buttonClass, Chip } from "@/components/ui";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { COLOR, STAGE_COLOR, type SignalTone } from "@/lib/theme";
import type { DeckData } from "@/server/deck-data";

const style = (i: number) => ({ ["--i" as string]: i });

function CheckIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

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

function TodayStat({ label, value, change, against }: { label: string; value: number | null; change: number | null; against: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-bold uppercase tracking-wider text-muted">{label}</dt>
      <dd className="mt-1 font-mono text-xl font-bold leading-none tabular-nums sm:text-2xl">{value === null ? "—" : formatNumber(value)}</dd>
      <dd className="mt-2 min-h-5">
        <Delta pct={change} against={against} />
      </dd>
    </div>
  );
}

/**
 * The top card: orders still to go out today, how full that makes the team's day, and yesterday, the 7-day average and the
 * busiest warehouse underneath. The capacity bar is for the owner and admins (they can see the team).
 */
export function TodayDispatch({ d }: { d: DeckData }) {
  const t = d.todayCard;
  if (!t) return null;
  const cap = t.capacity;
  const used = cap && cap.comfortable > 0 ? Math.round((t.due / cap.comfortable) * 100) : null;
  const tone = used === null ? null : used > 100 ? "bad" : used > 85 ? "warn" : "ok";
  return (
    <section className="sp-card sp-card-lg sp-reveal relative overflow-hidden p-5 sm:p-6" style={style(0)} aria-labelledby="today-title">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full"
        style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--accent) 28%, transparent), transparent 68%)" }}
      />
      <div className="relative">
        <div className="flex items-center justify-between gap-2">
          <h2 id="today-title" className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
            Today · to dispatch
          </h2>
          {t.late > 0 ? (
            <Link prefetch={false} href="/flipkart?tab=orders&view=list" className="focus-ring rounded-full">
              <Chip tone="bad">{formatNumber(t.late)} late</Chip>
            </Link>
          ) : null}
        </div>
        <p className="mt-3 bg-clip-text text-transparent" style={{ backgroundImage: "linear-gradient(100deg, var(--accent-text), var(--madder))" }}>
          <CountUp value={t.due} className="text-[3.6rem] font-bold leading-none tracking-tight sm:text-7xl" />
        </p>
        <p className="mt-2 text-sm text-muted">
          orders still to go out today
          {t.warehouses ? ` across ${t.warehouses} ${t.warehouses === 1 ? "warehouse" : "warehouses"}` : ""}
        </p>
        {cap && used !== null ? (
          <div className="mt-5">
            <div className="h-2.5 overflow-hidden rounded-full bg-surface2" role="img" aria-label={`${used}% of the ${formatNumber(cap.comfortable)} orders the team packs comfortably in a day`}>
              <div
                className="sp-bar h-full rounded-full"
                style={{ width: `${Math.min(100, used)}%`, background: tone === "ok" ? "linear-gradient(90deg, var(--accent), var(--madder))" : tone === "warn" ? "var(--warn-mark)" : "var(--bad)" }}
              />
            </div>
            <p className="mt-2 flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-muted">
              <span>
                <b className={`font-bold ${tone === "ok" ? "text-ink" : tone === "warn" ? "text-warn" : "text-bad"}`}>{used}%</b> of what the team packs in a day
              </span>
              <span className="font-mono tabular-nums">
                {formatNumber(cap.comfortable)} a day · {cap.staff} {cap.staff === 1 ? "person" : "people"}
              </span>
            </p>
          </div>
        ) : null}
        <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-line pt-4">
          <TodayStat label="Yesterday" value={t.yesterday} change={t.yesterdayChange} against="the day before" />
          <TodayStat label="7-day avg" value={t.avg7} change={t.avg7Change} against="the week before" />
          <div className="min-w-0">
            <dt className="text-[11px] font-bold uppercase tracking-wider text-muted">Busiest</dt>
            <dd className="mt-1 font-mono text-xl font-bold leading-none tabular-nums sm:text-2xl">{t.busiest ? formatNumber(t.busiest.orders) : "—"}</dd>
            {t.busiest ? (
              <dd className="mt-2 flex min-w-0 items-center gap-1.5 text-xs font-bold">
                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.busiest.color }} />
                <span className="truncate">{t.busiest.name}</span>
              </dd>
            ) : null}
          </div>
        </dl>
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
    <section className="sp-card sp-card-lg sp-reveal p-5 sm:p-6" style={style(1)} aria-labelledby="trend-title">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="trend-title" className="font-display text-lg font-semibold">
            Orders a day
          </h2>
          <p className="text-xs text-muted">Placed on Flipkart, last {pts.length} days</p>
        </div>
        {last ? (
          <p className="text-right">
            <span className="font-mono text-2xl font-bold tabular-nums">{formatNumber(last.orders)}</span>
            <span className="ml-1.5 text-xs text-muted">yesterday</span>
          </p>
        ) : null}
      </header>
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

/** The hero's printed band: the state of the day, in its status colour, across the top of the card. */
const HERO_BAND: Record<"bad" | "warn" | "ok", string> = { bad: "var(--bad)", warn: "var(--warn)", ok: "var(--ok)" };

export function Hero({ d }: { d: DeckData }) {
  const { hero } = d;
  const time = formatDateTime(d.nowIso).replace(/^Today /, "");
  return (
    <section className="sp-card sp-card-lg sp-reveal relative overflow-hidden border-t-[5px] p-5 sm:p-7" style={{ ...style(0), borderTopColor: HERO_BAND[hero.tone] }} aria-labelledby="deck-headline">
      <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
        Operations · {formatDate(d.today)} · {time}
      </p>
      <h1 id="deck-headline" className="font-display mt-3 flex items-start gap-3 text-[1.75rem] font-semibold leading-[1.15] tracking-tight sm:text-4xl">
        {hero.tone === "ok" ? (
          <span aria-hidden="true" className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ok-soft text-ok sm:h-11 sm:w-11">
            <CheckIcon />
          </span>
        ) : null}
        <span className={hero.tone === "ok" ? "text-ok" : ""}>{hero.headline}</span>
      </h1>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted sm:text-base">{hero.reassurance}</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <a href="#queue" className={buttonClass("primary", "px-5")}>
          Open priority queue
        </a>
        <Link prefetch={false} href="/flipkart" className={buttonClass("outline", "px-5")}>
          Jump to Flipkart
        </Link>
      </div>
    </section>
  );
}

const PULSE_TEXT: Record<"bad" | "warn" | "cyan", string> = { bad: "text-bad", warn: "text-warn", cyan: "text-cyan" };

export function Pulses({ d }: { d: DeckData }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
      {d.pulses.map((p, i) => (
        <Link
          key={p.key}
          prefetch={false}
          href={p.href}
          className="sp-card sp-lift sp-reveal focus-ring flex min-w-0 items-center justify-between gap-3 p-4"
          style={style(i + 1)}
        >
          <span className="min-w-0">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-muted">{p.label}</span>
            <CountUp value={p.value} className={`mt-1 block text-3xl font-bold leading-none ${PULSE_TEXT[p.tone]}`} />
            <span className="mt-1.5 block truncate text-xs text-muted">{p.sub}</span>
          </span>
          <span className="w-24 shrink-0 sm:w-20 lg:w-28">
            <Sparkline values={p.spark} tone={p.tone} label={p.sparkLabel} className="h-10 w-full" />
          </span>
        </Link>
      ))}
    </div>
  );
}

export function PriorityQueue({ d }: { d: DeckData }) {
  const clear = d.queue.length === 0;
  return (
    <section id="queue" className="sp-card sp-reveal scroll-mt-24 overflow-hidden" style={style(4)} aria-labelledby="queue-title">
      <header className="flex items-center justify-between gap-3 px-4 pb-3 pt-4">
        <h2 id="queue-title" className="font-display text-lg font-semibold">
          Priority queue
        </h2>
        {clear ? <Chip tone="ok">All clear</Chip> : <Chip tone={d.urgent > 0 ? "bad" : "neutral"}>{formatNumber(d.queue.length)} to do</Chip>}
      </header>
      {clear ? (
        <div className="flex flex-col items-center px-5 pb-10 pt-6 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-ok-soft text-ok">
            <CheckIcon className="h-7 w-7" />
          </span>
          <p className="mt-3 text-base font-bold">Queue is clear</p>
          <p className="mt-1 max-w-xs text-sm text-muted">No late orders, nothing dry, no follow-ups due and no work waiting for you.</p>
        </div>
      ) : (
        <QueueList rows={d.queue.map((q) => ({ key: q.key, kind: q.kind, tag: q.tag, title: q.title, detail: q.detail, actions: q.actions }))} />
      )}
    </section>
  );
}

export function Warehouses({ d }: { d: DeckData }) {
  return (
    <section className="sp-card sp-reveal overflow-hidden" style={style(5)} aria-labelledby="wh-title">
      <header className="flex items-center justify-between px-4 pb-2 pt-4">
        <h2 id="wh-title" className="font-display text-lg font-semibold">
          Warehouses
        </h2>
        <span className="text-xs text-muted">On-time health</span>
      </header>
      {d.warehouses.length === 0 ? (
        <p className="px-4 pb-6 pt-2 text-sm text-muted">No warehouse is set up for you yet.</p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {d.warehouses.map((w) => (
            <li key={w.id}>
              <Link prefetch={false} href={w.href} className="focus-ring flex min-h-[4.5rem] items-center gap-3 px-4 py-3 transition hover:bg-surface2/60">
                <Gauge pct={w.health.pct} tone={w.health.tone} label={`${w.name} on-time health ${w.health.pct} percent`} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: w.color }} />
                    <span className="truncate text-sm font-bold">{w.name}</span>
                    <Chip tone={w.health.chip.tone}>{w.health.chip.label}</Chip>
                  </span>
                  <span className="mt-1 block truncate text-xs text-muted">{w.next ? `Next dispatch ${w.next}` : "No orders waiting"}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-mono text-lg font-bold tabular-nums">{formatNumber(w.active)}</span>
                  <span className="block text-[11px] text-muted">{w.out === null ? "active orders" : `active · ${formatNumber(w.out)} out`}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function DispatchChart({ d }: { d: DeckData }) {
  const x = d.dispatch;
  return (
    <section className="sp-card sp-reveal p-4 sm:p-5" style={style(6)} aria-labelledby="disp-title">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="disp-title" className="font-display text-lg font-semibold">
            Dispatch, last 7 days
          </h2>
          <p className="text-xs text-muted">Units dispatched per day</p>
        </div>
        {x ? (
          <p className="text-right">
            <CountUp value={x.total} className="text-2xl font-bold text-cyan" />
            <span className="ml-1.5 text-xs text-muted">units</span>
            <span className="block font-mono text-xs text-muted">{formatNumber(x.avg)} a day on average</span>
          </p>
        ) : null}
      </header>
      {x && x.total > 0 ? (
        <AreaChart data={x.points} ariaLabel={`Units dispatched per day, last 7 days: ${x.points.map((p) => `${p.label} ${formatNumber(p.value)}`).join(", ")}`} formatY={(n) => (n >= 1000 ? `${formatNumber(Math.round(n / 100) / 10)}k` : formatNumber(Math.round(n)))} />
      ) : (
        <p className="py-10 text-center text-sm text-muted">No dispatches are saved for the last 7 days yet.</p>
      )}
    </section>
  );
}

export function StockHealth({ d }: { d: DeckData }) {
  const k = d.kpis;
  const delta = k.unitsChange;
  return (
    <section aria-labelledby="stock-title">
      <h2 id="stock-title" className="font-display mb-3 text-lg font-semibold">
        Stock health
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiTile
          index={7}
          label="Units in stock"
          value={k.units ?? 0}
          tone="neutral"
          sparkTone="cyan"
          sub={delta === null ? "active listings" : delta === 0 ? "no change since last reading" : `${delta > 0 ? "+" : "−"}${formatNumber(Math.abs(delta))} since last reading`}
          spark={k.stockSeries.units}
          sparkLabel="Units in stock at each stock reading"
          href="/flipkart?tab=stock"
        />
        <KpiTile index={8} label="Low stock" value={k.low ?? 0} tone={(k.low ?? 0) > 0 ? "warn" : "ok"} sub="in stock, but low at a warehouse" spark={k.stockSeries.low} sparkLabel="Low-stock SKUs at each stock reading" href="/flipkart?tab=stock&view=low&hide=1" />
        <KpiTile index={9} label="Out of stock" value={k.out ?? 0} tone={(k.out ?? 0) > 0 ? "bad" : "ok"} sub="active, no units anywhere" spark={k.stockSeries.out} sparkLabel="Out-of-stock SKUs at each stock reading" href="/flipkart?tab=stock&view=out&hide=1" />
        <KpiTile index={10} label="Open tickets" value={k.openTickets} tone="accent" sparkTone="accent" sub="open or waiting" spark={k.ticketSeries} sparkLabel="Tickets raised per day, last 14 days" href="/tickets" />
        <div className="col-span-2 sm:col-span-1">
          <KpiTile index={11} label="Weight alerts" value={k.weight ?? 0} tone={(k.weight ?? 0) > 0 ? "warn" : "ok"} sub="over the size and weight limit" href="/flipkart?tab=stock&view=weight&hide=1" />
        </div>
      </div>
    </section>
  );
}

export function Movers({ d }: { d: DeckData }) {
  return (
    <section className="sp-card sp-reveal p-4 sm:p-5" style={style(12)} aria-labelledby="mov-title">
      <header className="mb-3 flex items-end justify-between gap-2">
        <div>
          <h2 id="mov-title" className="font-display text-lg font-semibold">
            Forecast, top movers
          </h2>
          <p className="text-xs text-muted">Next 30 days, from {formatNumber(d.moversDays)} days of dispatches</p>
        </div>
        <Link prefetch={false} href="/flipkart?tab=forecast" className="focus-ring inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-bold text-accent-text hover:bg-accent-soft">
          Full forecast →
        </Link>
      </header>
      {d.movers.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">There is no dispatch history yet to forecast from.</p>
      ) : (
        <ol className="flex flex-col gap-4">
          {d.movers.map((m, i) => {
            const cover = m.cover;
            const tone: SignalTone = cover === null ? "neutral" : cover < 7 ? "bad" : cover < 14 ? "warn" : "ok";
            return (
              <li key={m.sku} className="grid grid-cols-[1.25rem_1fr_auto] items-center gap-x-3 gap-y-1.5">
                <span className="font-mono text-xs text-faint">{i + 1}</span>
                <span className="min-w-0">
                  <span className="block truncate font-mono text-[13px] font-bold">{m.sku}</span>
                  {m.title ? <span className="block truncate text-xs text-muted">{m.title}</span> : null}
                </span>
                <span className="text-right">
                  <span className="block font-mono text-sm font-bold tabular-nums">{formatNumber(Math.round(m.f30))}</span>
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
    <section className="sp-card sp-reveal p-4 sm:p-5" style={style(6)} aria-labelledby="whs-title">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="whs-title" className="font-display text-lg font-semibold">
            Stock by warehouse
          </h2>
          <p className="text-xs text-muted">Units in stock on active listings, and where SKUs are empty or low</p>
        </div>
        {rows.length ? (
          <p className="text-right">
            <span className="text-2xl font-bold">{formatNumber(total)}</span>
            <span className="ml-1.5 text-xs text-muted">units</span>
          </p>
        ) : null}
      </header>
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

const STAGES = [
  { key: "to_accept", label: "To Accept", color: STAGE_COLOR.to_accept },
  { key: "to_pack", label: "To Pack", color: STAGE_COLOR.to_pack },
  { key: "to_dispatch", label: "To Dispatch", color: STAGE_COLOR.to_dispatch },
] as const;

/** Active orders per warehouse, split into Seller Hub's stages, light to dark as orders move along. */
export function OrdersByStage({ d }: { d: DeckData }) {
  const rows = d.whStages;
  const total = rows.reduce((n, r) => n + r.to_accept + r.to_pack + r.to_dispatch, 0);
  return (
    <section className="sp-card sp-reveal p-4 sm:p-5" style={style(7)} aria-labelledby="stage-title">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="stage-title" className="font-display text-lg font-semibold">
            Active orders by stage
          </h2>
          <p className="text-xs text-muted">Per warehouse, as Seller Hub counts them</p>
        </div>
        <p className="text-right">
          <span className="text-2xl font-bold">{formatNumber(total)}</span>
          <span className="ml-1.5 text-xs text-muted">active</span>
        </p>
      </header>
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">No warehouse is set up for you yet.</p>
      ) : (
        <StackedRows
          rows={rows.map((r) => ({ key: r.id, label: r.name, color: r.color, values: { to_accept: r.to_accept, to_pack: r.to_pack, to_dispatch: r.to_dispatch } }))}
          parts={[...STAGES]}
          unit="orders"
          ariaLabel={`Active orders by warehouse and stage: ${rows.map((r) => `${r.name}: ${r.to_accept} to accept, ${r.to_pack} to pack, ${r.to_dispatch} to dispatch`).join("; ")}`}
        />
      )}
    </section>
  );
}

