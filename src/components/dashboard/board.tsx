import Link from "next/link";
import type { ReactNode } from "react";
import { Gauge, Sparkline, TrendChart } from "@/components/signal/charts";
import { CountUp } from "@/components/signal/count-up";
import { RupeesCountUp } from "@/components/dashboard/money-count";
import { KpiTile } from "@/components/signal/kpi";
import { Chip } from "@/components/ui";
import { KIND_TONE, timeAgo } from "@/lib/alerts";
import { formatINR, formatNumber } from "@/lib/format";
import { NOTIFICATION_ICON_LABEL } from "@/lib/labels";
import { STAGE_COLOR } from "@/lib/theme";
import type { DashboardData } from "@/server/dashboard-data";

// The owner's dashboard: every card and row is a link to the page with the detail.

const style = (i: number) => ({ ["--i" as string]: i });

/** ₹ in lakh or crore for the big numbers (₹16.5L, ₹1.02Cr); exact rupees below a lakh. */
function short(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(1)}L`;
  return `${sign}${formatINR(Math.round(a))}`;
}
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** A big clickable tile with a coloured glow in its corner. */
function Tile({ href, label, glow, index, children }: { href: string; label: string; glow: string; index: number; children: ReactNode }) {
  return (
    <Link
     
      href={href}
      className="focus-ring sp-card sp-card-lg sp-lift sp-reveal group relative block min-w-0 overflow-hidden p-5"
      style={style(index)}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full opacity-80 transition-opacity group-hover:opacity-100"
        style={{ background: `radial-gradient(circle, color-mix(in srgb, ${glow} 34%, transparent), transparent 68%)` }}
      />
      <span className="relative flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted">{label}</span>
        <span aria-hidden="true" className="text-muted transition-transform group-hover:translate-x-0.5">
          →
        </span>
      </span>
      <span className="relative mt-2 block">{children}</span>
    </Link>
  );
}

/** A card whose header links to the page with the detail. */
function Panel({ title, sub, href, index, children, className = "" }: { title: string; sub?: string; href: string; index: number; children: ReactNode; className?: string }) {
  return (
    <section className={`sp-card sp-card-lg sp-reveal min-w-0 p-5 sm:p-6 ${className}`} style={style(index)}>
      <Link href={href} className="focus-ring group mb-4 flex items-end justify-between gap-2 rounded-lg">
        <span className="min-w-0">
          <span className="block font-display text-lg font-semibold group-hover:text-accent-text">{title}</span>
          {sub ? <span className="block text-xs text-muted">{sub}</span> : null}
        </span>
        <span className="shrink-0 text-xs font-bold text-accent-text">Open →</span>
      </Link>
      {children}
    </section>
  );
}

/** Where the month's revenue went: product cost, ads, Flipkart fees and what is left, as a ring with a legend. */
function MoneyRing({ parts, centre, sub }: { parts: { label: string; value: number; color: string }[]; centre: string; sub: string }) {
  const total = parts.reduce((n, p) => n + Math.max(0, p.value), 0) || 1;
  // Each segment's length and where it starts, round the ring.
  const segs = parts.map((p, i) => ({ ...p, len: (Math.max(0, p.value) / total) * 100, start: parts.slice(0, i).reduce((n, q) => n + (Math.max(0, q.value) / total) * 100, 0) }));
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row">
      <div className="relative h-44 w-44 shrink-0" role="img" aria-label={`Where the revenue went: ${parts.map((p) => `${p.label} ${short(p.value)}`).join(", ")}`}>
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle cx="50" cy="50" r="40" fill="none" style={{ stroke: "var(--surface2)" }} strokeWidth="14" />
          {segs.map((p) => (
            <circle key={p.label} cx="50" cy="50" r="40" fill="none" style={{ stroke: p.color }} strokeWidth="14" pathLength={100} strokeDasharray={`${Math.max(0, p.len - 0.8)} ${100 - Math.max(0, p.len - 0.8)}`} strokeDashoffset={-p.start} className="sp-gauge-arc" />
          ))}
        </svg>
        <span className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-2xl font-bold tabular-nums">{centre}</span>
          <span className="text-[11px] font-semibold text-muted">{sub}</span>
        </span>
      </div>
      <ul className="grid w-full gap-2">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center justify-between gap-3 rounded-xl bg-surface2/50 px-3 py-2 text-sm">
            <span className="flex items-center gap-2">
              <span aria-hidden="true" className="h-3 w-3 rounded" style={{ background: p.color }} />
              {p.label}
            </span>
            <span className="font-mono font-bold tabular-nums">
              {short(p.value)} <span className="text-xs font-normal text-muted">{pct(p.value, total)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DashboardBoard({ d }: { d: DashboardData }) {
  const { deck, pnl, expenses, alerts, today } = d;
  const now = pnl.months[0] ?? null;
  const prev = pnl.months[1] ?? null;
  const t = now?.total;
  const thisMonth = today.slice(0, 7);
  // On pace: the month's profit so far, spread over the whole month (current month only).
  const covered = now?.month === thisMonth && now.to ? Number(now.to.slice(8, 10)) : null;
  const [yy, mm] = (now?.month ?? thisMonth).split("-").map(Number);
  const daysIn = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const pace = t && covered ? (t.net / covered) * daysIn : null;
  const margin = t && t.sales > 0 ? Math.round((t.net / t.sales) * 100) : null;
  const prevMargin = prev && prev.total.sales > 0 ? Math.round((prev.total.net / prev.total.sales) * 100) : null;
  const adsShare = t && t.sales > 0 ? (t.ads / t.sales) * 100 : 0;
  const tc = deck.todayCard;
  const products = now ? now.byMaster.filter((p) => p.id !== "unlinked" && p.units > 0) : [];
  const best = [...products].sort((a, b) => b.net - a.net).slice(0, 6);
  const worst = [...products].sort((a, b) => a.net - b.net).filter((p) => p.net < 0).slice(0, 3);
  const maxProduct = Math.max(1, ...best.map((p) => Math.abs(p.net)), ...worst.map((p) => Math.abs(p.net)));
  const months = [...pnl.months].slice(0, 4).reverse();
  const maxMonth = Math.max(1, ...months.map((m) => m.total.sales));
  const stageMax = Math.max(1, ...deck.whStages.map((w) => w.to_accept + w.to_pack + w.to_dispatch));
  const expMax = Math.max(1, ...expenses.rows.map((r) => Math.max(r.spent, r.budget ?? 0)));
  const hour = Number(new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", hourCycle: "h23" }).format(new Date(deck.nowIso)));
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-[1.65rem] font-semibold tracking-tight">
            {greet}, {deck.firstName}
          </h1>
          <p className="mt-0.5 text-sm text-muted">Money, orders, expenses and alerts in one place. Tap anything for the detail.</p>
        </div>
        {now ? <Chip tone="accent">{now.label}{now.to ? ` · to ${Number(now.to.slice(8, 10))} ${now.label.split(" ")[0].slice(0, 3)}` : ""}</Chip> : null}
      </header>

      {/* The four numbers that matter today. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile href={now ? `/pnl?month=${now.month}` : "/pnl"} label={`Profit after ads · ${now ? now.label.split(" ")[0] : "month"}`} glow={t && t.net < 0 ? "var(--bad)" : "var(--ok)"} index={0}>
          <span className={`block font-mono text-4xl font-bold tabular-nums ${t && t.net < 0 ? "text-bad" : "text-ok"}`}>
            <RupeesCountUp value={Math.round(t?.net ?? 0)} />
          </span>
          <span className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            {margin !== null ? <Chip tone={margin < 10 ? "bad" : margin < 25 ? "warn" : "ok"}>{margin}% margin</Chip> : null}
            {prevMargin !== null && prev ? <span>{prev.label.split(" ")[0]} {prevMargin}%</span> : null}
          </span>
          {pace !== null ? <span className="mt-2 block text-xs text-muted">On pace for {short(pace)} this month</span> : null}
        </Tile>
        <Tile href={now ? `/pnl?month=${now.month}` : "/pnl"} label="Revenue (seller price)" glow="var(--accent)" index={1}>
          <span className="block font-mono text-4xl font-bold tabular-nums">
            <RupeesCountUp value={Math.round(t?.sales ?? 0)} />
          </span>
          <span className="mt-2 block text-xs text-muted">
            {formatNumber(t?.units ?? 0)} units sold{prev ? ` · ${prev.label.split(" ")[0]} ${short(prev.total.sales)}` : ""}
          </span>
          {t ? (
            <span className="mt-3 flex h-2 overflow-hidden rounded-full" aria-hidden="true">
              <span style={{ width: `${pct(t.cost, t.sales)}%`, background: "var(--stage-2)" }} />
              <span style={{ width: `${pct(t.ads, t.sales)}%`, background: "var(--madder)" }} />
              <span style={{ width: `${pct(t.fees, t.sales)}%`, background: "var(--faint)" }} />
              <span style={{ width: `${Math.max(0, pct(t.net, t.sales))}%`, background: "var(--ok)" }} />
            </span>
          ) : null}
        </Tile>
        <Tile href="/pnl#ads-title" label="Ads incl. 18% GST" glow="var(--madder)" index={2}>
          <span className="flex items-center justify-between gap-3">
            <span className="block font-mono text-4xl font-bold tabular-nums">
              <RupeesCountUp value={Math.round(t?.ads ?? 0)} />
            </span>
            <Gauge pct={adsShare} tone={adsShare > 15 ? "bad" : adsShare > 10 ? "warn" : "ok"} label={`Ads are ${Math.round(adsShare)}% of revenue`} />
          </span>
          <span className="mt-2 block text-xs text-muted">
            {Math.round(adsShare)}% of revenue{prev && prev.total.sales > 0 ? ` · ${prev.label.split(" ")[0]} ${Math.round((prev.total.ads / prev.total.sales) * 100)}%` : ""}
          </span>
        </Tile>
        <Tile href="/flipkart?tab=orders" label="To dispatch today" glow="var(--cyan)" index={3}>
          <span className="block font-mono text-4xl font-bold tabular-nums">
            <CountUp value={tc?.due ?? 0} />
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            {tc && tc.late > 0 ? <Chip tone="bad">{formatNumber(tc.late)} late</Chip> : <Chip tone="ok">None late</Chip>}
            {tc?.avg7 != null ? <span>7-day avg {formatNumber(tc.avg7)}/day</span> : null}
          </span>
          <span className="mt-2 block">
            <Sparkline values={deck.trend.map((p) => p.orders)} tone="cyan" label="Orders a day, last 14 days" />
          </span>
        </Tile>
      </div>

      {/* Orders a day, and where this month's money went. */}
      <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
        <Panel title="Orders a day" sub={`Placed on Flipkart, last ${deck.trend.length} days`} href="/flipkart?tab=orders" index={4}>
          {deck.trend.length >= 2 ? (
            <TrendChart
              data={deck.trend.map((p) => ({ label: p.label, value: p.orders }))}
              avg={tc?.avg7 ?? null}
              avgLabel={tc?.avg7 == null ? "" : `7-day avg ${formatNumber(tc.avg7)}`}
              ariaLabel={`Orders per day: ${deck.trend.map((p) => `${p.label} ${formatNumber(p.orders)}`).join(", ")}`}
            />
          ) : (
            <p className="py-10 text-center text-sm text-muted">The graph starts once a few days of orders are saved.</p>
          )}
        </Panel>
        <Panel title="Where the money went" sub={now ? `${now.label}, out of ${short(t?.sales ?? 0)} revenue` : "No P&L yet"} href={now ? `/pnl?month=${now.month}` : "/pnl"} index={5}>
          {t ? (
            <MoneyRing
              centre={margin === null ? "—" : `${margin}%`}
              sub="kept after ads"
              parts={[
                { label: "Product cost", value: t.cost, color: "var(--stage-2)" },
                { label: "Ads", value: t.ads, color: "var(--madder)" },
                { label: "Flipkart fees", value: t.fees, color: "var(--faint)" },
                { label: "Profit", value: Math.max(0, t.net), color: "var(--ok)" },
              ]}
            />
          ) : (
            <p className="py-10 text-center text-sm text-muted">Add costs on the P&amp;L page to see this.</p>
          )}
        </Panel>
      </div>

      {/* Today's signals from the Command Deck, each a link. */}
      {deck.pulses.length ? (
        <div className={`grid grid-cols-2 gap-4 ${deck.pulses.length >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
          {deck.pulses.slice(0, 4).map((p, i) => (
            <KpiTile key={p.key} label={p.label} value={p.value} sub={p.sub} tone={p.tone} spark={p.spark} sparkTone={p.tone} sparkLabel={p.sparkLabel} href={p.href} index={6 + i} />
          ))}
        </div>
      ) : null}

      {/* Month by month, and the products making and losing money. */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Month by month" sub="Revenue, profit after ads and ads" href="/pnl" index={10}>
          {months.length ? (
            <div className="flex h-56 items-end gap-4">
              {months.map((m) => (
                <Link key={m.month} href={`/pnl?month=${m.month}`} className="focus-ring group flex h-full min-w-0 flex-1 flex-col justify-end rounded-xl p-1 hover:bg-surface2/50">
                  <span className="flex h-full items-end justify-center gap-1.5">
                    {[
                      { v: m.total.sales, c: "linear-gradient(180deg, var(--accent-text), var(--accent))", l: "Revenue" },
                      { v: Math.max(0, m.total.net), c: "linear-gradient(180deg, color-mix(in srgb, var(--ok) 70%, white), var(--ok))", l: "Profit" },
                      { v: m.total.ads, c: "linear-gradient(180deg, color-mix(in srgb, var(--madder) 70%, white), var(--madder))", l: "Ads" },
                    ].map((b) => (
                      <span key={b.l} title={`${b.l} ${short(b.v)}`} className="sp-bar w-5 rounded-t-md sm:w-7" style={{ height: `${Math.max(3, (b.v / maxMonth) * 100)}%`, background: b.c, transformOrigin: "bottom" }} />
                    ))}
                  </span>
                  <span className="mt-2 block text-center text-xs font-bold">{m.label.split(" ")[0].slice(0, 3)}</span>
                  <span className="block text-center font-mono text-[11px] text-muted tabular-nums">{short(m.total.net)}</span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-muted">No months yet.</p>
          )}
          <p className="mt-3 flex flex-wrap gap-3 text-xs text-muted">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded" style={{ background: "var(--accent)" }} />Revenue</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded" style={{ background: "var(--ok)" }} />Profit after ads</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded" style={{ background: "var(--madder)" }} />Ads</span>
          </p>
        </Panel>
        <Panel title="Products by profit" sub={now ? `${now.label}, after ads` : ""} href={now ? `/pnl?month=${now.month}` : "/pnl"} index={11}>
          <ul className="flex flex-col gap-2.5">
            {[...best, ...worst].map((p) => (
              <li key={p.id}>
                <Link href={now ? `/pnl?month=${now.month}` : "/pnl"} className="focus-ring grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-1 py-0.5 hover:bg-surface2/50">
                  <span className="truncate text-sm font-semibold">{p.name}</span>
                  <span className="h-2.5 overflow-hidden rounded-full bg-surface2">
                    <span className="sp-bar block h-full rounded-full" style={{ width: `${(Math.abs(p.net) / maxProduct) * 100}%`, background: p.net < 0 ? "var(--bad)" : "linear-gradient(90deg, var(--accent), var(--ok))" }} />
                  </span>
                  <span className={`font-mono text-sm font-bold tabular-nums ${p.net < 0 ? "text-bad" : "text-ok"}`}>{short(p.net)}</span>
                </Link>
              </li>
            ))}
            {!best.length ? <li className="py-6 text-center text-sm text-muted">No products sold yet this month.</li> : null}
          </ul>
        </Panel>
      </div>

      {/* Work in the warehouses, spending, and what needs a look. */}
      <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
        <Panel title="Orders waiting, by warehouse" sub="To accept, to pack and to dispatch" href="/flipkart?tab=orders" index={12}>
          <ul className="flex flex-col gap-3">
            {deck.whStages.map((w) => {
              const sum = w.to_accept + w.to_pack + w.to_dispatch;
              const href = deck.warehouses.find((x) => x.id === w.id)?.href ?? "/flipkart?tab=orders";
              return (
                <li key={w.id}>
                  <Link href={href} className="focus-ring block rounded-lg px-1 py-0.5 hover:bg-surface2/50">
                    <span className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex items-center gap-2 font-semibold">
                        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: w.color }} />
                        {w.name}
                      </span>
                      <span className="font-mono font-bold tabular-nums">{formatNumber(sum)}</span>
                    </span>
                    <span className="mt-1.5 flex h-2.5 overflow-hidden rounded-full bg-surface2" style={{ width: `${Math.max(4, (sum / stageMax) * 100)}%` }}>
                      <span style={{ flex: w.to_accept, background: STAGE_COLOR.to_accept }} />
                      <span style={{ flex: w.to_pack, background: STAGE_COLOR.to_pack }} />
                      <span style={{ flex: w.to_dispatch, background: STAGE_COLOR.to_dispatch }} />
                    </span>
                  </Link>
                </li>
              );
            })}
            {!deck.whStages.length ? <li className="py-6 text-center text-sm text-muted">No open orders.</li> : null}
          </ul>
          <p className="mt-3 flex flex-wrap gap-3 text-xs text-muted">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded" style={{ background: STAGE_COLOR.to_accept }} />To accept</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded" style={{ background: STAGE_COLOR.to_pack }} />To pack</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded" style={{ background: STAGE_COLOR.to_dispatch }} />To dispatch</span>
          </p>
        </Panel>
        <Panel title="Expenses" sub={`${expenses.label}: ${formatINR(Math.round(expenses.total))} across ${formatNumber(expenses.count)} payments`} href="/expenses" index={13}>
          <ul className="flex flex-col gap-3">
            {expenses.rows.map((r) => {
              const over = r.budget !== null && r.spent > r.budget;
              return (
                <li key={r.key}>
                  <Link href={r.href} className="focus-ring block rounded-lg px-1 py-0.5 hover:bg-surface2/50">
                    <span className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex items-center gap-2 font-semibold">
                        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />
                        {r.name}
                      </span>
                      <span className="font-mono tabular-nums">
                        <b className={over ? "text-bad" : ""}>{formatINR(Math.round(r.spent))}</b>
                        {r.budget !== null ? <span className="text-xs text-muted"> / {formatINR(Math.round(r.budget))}</span> : null}
                      </span>
                    </span>
                    <span className="relative mt-1.5 block h-2.5 overflow-hidden rounded-full bg-surface2">
                      <span className="sp-bar block h-full rounded-full" style={{ width: `${(r.spent / expMax) * 100}%`, background: over ? "var(--bad)" : r.color }} />
                      {r.budget !== null ? <span aria-hidden="true" className="absolute inset-y-0 w-0.5 bg-ink/70" style={{ left: `${(r.budget / expMax) * 100}%` }} /> : null}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {!expenses.hasBudget ? (
            <Link href="/expenses#budget-title" className="mt-3 block text-xs font-bold text-warn hover:underline">
              No budget set for {expenses.label} yet. Plan it →
            </Link>
          ) : (
            <p className="mt-3 text-xs text-muted">The tick on each bar is that warehouse&apos;s running-costs budget.</p>
          )}
        </Panel>
        <Panel title="Needs a look" sub={alerts.length ? `${alerts.length} unread alerts` : "Nothing unread"} href="/notifications" index={14} className="lg:col-span-2 xl:col-span-1">
          {alerts.length ? (
            <ul className="flex flex-col gap-2">
              {alerts.map((a) => (
                <li key={a.id}>
                  <Link href={a.href} className="focus-ring flex items-start gap-3 rounded-xl border border-line-soft bg-surface/60 p-3 hover:border-accent/50">
                    <Chip tone={KIND_TONE[a.kind] ?? "neutral"}>{NOTIFICATION_ICON_LABEL[a.kind] ?? "Alert"}</Chip>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{a.title}</span>
                      <span className="block text-[11px] text-muted">{timeAgo(a.createdAt)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-xl bg-ok-soft px-3 py-6 text-center text-sm font-semibold text-ok">All clear: no unread alerts.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
