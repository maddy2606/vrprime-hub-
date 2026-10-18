import { AttendancePanel } from "@/components/team/attendance-panel";
import { PeopleTable } from "@/components/team/people-table";
import { TeamTools } from "@/components/team/team-tools";
import { CapacityChart } from "@/components/signal/charts";
import { Chip } from "@/components/ui";
import type { DayPlan, DayStatus, WarehousePlan } from "@/lib/capacity";
import { formatDate, formatNumber } from "@/lib/format";
import type { TeamData, WarehouseView } from "@/server/team-data";

const style = (i: number) => ({ ["--i" as string]: i });

const HERO_BAND: Record<"bad" | "warn" | "ok", string> = { bad: "var(--bad)", warn: "var(--warn)", ok: "var(--ok)" };
const CELL: Record<DayStatus, string> = { ok: "bg-ok-soft text-ok", tight: "bg-warn-soft text-warn", short: "bg-bad-soft text-bad" };
const STATUS_WORD: Record<DayStatus, string> = { ok: "Covered", tight: "Tight", short: "Short" };

/** "Mon 19": the weekday matters when planning shifts. */
function dayHead(day: string): { wd: string; num: string } {
  const d = new Date(`${day}T00:00:00Z`);
  return { wd: d.toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" }), num: String(d.getUTCDate()) };
}

const compact = (n: number) => (n >= 1000 ? `${formatNumber(Math.round(n / 100) / 10)}k` : formatNumber(Math.round(n)));

function worstStatus(days: DayPlan[]): DayStatus {
  return days.some((d) => d.status === "short") ? "short" : days.some((d) => d.status === "tight") ? "tight" : "ok";
}

function planLine(plan: WarehousePlan, today: string): string | null {
  if (plan.extraNeeded <= 0 || !plan.hireBy) return null;
  const when = plan.hireBy <= today ? "now" : `by ${formatDate(plan.hireBy, today)}`;
  return `Plan ${plan.extraNeeded} more ${plan.extraNeeded === 1 ? "person" : "people"} ${when}`;
}

function Hero({ d }: { d: TeamData }) {
  const total = d.total.plan;
  const peak = total.days.reduce<DayPlan | null>((best, x) => (best === null || x.demand > best.demand ? x : best), null);
  return (
    <section className="sp-card sp-card-lg sp-reveal relative overflow-hidden border-t-[5px] p-5 sm:p-7" style={{ ...style(0), borderTopColor: HERO_BAND[d.headline.tone] }} aria-labelledby="team-headline">
      <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Team capacity · next 14 days</p>
      <h1 id="team-headline" className="font-display mt-3 text-[1.7rem] font-semibold leading-[1.15] tracking-tight sm:text-4xl">
        {d.headline.headline}
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted sm:text-base">{d.headline.detail}</p>
      <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-wider text-muted">People</dt>
          <dd className="mt-1 text-2xl font-bold tabular-nums">{formatNumber(d.total.staff)}</dd>
          <dd className="text-xs text-muted">{total.attendanceRate === null ? "attendance not marked yet" : `${Math.round(total.attendanceRate * 100)}% turn up on average`}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-wider text-muted">Orders a day they can pack</dt>
          <dd className="mt-1 text-2xl font-bold tabular-nums">
            {compact(total.comfortable)} <span className="text-base font-semibold text-muted">to {compact(total.limit)}</span>
          </dd>
          <dd className="text-xs text-muted">{formatNumber(d.settings.low)} to {formatNumber(d.settings.high)} a person</dd>
        </div>
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-wider text-muted">Busiest day expected</dt>
          <dd className="mt-1 text-2xl font-bold tabular-nums">{peak && peak.demand > 0 ? formatNumber(peak.demand) : "—"}</dd>
          <dd className="text-xs text-muted">{peak && peak.demand > 0 ? `orders on ${formatDate(peak.day, d.today)}` : "no orders expected yet"}</dd>
        </div>
      </dl>
    </section>
  );
}

function WarehouseCard({ w, d, index }: { w: WarehouseView; d: TeamData; index: number }) {
  const p = w.plan;
  const status = p.staff === 0 ? null : worstStatus(p.days);
  const f = p.forecast;
  const scale = Math.max(p.limit * 1.15, w.average ?? 0, 1);
  const avgStatus: DayStatus = (w.average ?? 0) <= p.comfortable ? "ok" : (w.average ?? 0) <= p.limit ? "tight" : "short";
  const plan = p.staff > 0 ? planLine(p, d.today) : null;
  const first = status === "short" ? p.firstShort : p.firstPressure;
  return (
    <article className="sp-card sp-reveal flex flex-col gap-3 p-4" style={style(index + 1)} aria-label={`${w.name} capacity`}>
      <header className="flex items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-bold">
          <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: w.color }} />
          <span className="truncate">{w.name}</span>
        </h3>
        {status === null ? <Chip tone="neutral">No people added</Chip> : status === "ok" ? <Chip tone="ok">Covered</Chip> : <Chip tone={status === "short" ? "bad" : "warn"}>{STATUS_WORD[status]} from {formatDate(first ?? d.today, d.today)}</Chip>}
      </header>

      <dl className="grid grid-cols-3 gap-2 text-center">
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-wider text-muted">People</dt>
          <dd className="font-mono text-lg font-bold tabular-nums">{w.staff}</dd>
          <dd className="text-[11px] text-muted">{w.marked > 0 ? `${w.inToday} in today` : "not marked"}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-wider text-muted">Yesterday</dt>
          <dd className="font-mono text-lg font-bold tabular-nums">{w.yesterday === null ? "—" : formatNumber(w.yesterday)}</dd>
          <dd className="text-[11px] text-muted">orders</dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-wider text-muted">7-day avg</dt>
          <dd className="font-mono text-lg font-bold tabular-nums">{w.average === null ? "—" : formatNumber(w.average)}</dd>
          <dd className="text-[11px] text-muted">{f.ready && f.weeklyChangePct !== null ? `${f.weeklyChangePct >= 0 ? "▲" : "▼"} ${Math.abs(Math.round(f.weeklyChangePct))}% on last week` : "orders a day"}</dd>
        </div>
      </dl>

      {p.staff > 0 && w.average !== null ? (
        <div>
          <div className="relative h-2.5 rounded-full bg-line-soft" role="img" aria-label={`Average ${formatNumber(w.average)} orders a day against comfortable ${formatNumber(p.comfortable)} and most ${formatNumber(p.limit)}`}>
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, (w.average / scale) * 100)}%`, background: avgStatus === "ok" ? "var(--ok)" : avgStatus === "tight" ? "var(--warn-mark)" : "var(--bad)" }} />
            <span aria-hidden="true" className="absolute -top-1 h-4 w-0.5 bg-ink/50" style={{ left: `${(p.comfortable / scale) * 100}%` }} />
            <span aria-hidden="true" className="absolute -top-1 h-4 w-0.5 bg-bad" style={{ left: `${(p.limit / scale) * 100}%` }} />
          </div>
          <p className="mt-1.5 text-[11px] text-muted">Comfortable up to {formatNumber(p.comfortable)}, the most {formatNumber(p.limit)} a day</p>
        </div>
      ) : null}

      {plan ? <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm font-bold text-warn">{plan}</p> : null}
      {!f.ready && p.staff > 0 ? <p className="text-[11px] text-muted">Trend starts after {f.needDays} days of orders ({f.haveDays} so far).</p> : null}
    </article>
  );
}

function StatusGrid({ d }: { d: TeamData }) {
  const rows = [
    ...d.warehouses.filter((w) => w.staff > 0).map((w) => ({ key: w.id, name: w.name, color: w.color, now: w.plan.now, days: w.plan.days })),
    { key: "all", name: "All warehouses", color: "var(--ink)", now: d.total.plan.now, days: d.total.plan.days },
  ];
  const heads = d.total.plan.days.map((x) => dayHead(x.day));
  const todayHead = dayHead(d.today);
  return (
    // min-w-0: without it the wide table stretches the card, and the whole page, past a phone's width.
    <section className="sp-card sp-reveal min-w-0 p-4 sm:p-5" style={style(8)} aria-labelledby="grid-title">
      <header className="mb-3">
        <h2 id="grid-title" className="font-display text-lg font-semibold">Day by day, per warehouse</h2>
        <p className="text-xs text-muted">
          Today is the orders already due to go out today; the other days are expected orders. Green is covered, amber is tight, red is more than the team can
          pack.<span className="sm:hidden"> Swipe for more days.</span>
        </p>
      </header>
      {/* relative: the screen-reader words in each cell are positioned absolutely; this keeps them inside the scrolling box. */}
      <div className="relative -mx-4 overflow-x-auto overscroll-x-contain px-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[47rem] border-separate border-spacing-[3px] text-center text-xs">
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 w-28 bg-surface text-left text-[11px] font-bold text-muted"><span className="sr-only">Warehouse</span></th>
              <th scope="col" className="pb-1 text-[11px] font-bold text-accent-text">
                <span className="block">Today</span>
                <span className="block font-mono tabular-nums">{todayHead.num}</span>
              </th>
              {heads.map((h, i) => (
                <th key={i} scope="col" className="pb-1 text-[11px] font-bold text-muted">
                  <span className="block">{h.wd}</span>
                  <span className="block font-mono tabular-nums">{h.num}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row" className="sticky left-0 z-10 bg-surface pr-1 text-left text-sm font-bold">
                  <span className="flex items-center gap-2">
                    <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
                    <span className="truncate">{r.name}</span>
                  </span>
                </th>
                <td
                  title={`${r.name}, today: ${formatNumber(r.now.demand)} orders already due to go out. ${STATUS_WORD[r.now.status]}${r.now.extra ? `, ${r.now.extra} more people needed` : ""}`}
                  className={`h-11 rounded-md font-mono text-[12px] font-bold tabular-nums ring-2 ring-inset ring-accent/50 ${CELL[r.now.status]}`}
                >
                  {r.now.demand > 0 ? compact(r.now.demand) : "·"}
                  <span className="sr-only"> due today, {STATUS_WORD[r.now.status]}</span>
                </td>
                {r.days.map((x) => (
                  <td key={x.day} title={`${r.name}, ${formatDate(x.day, d.today)}: ${formatNumber(x.demand)} orders${x.booked > x.orders ? ` (${formatNumber(x.booked)} already booked)` : ""}. ${STATUS_WORD[x.status]}${x.extra ? `, ${x.extra} more people needed` : ""}`} className={`h-11 rounded-md font-mono text-[12px] font-bold tabular-nums ${CELL[x.status]}`}>
                    {x.demand > 0 ? compact(x.demand) : "·"}
                    <span className="sr-only"> {STATUS_WORD[x.status]}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DemandChart({ d }: { d: TeamData }) {
  const total = d.total.plan;
  const short = (day: string) => formatDate(day, d.today);
  const future = total.days.map((x) => ({ label: short(x.day), value: x.demand }));
  const past = d.past.map((x) => ({ label: short(x.day), value: x.orders }));
  return (
    <section className="sp-card sp-reveal p-4 sm:p-5" style={style(7)} aria-labelledby="demand-title">
      <header className="mb-4">
        <h2 id="demand-title" className="font-display text-lg font-semibold">Orders against what the team can pack</h2>
        <p className="text-xs text-muted">All warehouses together. The dashed line is what to expect; the two flat lines are your team.</p>
      </header>
      {d.total.staff === 0 ? (
        <p className="py-10 text-center text-sm text-muted">Add your team to see how orders compare with capacity.</p>
      ) : d.noOrders && !total.days.some((x) => x.demand > 0) ? (
        <p className="py-10 text-center text-sm text-muted">No orders are saved yet. The chart starts once the first order run has finished.</p>
      ) : (
        <CapacityChart
          past={past}
          future={future}
          comfortable={total.comfortable}
          limit={total.limit}
          ariaLabel={`Orders per day. Last 14 days then the next 14. Team packs ${formatNumber(total.comfortable)} comfortably and ${formatNumber(total.limit)} at most. Busiest expected day ${formatNumber(Math.max(0, ...total.days.map((x) => x.demand)))}.`}
        />
      )}
    </section>
  );
}

/** The whole Team page, from loaded data. */
export function TeamBoard({ d }: { d: TeamData }) {
  const people = d.people.filter((p) => p.active);
  return (
    <div className="flex min-w-0 flex-col gap-5 [&>*]:min-w-0">
      <Hero d={d} />
      {d.total.staff === 0 && d.isOwner ? (
        <section className="sp-card p-4 sm:p-5">
          <h2 className="font-display text-lg font-semibold">Start by adding your team</h2>
          <p className="mb-3 text-sm text-muted">Import the staff Excel sheet: warehouse names over the people, one column each, and a Total Salary row.</p>
          <TeamTools warehouses={d.warehouses.map((w) => ({ id: w.id, name: w.name }))} settings={d.settings} />
        </section>
      ) : null}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {d.warehouses.map((w, i) => (
          <WarehouseCard key={w.id} w={w} d={d} index={i} />
        ))}
      </div>
      <DemandChart d={d} />
      <StatusGrid d={d} />
      <AttendancePanel
        day={d.day}
        today={d.today}
        warehouses={d.warehouses.filter((w) => w.staff > 0).map((w) => ({ id: w.id, name: w.name, color: w.color }))}
        people={people.map((p) => ({ id: p.id, name: p.name, warehouseId: p.warehouseId, status: p.status }))}
      />
      <PeopleTable
        monthLabel={d.monthLabel}
        isOwner={d.isOwner}
        warehouses={d.warehouses.map((w) => ({ id: w.id, name: w.name, color: w.color }))}
        people={d.people}
      />
      {d.isOwner && d.total.staff > 0 ? (
        <section className="sp-card p-4 sm:p-5" aria-labelledby="tools-title">
          <h2 id="tools-title" className="font-display mb-3 text-lg font-semibold">Owner tools</h2>
          <TeamTools warehouses={d.warehouses.map((w) => ({ id: w.id, name: w.name }))} settings={d.settings} />
        </section>
      ) : null}
    </div>
  );
}
