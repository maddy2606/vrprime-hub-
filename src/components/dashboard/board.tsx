import Link from "next/link";
import type { ReactNode } from "react";
import { barFill, Gauge, TrendChart } from "@/components/signal/charts";
import { Lanes } from "@/components/signal/lanes";
import { RupeesCountUp } from "@/components/dashboard/money-count";
import { AlertIcon, BellIcon } from "@/components/icons";
import { buttonClass, Chip, Headline, ItemRow, Num, SectionHead, Stat, StatStrip, TONE_TINT } from "@/components/ui";
import { KIND_TONE, timeAgo } from "@/lib/alerts";
import { formatINR, formatNumber } from "@/lib/format";
import { NOTIFICATION_ICON_LABEL } from "@/lib/labels";
import type { DashboardData } from "@/server/dashboard-data";

// The owner's dashboard (graphite-spec 9.2): every card and row is a link to the page with the detail.

/** ₹ in lakh or crore for the big numbers (₹16.5L, ₹1.02Cr); exact rupees below a lakh. */
function short(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(1)}L`;
  return `${sign}${formatINR(Math.round(a))}`;
}
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** A card whose heading links to the page with the detail. */
function Panel({ title, sub, href, children, className = "" }: { title: string; sub?: string; href: string; children: ReactNode; className?: string }) {
  return (
    <section className={`sp-card g-pad min-w-0 ${className}`}>
      <SectionHead
        title={title}
        sub={sub}
        action={
          <Link href={href} className={buttonClass("ghost")}>
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
  // Each segment's length and where it starts, round the ring. A 6px stroke on a 160px ring is 3.75 units of 100.
  const segs = parts.map((p, i) => ({ ...p, len: (Math.max(0, p.value) / total) * 100, start: parts.slice(0, i).reduce((n, q) => n + (Math.max(0, q.value) / total) * 100, 0) }));
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row">
      <div className="relative h-40 w-40 shrink-0" role="img" aria-label={`Where the revenue went: ${parts.map((p) => `${p.label} ${short(p.value)}`).join(", ")}`}>
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle cx="50" cy="50" r="44" fill="none" style={{ stroke: "var(--surface2)" }} strokeWidth="3.75" />
          {segs.map((p) => (
            <circle
              key={p.label}
              cx="50"
              cy="50"
              r="44"
              fill="none"
              style={{ stroke: p.color }}
              strokeWidth="3.75"
              strokeLinecap="round"
              pathLength={100}
              strokeDasharray={`${Math.max(0, p.len - 3)} ${100 - Math.max(0, p.len - 3)}`}
              strokeDashoffset={-p.start}
              className="sp-gauge-arc"
            />
          ))}
        </svg>
        <span className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-2xl font-medium tabular-nums">{centre}</span>
          <span className="t-caption">{sub}</span>
        </span>
      </div>
      <ul className="m-0 w-full list-none divide-y divide-line-soft p-0">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center justify-between gap-3 py-2 text-[13px]">
            <span className="flex items-center gap-2">
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />
              {p.label}
            </span>
            <span className="font-medium tabular-nums">
              {short(p.value)} <span className="t-caption">{pct(p.value, total)}%</span>
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
    <div className="g-grid vr-stagger items-start">
      {/* 1. Greeting as the page title, the month as a chip on the right, the headline sentence under it. */}
      <header className="span-12">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="t-h1 min-w-0">
            {greet}, {deck.firstName}
          </h1>
          {now ? (
            <Chip tone="accent">
              {now.label}
              {now.to ? ` to ${Number(now.to.slice(8, 10))} ${monthWord.slice(0, 3)}` : ""}
            </Chip>
          ) : null}
        </div>
        {t ? (
          <Headline className="mt-1">
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
          <Headline className="mt-1">Money, orders and alerts in one place. Add costs on the P&amp;L page to see profit here.</Headline>
        )}
      </header>

      {/* 2. The four numbers that matter today, as a KPI row (graphite-spec 9.2). */}
      <StatStrip ariaLabel="This month and today" className="span-12">
        <Stat
          label={`Profit after ads · ${now ? monthWord : "month"}`}
          kind="money"
          href={now ? `/pnl?month=${now.month}` : "/pnl"}
          tone={t && t.net < 0 ? "bad" : "ink"}
          value={<RupeesCountUp value={Math.round(t?.net ?? 0)} />}
          sub={
            [margin !== null ? `${margin}% margin` : null, prevMargin !== null && prev ? `${prev.label.split(" ")[0]} ${prevMargin}%` : null, pace !== null ? `On pace for ${short(pace)} this month` : null]
              .filter(Boolean)
              .join(" · ") || undefined
          }
        />
        <Stat
          label="Revenue (seller price)"
          kind="money"
          href={now ? `/pnl?month=${now.month}` : "/pnl"}
          value={<RupeesCountUp value={Math.round(t?.sales ?? 0)} />}
          sub={`${formatNumber(t?.units ?? 0)} units sold${prev ? ` · ${prev.label.split(" ")[0]} ${short(prev.total.sales)}` : ""}`}
          chart={
            t ? (
              <span className="flex h-2.5 gap-[2px] overflow-hidden rounded-full bg-surface2" aria-hidden="true">
                <span className="sp-bar" style={{ width: `${pct(t.cost, t.sales)}%`, background: "var(--stage-2)" }} />
                <span className="sp-bar" style={{ width: `${pct(t.ads, t.sales)}%`, background: "var(--madder)" }} />
                <span className="sp-bar" style={{ width: `${pct(t.fees, t.sales)}%`, background: "var(--faint)" }} />
                <span className="sp-bar" style={{ width: `${Math.max(0, pct(t.net, t.sales))}%`, background: "var(--ok)" }} />
              </span>
            ) : undefined
          }
        />
        <Stat
          label="Ads incl. 18% GST"
          kind="ads"
          href="/pnl#ads-title"
          value={<RupeesCountUp value={Math.round(t?.ads ?? 0)} />}
          sub={`${Math.round(adsShare)}% of revenue${prev && prev.total.sales > 0 ? ` · ${prev.label.split(" ")[0]} ${Math.round((prev.total.ads / prev.total.sales) * 100)}%` : ""}`}
          chart={<Gauge pct={adsShare} tone={adsShare > 15 ? "bad" : adsShare > 10 ? "warn" : "ok"} label={`Ads are ${Math.round(adsShare)}% of revenue`} size={48} />}
        />
        <Stat
          label="To dispatch today"
          kind="orders"
          href="/flipkart?tab=orders"
          value={tc?.due ?? 0}
          aside={
            tc && tc.late > 0 ? (
              <Chip tone="bad" live>
                {formatNumber(tc.late)} late
              </Chip>
            ) : (
              <Chip tone="ok">None late</Chip>
            )
          }
          sub={tc?.avg7 != null ? `7-day avg ${formatNumber(tc.avg7)}/day` : undefined}
          spark={{ values: deck.trend.map((p) => p.orders), tone: "cyan", label: "Orders a day, last 14 days" }}
        />
      </StatStrip>

      {/* 3. Today's signals from the Command Centre, each a link. */}
      {deck.pulses.length ? (
        <StatStrip ariaLabel="Today's signals" className="span-12">
          {deck.pulses.slice(0, 4).map((p) => (
            <Stat key={p.key} label={p.label} value={p.value} sub={p.sub} tone={p.tone === "cyan" ? "accent" : p.tone} href={p.href} spark={{ values: p.spark, tone: p.tone, label: p.sparkLabel }} />
          ))}
        </StatStrip>
      ) : null}

      {/* 4. Orders a day, and where this month's money went. */}
      <Panel title="Orders a day" sub={`Placed on Flipkart, last ${deck.trend.length} days`} href="/flipkart?tab=orders" className="span-7">
        {deck.trend.length >= 2 ? (
          <TrendChart
            data={deck.trend.map((p) => ({ label: p.label, value: p.orders }))}
            avg={tc?.avg7 ?? null}
            avgLabel={tc?.avg7 == null ? "" : `7-day avg ${formatNumber(tc.avg7)}`}
            ariaLabel={`Orders per day: ${deck.trend.map((p) => `${p.label} ${formatNumber(p.orders)}`).join(", ")}`}
          />
        ) : (
          <p className="t-caption py-10 text-center">The graph starts once a few days of orders are saved.</p>
        )}
      </Panel>
      <Panel title="Where the money went" sub={now ? `${now.label}, out of ${short(t?.sales ?? 0)} revenue` : "No P&L yet"} href={now ? `/pnl?month=${now.month}` : "/pnl"} className="span-5">
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
          <p className="t-caption py-10 text-center">Add costs on the P&amp;L page to see this.</p>
        )}
      </Panel>

      {/* 5. Month by month, and the products making and losing money. */}
      <Panel title="Month by month" sub="Revenue, profit after ads and ads" href="/pnl" className="span-7">
        {months.length ? (
          <div className="flex h-56 items-end gap-4">
            {months.map((m, mi) => (
              <Link key={m.month} href={`/pnl?month=${m.month}`} className="focus-ring flex h-full min-w-0 flex-1 flex-col justify-end rounded-[var(--radius)] p-1 transition-colors duration-160 hover:bg-surface2">
                <span className="flex h-full items-end justify-center gap-1.5">
                  {[
                    { v: m.total.sales, c: "var(--accent)", l: "Revenue" },
                    { v: Math.max(0, m.total.net), c: "var(--ok)", l: "Profit" },
                    { v: m.total.ads, c: "var(--madder)", l: "Ads" },
                  ].map((b, bi) => (
                    <span
                      key={b.l}
                      title={`${b.l} ${short(b.v)}`}
                      className="sp-bar-y w-5 rounded-[6px] sm:w-7"
                      style={{ height: `${Math.max(3, (b.v / maxMonth) * 100)}%`, background: barFill(b.c), ["--i" as string]: mi * 3 + bi }}
                    />
                  ))}
                </span>
                <span className="mt-2 block text-center text-xs font-semibold">{m.label.split(" ")[0].slice(0, 3)}</span>
                <span className="block text-center text-[11px] text-faint tabular-nums">{short(m.total.net)}</span>
              </Link>
            ))}
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
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--madder)" }} />
            Ads
          </span>
        </p>
      </Panel>
      <Panel title="Products by profit" sub={now ? `${now.label}, after ads` : ""} href={now ? `/pnl?month=${now.month}` : "/pnl"} className="span-5">
        <ul className="m-0 flex list-none flex-col divide-y divide-line-soft p-0">
          {[...best, ...worst].map((p, i) => (
            <li key={p.id}>
              <Link href={now ? `/pnl?month=${now.month}` : "/pnl"} className="focus-ring grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 rounded-[var(--radius)] py-2 transition-colors duration-160 hover:bg-surface2">
                <span className="truncate text-[13px] font-semibold">{p.name}</span>
                <span className="h-2.5 overflow-hidden rounded-full bg-surface2">
                  <span className="sp-bar block h-full rounded-[6px]" style={{ width: `${(Math.abs(p.net) / maxProduct) * 100}%`, background: barFill(p.net < 0 ? "var(--bad)" : "var(--ok)"), ["--i" as string]: i }} />
                </span>
                <span className={`text-[13px] font-medium tabular-nums ${p.net < 0 ? "text-bad" : "text-ok"}`}>{short(p.net)}</span>
              </Link>
            </li>
          ))}
          {!best.length ? <li className="t-caption py-6 text-center">No products sold yet this month.</li> : null}
        </ul>
      </Panel>

      {/* 6. The flow map, and what needs a look. */}
      <Panel title="Order flow map" sub="To accept, to pack and to dispatch; late orders at the gate" href="/flipkart?tab=orders" className="span-8">
        {lanes.length ? (
          <Lanes lanes={lanes} ariaLabel={`Active orders by warehouse and stage: ${deck.whStages.map((r) => `${r.name}: ${r.to_accept} to accept, ${r.to_pack} to pack, ${r.to_dispatch} to dispatch`).join("; ")}`} />
        ) : (
          <p className="t-caption py-6 text-center">No open orders.</p>
        )}
      </Panel>
      <Panel title="Needs a look" sub={alerts.length ? `${alerts.length} unread alerts` : "Nothing unread"} href="/notifications" className="span-4">
        {alerts.length ? (
          <ul className="item-list m-0 list-none p-0">
            {alerts.map((a) => {
              const tone = KIND_TONE[a.kind] ?? "neutral";
              return (
                <li key={a.id}>
                  <ItemRow
                    href={a.href}
                    icon={tone === "bad" || tone === "warn" ? <AlertIcon /> : <BellIcon />}
                    tint={TONE_TINT[tone]}
                    title={a.title}
                    detail={timeAgo(a.createdAt)}
                    end={<Chip tone={tone}>{NOTIFICATION_ICON_LABEL[a.kind] ?? "Alert"}</Chip>}
                  />
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="t-caption py-6 text-center">All clear: no unread alerts.</p>
        )}
      </Panel>
    </div>
  );
}
