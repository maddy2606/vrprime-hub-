import { AttendancePanel } from "@/components/team/attendance-panel";
import { PeopleTable } from "@/components/team/people-table";
import { TeamTools } from "@/components/team/team-tools";
import { CapacityChart } from "@/components/signal/charts";
import { UsersIcon } from "@/components/icons";
import { Chip, ItemRow, Stat, StatStrip, TONE_TINT, withNumbers } from "@/components/ui";
import type { DayStatus } from "@/lib/capacity";
import { formatDate, formatNumber } from "@/lib/format";
import type { TeamData, WarehouseView } from "@/server/team-data";

// Real orders only: the last 14 days and today so far. Nothing on this page is a prediction.


const CELL: Record<DayStatus, string> = { ok: "bg-ok-soft text-ok", tight: "bg-warn-soft text-warn", short: "bg-bad-soft text-bad" };
const STATUS_WORD: Record<DayStatus, string> = { ok: "Within capacity", tight: "Tight", short: "Over capacity" };

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
    <section className="span-12" aria-labelledby="team-headline">
      <h1 id="team-headline" className="t-h1">
        Team
      </h1>
      <p className="t-headline mt-1">{withNumbers(headline, tone)}</p>
      <p className="t-caption mt-1">Last 14 days. Real orders only, no predictions. The suggestions below say what stands out.</p>
      <StatStrip className="mt-4" ariaLabel="The team in figures">
        <Stat label="People" value={d.total.staff} sub={total.attendanceRate === null ? "attendance not marked yet" : `${Math.round(total.attendanceRate * 100)}% turn up on average`} />
        <Stat
          label="Orders a day they can pack"
          value={
            <>
              {compact(total.comfortable)} <span className="t-caption">to {compact(total.limit)}</span>
            </>
          }
          sub={`${formatNumber(d.settings.low)} to ${formatNumber(d.settings.high)} a person`}
        />
        <Stat
          label="Busiest day"
          value={busiest && busiest.orders > 0 ? formatNumber(busiest.orders) : "—"}
          sub={busiest && busiest.orders > 0 ? `orders on ${formatDate(busiest.day, d.today)}` : "no orders saved yet"}
        />
        <Stat label="Today so far" value={formatNumber(d.allToday)} sub={d.allLate ? <span className="font-semibold text-bad">{formatNumber(d.allLate)} past dispatch time</span> : "orders placed"} />
      </StatStrip>
    </section>
  );
}

/** What stands out in the last two weeks, most urgent first. */
function Suggestions({ d }: { d: TeamData }) {
  return (
    <section className="sp-card span-12 overflow-hidden" aria-labelledby="suggest-title">
      <div className="g-pad pb-3">
        <h2 id="suggest-title" className="t-card-title">Suggestions</h2>
        <p className="t-caption mt-1">Worked out from the last 14 days of real orders, the team and attendance. Nothing here is a prediction.</p>
      </div>
      {d.suggestions.length ? (
        <ul className="item-list m-0 list-none px-[18px] pb-[18px] max-[699.98px]:px-[14px] max-[699.98px]:pb-[14px]">
          {d.suggestions.map((x, i) => (
            <li key={i}>
              <ItemRow icon={<UsersIcon />} tint={TONE_TINT[x.tone]} title={x.text} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="tone-row tone-ok border-t border-line-soft">
          <span className="tone-row-title">Nothing stands out: every warehouse packed within its team&apos;s capacity.</span>
        </p>
      )}
    </section>
  );
}

function WarehouseCard({ w, index }: { w: WarehouseView; index: number }) {
  const p = w.plan;
  const week = w.pastDays.slice(-7);
  const status = p.staff === 0 ? null : worstOf(week);
  const busyDays = week.filter((x) => x.status === status).length;
  const scale = Math.max(p.limit * 1.15, w.average ?? 0, 1);
  const avgStatus: DayStatus = (w.average ?? 0) <= p.comfortable ? "ok" : (w.average ?? 0) <= p.limit ? "tight" : "short";
  return (
    <article className="sp-card g-pad flex flex-col gap-3" data-i={index} aria-label={`${w.name}, last 7 days`}>
      <header className="flex items-center justify-between gap-2">
        <h3 className="t-card-title flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className="wh-dot" style={{ background: w.color, color: w.color }} />
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

      <dl className="grid grid-cols-3 gap-2">
        <div>
          <dt className="t-label">People</dt>
          <dd className="mt-1 font-display text-[20px] font-semibold tabular-nums">{w.staff}</dd>
          <dd className="t-caption">{w.marked > 0 ? `${w.inToday} in today` : "not marked"}</dd>
        </div>
        <div>
          <dt className="t-label">Yesterday</dt>
          <dd className="mt-1 font-display text-[20px] font-semibold tabular-nums">{w.yesterday === null ? "—" : formatNumber(w.yesterday)}</dd>
          <dd className="t-caption">orders</dd>
        </div>
        <div>
          <dt className="t-label">7-day avg</dt>
          <dd className="mt-1 font-display text-[20px] font-semibold tabular-nums">{w.average === null ? "—" : formatNumber(w.average)}</dd>
          <dd className="t-caption">
            {w.weeklyChangePct !== null ? `${w.weeklyChangePct >= 0 ? "▲" : "▼"} ${Math.abs(Math.round(w.weeklyChangePct))}% on the week before` : "orders a day"}
          </dd>
        </div>
      </dl>

      {p.staff > 0 && w.average !== null ? (
        <div>
          <div className="g-track relative overflow-visible" role="img" aria-label={`Average ${formatNumber(w.average)} orders a day against comfortable ${formatNumber(p.comfortable)} and most ${formatNumber(p.limit)}`}>
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, (w.average / scale) * 100)}%`, background: avgStatus === "ok" ? "var(--ok)" : avgStatus === "tight" ? "var(--warn-mark)" : "var(--bad)" }} />
            <span aria-hidden="true" className="absolute -top-1 h-4 w-0.5 bg-muted" style={{ left: `${(p.comfortable / scale) * 100}%` }} />
            <span aria-hidden="true" className="absolute -top-1 h-4 w-0.5 bg-bad" style={{ left: `${(p.limit / scale) * 100}%` }} />
          </div>
          <p className="t-caption mt-1.5">Comfortable up to {formatNumber(p.comfortable)}, the most {formatNumber(p.limit)} a day</p>
        </div>
      ) : null}

      {w.late > 0 ? (
        <p className="sp-inner tone-row tone-bad">
          <span className="tone-row-title">
            {formatNumber(w.late)} {w.late === 1 ? "order is" : "orders are"} past dispatch time
          </span>
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
    <section className="sp-card g-pad span-12 min-w-0" aria-labelledby="grid-title">
      <header className="g-head">
        <h2 id="grid-title" className="t-card-title">Day by day, per warehouse</h2>
        <p className="t-caption mt-1">
          Orders placed each day over the last 14 days, then today so far. Green is within what the team packs comfortably, amber is tight, red is more than the
          team can pack. Grey rows have no people added.<span className="sm:hidden"> Swipe for more days.</span>
        </p>
      </header>
      {/* relative: the screen-reader words in each cell are positioned absolutely; this keeps them inside the scrolling box. */}
      <div className="relative -mx-3 min-[700px]:-mx-4 overflow-x-auto overscroll-x-contain px-3 min-[700px]:px-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[47rem] border-separate border-spacing-[3px] text-center text-xs">
          <thead>
            <tr>
              <th scope="col" className="t-label sticky left-0 z-10 w-28 bg-surface text-left">
                <span className="sr-only">Warehouse</span>
              </th>
              {heads.map((h, i) => (
                <th key={i} scope="col" className="t-label pb-1">
                  <span className="block">{h.wd}</span>
                  <span className="block tabular-nums">{h.num}</span>
                </th>
              ))}
              <th scope="col" className="t-label pb-1 !text-accent-text">
                <span className="block">Today</span>
                <span className="block tabular-nums">{todayHead.num}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row" className="t-body sticky left-0 z-10 bg-surface pr-1 text-left font-semibold">
                  <span className="flex items-center gap-2">
                    <span aria-hidden="true" className="wh-dot" style={{ background: r.color, color: r.color }} />
                    <span className="truncate">{r.name}</span>
                  </span>
                </th>
                {r.days.map((x) => (
                  <td
                    key={x.day}
                    title={`${r.name}, ${formatDate(x.day, d.today)}: ${formatNumber(x.orders)} orders placed.${r.hasTeam ? ` ${STATUS_WORD[x.status]}` : ""}`}
                    className={`h-11 rounded-md text-[12px] font-semibold tabular-nums ${r.hasTeam ? CELL[x.status] : "bg-surface2 text-muted"}`}
                  >
                    {x.orders > 0 ? compact(x.orders) : "·"}
                    {r.hasTeam ? <span className="sr-only"> {STATUS_WORD[x.status]}</span> : null}
                  </td>
                ))}
                <td
                  title={`${r.name}, today so far: ${formatNumber(r.today)} orders placed${r.late ? `; ${formatNumber(r.late)} past dispatch time` : ""}`}
                  className="h-11 rounded-md bg-accent-soft text-[12px] font-semibold tabular-nums text-accent-text ring-1 ring-inset ring-accent"
                >
                  {r.today > 0 ? compact(r.today) : "·"}
                  {r.late ? <span className="block text-[10px] font-semibold text-bad">{compact(r.late)} late</span> : null}
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
    <section className="sp-card g-pad span-7" aria-labelledby="demand-title">
      <header className="g-head">
        <h2 id="demand-title" className="t-card-title">Orders against what the team can pack</h2>
        <p className="t-caption mt-1">All warehouses together, the last 14 days. The two flat lines are your team.</p>
      </header>
      {d.total.staff === 0 ? (
        <p className="t-caption py-10 text-center">Add your team to see how orders compare with capacity.</p>
      ) : d.noOrders ? (
        <p className="t-caption py-10 text-center">No orders are saved yet. The chart starts once the first order run has finished.</p>
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
    <div className="g-grid vr-stagger items-start">
      <Hero d={d} />
      {d.total.staff === 0 && d.isOwner ? (
        <section className="sp-card g-pad span-12">
          <h2 className="t-card-title">Start by adding your team</h2>
          <p className="t-caption mb-3 mt-1">Import the staff Excel sheet: warehouse names over the people, one column each, and a Total Salary row.</p>
          <TeamTools warehouses={d.warehouses.map((w) => ({ id: w.id, name: w.name }))} settings={d.settings} />
        </section>
      ) : null}
      <Suggestions d={d} />
      <div className="span-5 min-w-0">
        <AttendancePanel
          day={d.day}
          today={d.today}
          warehouses={d.warehouses.filter((w) => w.staff > 0).map((w) => ({ id: w.id, name: w.name, color: w.color }))}
          people={people.map((p) => ({ id: p.id, name: p.name, warehouseId: p.warehouseId, status: p.status }))}
        />
      </div>
      <DemandChart d={d} />
      <div className={`wh-row span-12 ${d.warehouses.length === 5 ? "n5" : ""}`} style={{ ["--n" as string]: d.warehouses.length }}>
        {d.warehouses.map((w, i) => (
          <WarehouseCard key={w.id} w={w} index={i} />
        ))}
      </div>
      <StatusGrid d={d} />
      <div className="span-12 min-w-0">
        <PeopleTable
          monthLabel={d.monthLabel}
          isOwner={d.isOwner}
          warehouses={d.warehouses.map((w) => ({ id: w.id, name: w.name, color: w.color }))}
          people={d.people}
          today={d.today}
        />
      </div>
      {d.isOwner && d.total.staff > 0 ? (
        <section className="span-12" aria-labelledby="tools-title">
          <h2 id="tools-title" className="t-card-title g-head">Owner tools</h2>
          <TeamTools warehouses={d.warehouses.map((w) => ({ id: w.id, name: w.name }))} settings={d.settings} />
        </section>
      ) : null}
    </div>
  );
}
