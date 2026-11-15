import Link from "next/link";
import type { ReactNode } from "react";
import { Gauge, Sparkline, TrendChart } from "@/components/signal/charts";
import { CountUp } from "@/components/signal/count-up";
import { Lanes } from "@/components/signal/lanes";
import { RupeesCountUp } from "@/components/dashboard/money-count";
import { Chip, Headline, Num, SectionHead, Stat, StatStrip } from "@/components/ui";
import { KIND_TONE, timeAgo } from "@/lib/alerts";
import { formatINR, formatNumber } from "@/lib/format";
import { NOTIFICATION_ICON_LABEL } from "@/lib/labels";
import type { DashboardData } from "@/server/dashboard-data";

// The owner's dashboard: every card and row is a link to the page with the detail.

/** ₹ in lakh or crore for the big numbers (₹16.5L, ₹1.02Cr); exact rupees below a lakh. */
function short(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(1)}L`;
  return `${sign}${formatINR(Math.round(a))}`;
}
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** A big clickable figure. */
function Tile({ href, label, children }: { href: string; label: string; children: ReactNode }) {
  return (
    <Link href={href} className="focus-ring sp-card sp-lift block min-w-0 p-5">
      <span className="block text-xs font-medium text-muted">{label}</span>
      <span className="mt-2 block">{children}</span>
    </Link>
  );
}

/** A card whose heading links to the page with the detail. */
function Panel({ title, sub, href, children, className = "" }: { title: string; sub?: string; href: string; children: ReactNode; className?: string }) {
  return (
    <section className={`sp-card min-w-0 p-5 ${className}`}>
      <SectionHead
        title={title}
        sub={sub}
        action={
          <Link href={href} className="focus-ring shrink-0 rounded-md text-xs font-semibold text-accent-text hover:underline">
            Open
          </Link>
        }
      />
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
      <div className="relative h-40 w-40 shrink-0" role="img" aria-label={`Where the revenue went: ${parts.map((p) => `${p.label} ${short(p.value)}`).join(", ")}`}>
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle cx="50" cy="50" r="40" fill="none" style={{ stroke: "var(--surface2)" }} strokeWidth="12" />
          {segs.map((p) => (
            <circle key={p.label} cx="50" cy="50" r="40" fill="none" style={{ stroke: p.color }} strokeWidth="12" pathLength={100} strokeDasharray={`${Math.max(0, p.len - 0.8)} ${100 - Math.max(0, p.len - 0.8)}`} strokeDashoffset={-p.start} className="sp-gauge-arc" />
          ))}
        </svg>
        <span className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-2xl font-semibold tabular-nums">{centre}</span>
          <span className="text-[11px] font-medium text-muted">{sub}</span>
        </span>
      </div>
      <ul className="w-full divide-y divide-line-soft">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center justify-between gap-3 py-1.5 text-sm">
            <span className="flex items-center gap-2">
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />
              {p.label}
            </span>
            <span className="font-mono font-semibold tabular-nums">
              {short(p.value)} <span className="text-xs font-normal text-muted">{pct(p.value, total)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DashboardBoard({ d }: { d: DashboardData }) {
  const { deck, pnl, alerts, today } = d;
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
  const hour = Number(new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", hourCycle: "h23" }).format(new Date(deck.nowIso)));
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const stages = new Map(deck.whStages.map((s) => [s.id, s]));
  const lanes = deck.warehouses.map((w) => {
    const s = stages.get(w.id);
    return {
      id: w.id,
      name: w.name,
      color: w.color,
      stages: { to_accept: s?.to_accept ?? 0, to_pack: s?.to_pack ?? 0, to_dispatch: s?.to_dispatch ?? 0 },
      late: w.late,
      next: w.next,
      href: w.href,
    };
  });
  const monthWord = now ? now.label.split(" ")[0] : "this month";
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted">
            {greet}, {deck.firstName}
            {now ? ` · ${now.label}${now.to ? ` to ${Number(now.to.slice(8, 10))} ${monthWord.slice(0, 3)}` : ""}` : ""}
          </p>
          {t ? (
            <Headline className="mt-2">
              <Num tone={t.net < 0 ? "bad" : "ok"}>{short(t.net)}</Num> profit after ads {now?.month === thisMonth ? "so far" : `in ${monthWord}`}
              {margin !== null ? (
                <>
                  , a <Num tone={margin < 10 ? "bad" : margin < 25 ? "warn" : "ok"}>{margin}%</Num> margin on <Num>{short(t.sales)}</Num>
                </>
              ) : null}
              {tc ? (
                <>
                  ; <Num tone={tc.late > 0 ? "bad" : "ink"}>{formatNumber(tc.due)}</Num> orders still to go out today
                </>
              ) : null}
              .
            </Headline>
          ) : (
            <Headline className="mt-2">Money, orders and alerts in one place. Add costs on the P&amp;L page to see profit here.</Headline>
          )}
        </div>
      </header>
      {/* The four numbers that matter today. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile href={now ? `/pnl?month=${now.month}` : "/pnl"} label={`Profit after ads · ${now ? monthWord : "month"}`}>
          <span className={`display-num block text-[2.5rem] ${t && t.net < 0 ? "text-bad" : "text-ok"}`}>
            <RupeesCountUp value={Math.round(t?.net ?? 0)} />
          </span>
          <span className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            {margin !== null ? <Chip tone={margin < 10 ? "bad" : margin < 25 ? "warn" : "ok"}>{margin}% margin</Chip> : null}
            {prevMargin !== null && prev ? <span>{prev.label.split(" ")[0]} {prevMargin}%</span> : null}
          </span>
          {pace !== null ? <span className="mt-2 block text-xs text-muted">On pace for {short(pace)} this month</span> : null}
        </Tile>
        <Tile href={now ? `/pnl?month=${now.month}` : "/pnl"} label="Revenue (seller price)">
          <span className="display-num block text-[2.5rem]">
            <RupeesCountUp value={Math.round(t?.sales ?? 0)} />
          </span>
          <span className="mt-2 block text-xs text-muted">
            {formatNumber(t?.units ?? 0)} units sold{prev ? ` · ${prev.label.split(" ")[0]} ${short(prev.total.sales)}` : ""}
          </span>
          {t ? (
            <span className="mt-3 flex h-2 gap-[2px] overflow-hidden rounded-full" aria-hidden="true">
              <span style={{ width: `${pct(t.cost, t.sales)}%`, background: "var(--stage-2)" }} />
              <span style={{ width: `${pct(t.ads, t.sales)}%`, background: "var(--madder)" }} />
              <span style={{ width: `${pct(t.fees, t.sales)}%`, background: "var(--faint)" }} />
              <span style={{ width: `${Math.max(0, pct(t.net, t.sales))}%`, background: "var(--ok)" }} />
            </span>
          ) : null}
        </Tile>
        <Tile href="/pnl#ads-title" label="Ads incl. 18% GST">
          <span className="flex items-center justify-between gap-3">
            <span className="display-num block text-[2.5rem]">
              <RupeesCountUp value={Math.round(t?.ads ?? 0)} />
            </span>
            <Gauge pct={adsShare} tone={adsShare > 15 ? "bad" : adsShare > 10 ? "warn" : "ok"} label={`Ads are ${Math.round(adsShare)}% of revenue`} />
          </span>
          <span className="mt-2 block text-xs text-muted">
            {Math.round(adsShare)}% of revenue{prev && prev.total.sales > 0 ? ` · ${prev.label.split(" ")[0]} ${Math.round((prev.total.ads / prev.total.sales) * 100)}%` : ""}
          </span>
        </Tile>
        <Tile href="/flipkart?tab=orders" label="To dispatch today">
          <span className="display-num block text-[2.5rem]">
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
      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <Panel title="Orders a day" sub={`Placed on Flipkart, last ${deck.trend.length} days`} href="/flipkart?tab=orders">
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
        <Panel title="Where the money went" sub={now ? `${now.label}, out of ${short(t?.sales ?? 0)} revenue` : "No P&L yet"} href={now ? `/pnl?month=${now.month}` : "/pnl"}>
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
        <StatStrip ariaLabel="Today's signals">
          {deck.pulses.slice(0, 4).map((p) => (
            <Stat key={p.key} label={p.label} value={<CountUp value={p.value} />} sub={p.sub} tone={p.tone === "cyan" ? "accent" : p.tone} href={p.href} chart={<Sparkline values={p.spark} tone={p.tone} label={p.sparkLabel} className="h-7 w-full max-w-[10rem]" />} />
          ))}
        </StatStrip>
      ) : null}
      {/* Month by month, and the products making and losing money. */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Month by month" sub="Revenue, profit after ads and ads" href="/pnl">
          {months.length ? (
            <div className="flex h-56 items-end gap-4">
              {months.map((m) => (
                <Link key={m.month} href={`/pnl?month=${m.month}`} className="focus-ring group flex h-full min-w-0 flex-1 flex-col justify-end rounded-lg p-1 hover:bg-surface2/50">
                  <span className="flex h-full items-end justify-center gap-1.5">
                    {[
                      { v: m.total.sales, c: "var(--accent)", l: "Revenue" },
                      { v: Math.max(0, m.total.net), c: "var(--ok)", l: "Profit" },
                      { v: m.total.ads, c: "var(--madder)", l: "Ads" },
                    ].map((b) => (
                      <span key={b.l} title={`${b.l} ${short(b.v)}`} className="sp-bar w-5 rounded-t sm:w-7" style={{ height: `${Math.max(3, (b.v / maxMonth) * 100)}%`, background: b.c, transformOrigin: "bottom" }} />
                    ))}
                  </span>
                  <span className="mt-2 block text-center text-xs font-semibold">{m.label.split(" ")[0].slice(0, 3)}</span>
                  <span className="block text-center font-mono text-[11px] text-muted tabular-nums">{short(m.total.net)}</span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-muted">No months yet.</p>
          )}
          <p className="mt-3 flex flex-wrap gap-3 text-xs text-muted">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--accent)" }} />Revenue</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--ok)" }} />Profit after ads</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--madder)" }} />Ads</span>
          </p>
        </Panel>
        <Panel title="Products by profit" sub={now ? `${now.label}, after ads` : ""} href={now ? `/pnl?month=${now.month}` : "/pnl"}>
          <ul className="flex flex-col divide-y divide-line-soft">
            {[...best, ...worst].map((p) => (
              <li key={p.id}>
                <Link href={now ? `/pnl?month=${now.month}` : "/pnl"} className="focus-ring grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 rounded-md py-2 hover:bg-surface2/50">
                  <span className="truncate text-sm font-semibold">{p.name}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-surface2">
                    <span className="sp-bar block h-full rounded-full" style={{ width: `${(Math.abs(p.net) / maxProduct) * 100}%`, background: p.net < 0 ? "var(--bad)" : "var(--ok)" }} />
                  </span>
                  <span className={`font-mono text-sm font-semibold tabular-nums ${p.net < 0 ? "text-bad" : "text-ok"}`}>{short(p.net)}</span>
                </Link>
              </li>
            ))}
            {!best.length ? <li className="py-6 text-center text-sm text-muted">No products sold yet this month.</li> : null}
          </ul>
        </Panel>
      </div>
      {/* Work in the warehouses, and what needs a look. */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Orders waiting, by warehouse" sub="To accept, to pack and to dispatch; late orders at the gate" href="/flipkart?tab=orders">
          {lanes.length ? (
            <Lanes lanes={lanes} ariaLabel={`Active orders by warehouse and stage: ${deck.whStages.map((r) => `${r.name}: ${r.to_accept} to accept, ${r.to_pack} to pack, ${r.to_dispatch} to dispatch`).join("; ")}`} />
          ) : (
            <p className="py-6 text-center text-sm text-muted">No open orders.</p>
          )}
        </Panel>
        <Panel title="Needs a look" sub={alerts.length ? `${alerts.length} unread alerts` : "Nothing unread"} href="/notifications">
          {alerts.length ? (
            <ul className="flex flex-col divide-y divide-line-soft">
              {alerts.map((a) => (
                <li key={a.id}>
                  <Link href={a.href} className="focus-ring flex items-start gap-3 rounded-md py-2.5 hover:bg-surface2/50">
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
            <p className="rounded-lg bg-ok-soft px-3 py-6 text-center text-sm font-semibold text-ok">All clear: no unread alerts.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
