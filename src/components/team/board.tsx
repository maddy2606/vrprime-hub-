import { AttendancePanel } from "@/components/team/attendance-panel";
import { PeopleTable } from "@/components/team/people-table";
import { TeamTools } from "@/components/team/team-tools";
import { CapacityChart } from "@/components/signal/charts";
import { Chip } from "@/components/ui";
import type { DayStatus, Suggestion } from "@/lib/capacity";
import { formatDate, formatNumber } from "@/lib/format";
import type { TeamData, WarehouseView } from "@/server/team-data";

// Real orders only: the last 14 days and today so far. Nothing on this page is a prediction.

const style = (i: number) => ({ ["--i" as string]: i });

const HERO_BAND: Record<"bad" | "warn" | "ok", string> = { bad: "var(--bad)", warn: "var(--warn)", ok: "var(--ok)" };
const CELL: Record<DayStatus, string> = { ok: "bg-ok-soft text-ok", tight: "bg-warn-soft text-warn", short: "bg-bad-soft text-bad" };
const STATUS_WORD: Record<DayStatus, string> = { ok: "Within capacity", tight: "Tight", short: "Over capacity" };
const SUGGEST_TONE: Record<Suggestion["tone"], string> = {
  bad: "border-bad/40 bg-bad-soft text-bad",
  warn: "border-warn/40 bg-warn-soft text-warn",
  ok: "border-ok/40 bg-ok-soft text-ok",
  info: "border-line bg-surface2/60 text-ink",
};

/** "Mon 19": the weekday matters when planning shifts. */
function dayHead(day: string): { wd: string; num: string } {
  const d = new Date(`${day}T00:00:00Z`);
  return { wd: d.toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" }), num: String(d.getUTCDate()) };
}

const compact = (n: number) => (n >= 1000 ? `${formatNumber(Math.round(n / 100) / 10)}k` : formatNumber(Math.round(n)));

function worstOf(days: { status: DayStatus }[]): DayStatus {
  return days.some((d) => d.status === "short") ? "short" : days.some((d) => d.status === "tight") ? "tight" : "ok";
}

function Hero({ d }: { d: TeamData }) {
  const total = d.total.plan;
  const bad = d.suggestions.filter((x) => x.tone === "bad").length;
  const warn = d.suggestions.filter((x) => x.tone === "warn").length;
  const tone: "bad" | "warn" | "ok" = bad ? "bad" : warn ? "warn" : "ok";
  const headline = bad
    ? `${bad} ${bad === 1 ? "thing needs" : "things need"} a look now`
    : warn
      ? "Busy days at some warehouses"
      : "Every warehouse stayed within what its team packs";
  const busiest = d.allDays.reduce<{ day: string; orders: number } | null>((best, x) => (best === null || x.orders > best.orders ? x : best), null);
  return (
    <section className="sp-card sp-card-lg sp-reveal relative overflow-hidden border-t-[5px] p-5 sm:p-7" style={{ ...style(0), borderTopColor: HERO_BAND[tone] }} aria-labelledby="team-headline">
      <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Team · last 14 days</p>
      <h1 id="team-headline" className="font-display mt-3 text-[1.7rem] font-semibold leading-[1.15] tracking-tight sm:text-4xl">
        {headline}
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted sm:text-base">Real orders only, no predictions. The suggestions below say what stands out.</p>
      <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
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
          <dt className="text-[11px] font-bold uppercase tracking-wider text-muted">Busiest day</dt>
          <dd className="mt-1 text-2xl font-bold tabular-nums">{busiest && busiest.orders > 0 ? formatNumber(busiest.orders) : "—"}</dd>
          <dd className="text-xs text-muted">{busiest && busiest.orders > 0 ? `orders on ${formatDate(busiest.day, d.today)}` : "no orders saved yet"}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-wider text-muted">Today so far</dt>
          <dd className="mt-1 text-2xl font-bold tabular-nums">{formatNumber(d.allToday)}</dd>
          <dd className={`text-xs ${d.allLate ? "font-bold text-bad" : "text-muted"}`}>{d.allLate ? `${formatNumber(d.allLate)} past dispatch time` : "orders placed"}</dd>
        </div>
      </dl>
    </section>
  );
}

/** What stands out in the last two weeks, most urgent first. */
function Suggestions({ d }: { d: TeamData }) {
  return (
    <section className="sp-card sp-reveal p-4 sm:p-5" style={style(1)} aria-labelledby="suggest-title">
      <h2 id="suggest-title" className="font-display text-lg font-semibold">Suggestions</h2>
      <p className="mb-3 text-xs text-muted">Worked out from the last 14 days of real orders, the team and attendance. Nothing here is a prediction.</p>
      {d.suggestions.length ? (
        <ul className="flex flex-col gap-2">
          {d.suggestions.map((x, i) => (
            <li key={i} className={`rounded-xl border px-3 py-2 text-sm font-semibold ${SUGGEST_TONE[x.tone]}`}>
              {x.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl bg-ok-soft px-3 py-4 text-center text-sm font-semibold text-ok">Nothing stands out: every warehouse packed within its team&apos;s capacity.</p>
      )}
    </section>
  );
}

function WarehouseCard({ w, index }: { w: WarehouseView; index: number }) {
  const p = w.plan;
  const week = w.pastDays.slice(-7);
  const status = p.staff === 0 ? null : worstOf(week);
  const busyDays = week.filter((x) => x.status !== "ok").length;
  const scale = Math.max(p.limit * 1.15, w.average ?? 0, 1);
  const avgStatus: DayStatus = (w.average ?? 0) <= p.comfortable ? "ok" : (w.average ?? 0) <= p.limit ? "tight" : "short";
  return (
    <article className="sp-card sp-reveal flex flex-col gap-3 p-4" style={style(index + 2)} aria-label={`${w.name}, last 7 days`}>
      <header className="flex items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-bold">
          <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: w.color }} />
          <span className="truncate">{w.name}</span>
        </h3>
        {status === null ? (
          <Chip tone="neutral">No people added</Chip>
        ) : status === "ok" ? (
          <Chip tone="ok">Covered all week</Chip>
        ) : (
          <Chip tone={status === "short" ? "bad" : "warn"}>
            {status === "short" ? "Over capacity" : "Tight"} on {busyDays} of 7 days
          </Chip>
        )}
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
          <dd className="text-[11px] text-muted">
            {w.weeklyChangePct !== null ? `${w.weeklyChangePct >= 0 ? "▲" : "▼"} ${Math.abs(Math.round(w.weeklyChangePct))}% on the week before` : "orders a day"}
          </dd>
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

      {w.late > 0 ? (
        <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm font-bold text-bad">
          {formatNumber(w.late)} {w.late === 1 ? "order is" : "orders are"} past dispatch time
        </p>
      ) : null}
    </article>
  );
}

function StatusGrid({ d }: { d: TeamData }) {
  const rows = [
    ...d.warehouses.map((w) => ({ key: w.id, name: w.name, color: w.color, hasTeam: w.staff > 0, days: w.pastDays, today: w.todaySoFar, late: w.late })),
    { key: "all", name: "All warehouses", color: "var(--ink)", hasTeam: d.total.staff > 0, days: d.allDays, today: d.allToday, late: d.allLate },
  ];
  const heads = d.allDays.map((x) => dayHead(x.day));
  const todayHead = dayHead(d.today);
  return (
    // min-w-0: without it the wide table stretches the card, and the whole page, past a phone's width.
    <section className="sp-card sp-reveal min-w-0 p-4 sm:p-5" style={style(8)} aria-labelledby="grid-title">
      <header className="mb-3">
        <h2 id="grid-title" className="font-display text-lg font-semibold">Day by day, per warehouse</h2>
        <p className="text-xs text-muted">
          Orders placed each day over the last 14 days, then today so far. Green is within what the team packs comfortably, amber is tight, red is more than the
          team can pack. Grey rows have no people added.<span className="sm:hidden"> Swipe for more days.</span>
        </p>
      </header>
      {/* relative: the screen-reader words in each cell are positioned absolutely; this keeps them inside the scrolling box. */}
      <div className="relative -mx-4 overflow-x-auto overscroll-x-contain px-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[47rem] border-separate border-spacing-[3px] text-center text-xs">
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 w-28 bg-surface text-left text-[11px] font-bold text-muted">
                <span className="sr-only">Warehouse</span>
              </th>
              {heads.map((h, i) => (
                <th key={i} scope="col" className="pb-1 text-[11px] font-bold text-muted">
                  <span className="block">{h.wd}</span>
                  <span className="block font-mono tabular-nums">{h.num}</span>
                </th>
              ))}
              <th scope="col" className="pb-1 text-[11px] font-bold text-accent-text">
                <span className="block">Today</span>
                <span className="block font-mono tabular-nums">{todayHead.num}</span>
              </th>
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
                {r.days.map((x) => (
                  <td
                    key={x.day}
                    title={`${r.name}, ${formatDate(x.day, d.today)}: ${formatNumber(x.orders)} orders placed.${r.hasTeam ? ` ${STATUS_WORD[x.status]}` : ""}`}
                    className={`h-11 rounded-md font-mono text-[12px] font-bold tabular-nums ${r.hasTeam ? CELL[x.status] : "bg-surface2 text-muted"}`}
                  >
                    {x.orders > 0 ? compact(x.orders) : "·"}
                    {r.hasTeam ? <span className="sr-only"> {STATUS_WORD[x.status]}</span> : null}
                  </td>
                ))}
                <td
                  title={`${r.name}, today so far: ${formatNumber(r.today)} orders placed${r.late ? `; ${formatNumber(r.late)} past dispatch time` : ""}`}
                  className="h-11 rounded-md bg-accent-soft font-mono text-[12px] font-bold tabular-nums text-accent-text ring-2 ring-inset ring-accent/50"
                >
                  {r.today > 0 ? compact(r.today) : "·"}
                  {r.late ? <span className="block text-[10px] font-bold text-bad">{compact(r.late)} late</span> : null}
                  <span className="sr-only"> placed so far today</span>
                </td>
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
  const past = d.allDays.map((x) => ({ label: formatDate(x.day, d.today), value: x.orders }));
  return (
    <section className="sp-card sp-reveal p-4 sm:p-5" style={style(7)} aria-labelledby="demand-title">
      <header className="mb-4">
        <h2 id="demand-title" className="font-display text-lg font-semibold">Orders against what the team can pack</h2>
        <p className="text-xs text-muted">All warehouses together, the last 14 days. The two flat lines are your team.</p>
      </header>
      {d.total.staff === 0 ? (
        <p className="py-10 text-center text-sm text-muted">Add your team to see how orders compare with capacity.</p>
      ) : d.noOrders ? (
        <p className="py-10 text-center text-sm text-muted">No orders are saved yet. The chart starts once the first order run has finished.</p>
      ) : (
        <CapacityChart
          past={past}
          future={[]}
          comfortable={total.comfortable}
          limit={total.limit}
          ariaLabel={`Orders per day, the last 14 days. Team packs ${formatNumber(total.comfortable)} comfortably and ${formatNumber(total.limit)} at most. Busiest day ${formatNumber(Math.max(0, ...d.allDays.map((x) => x.orders)))}.`}
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
      <Suggestions d={d} />
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {d.warehouses.map((w, i) => (
          <WarehouseCard key={w.id} w={w} index={i} />
        ))}
      </div>
      <StatusGrid d={d} />
      <DemandChart d={d} />
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
