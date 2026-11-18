"use client";

import { useRouter } from "next/navigation";
import { RefreshIcon, StarIcon, TrendIcon } from "@/components/icons";
import { Gauge, Sparkline } from "@/components/signal/charts";
import { CountUp } from "@/components/signal/count-up";
import { useToast } from "@/components/toast";
import { useId, useMemo, useState, type ReactNode } from "react";
import { buttonClass, Chip, EmptyState, IconBadge, type Tint } from "@/components/ui";
import { formatNumber } from "@/lib/format";
import {
  byDistanceToTarget,
  priorityProgress,
  reviewTotals,
  sortForAttention,
  targetProgress,
  toGo,
  type ReviewLine,
  type ReviewPlatform,
  type ReviewStatus,
} from "@/lib/reviews";

// ---- What the page sends ---------------------------------------------------------------------------------------------

export type ReviewsView = {
  checks: { day: string; note: string | null }[];
  /** The check shown, and the one it is compared with. */
  day: string | null;
  prevDay: string | null;
  lines: ReviewLine[];
  /** Total written reviews per check, oldest first. */
  trend: { day: string; reviews: number; missing: number }[];
};

// ---- Small helpers ---------------------------------------------------------------------------------------------------

const dayShort = (d: string) => new Date(`${d}T12:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
const dayYear = (d: string) => new Date(`${d}T12:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const signed = (n: number | null) => (n == null ? "—" : n > 0 ? `+${formatNumber(n)}` : n < 0 ? `−${formatNumber(-n)}` : "0");
const changeClass = (n: number | null) => (n == null || n === 0 ? "text-muted" : n > 0 ? "text-ok" : "text-bad");
const priorityName = (p: number | null) => (p == null || p === 0 ? "—" : p >= 8 ? "Last" : `P${p}`);
const priorityLong = (p: number) => (p === 0 ? "No priority" : p >= 8 ? "Last" : `Priority ${p}`);
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const compact = (n: number) => (n >= 1000 ? `${formatNumber(Math.round(n / 100) / 10)}k` : formatNumber(Math.round(n)));
const style = (i: number) => ({ ["--i" as string]: i });
const STATUS_TONE: Record<ReviewStatus, "ok" | "warn" | "bad" | "neutral" | "info"> = { Dropped: "bad", Gained: "ok", "No change": "neutral", "Not checked": "warn", New: "info" };

/** Flipkart blue and Shopsy pink, from the validated series slots so they stay apart in both modes. */
const PLATFORM_COLOR: Record<ReviewPlatform, string> = { Flipkart: "var(--wh-2)", Shopsy: "var(--wh-5)" };
const PLATFORMS: ReviewPlatform[] = ["Flipkart", "Shopsy"];

/** Jump to a section once a filter has been set, so a click on a chart shows its links. */
const showLinks = () => document.getElementById("reviews-links")?.scrollIntoView({ behavior: "smooth", block: "start" });

function Section({ id, title, sub, action, index, children }: { id: string; title: string; sub?: string; action?: ReactNode; index: number; children: ReactNode }) {
  return (
    <section id={id} className="sp-card g-pad min-w-0 scroll-mt-20" data-i={index} aria-labelledby={`${id}-title`}>
      <div className="g-head flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="t-card-title">
            {title}
          </h2>
          {sub ? <p className="t-caption mt-1 max-w-2xl">{sub}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function PlatformPill({ platform }: { platform: ReviewPlatform }) {
  return (
    <span
      className="g-chip"
      style={{ background: `color-mix(in srgb, ${PLATFORM_COLOR[platform]} 18%, transparent)` }}
    >
      <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: PLATFORM_COLOR[platform] }} />
      {platform}
    </span>
  );
}

/** The seller SKU, or a clear note when the link's FSN / product ID matches nothing in the catalogue. */
function SkuTag({ l, className = "" }: { l: ReviewLine; className?: string }) {
  return l.sellerSku ? (
    <span className={`truncate font-mono text-ink ${className}`} title={`SKU ${l.sellerSku} · ${l.platform} ID ${l.listingId}`}>
      {l.sellerSku}
    </span>
  ) : (
    <span className={`truncate text-warn ${className}`} title={`No catalogue listing has the ${l.platform} ID ${l.listingId}`}>
      No SKU found
    </span>
  );
}

/** A ring filled to reviews / target, with the review count in the middle. */
function TargetRing({ reviews, target, color, size = 60 }: { reviews: number | null; target: number | null; color: string; size?: number }) {
  const share = target ? Math.min(1, (reviews ?? 0) / target) : 0;
  const done = target != null && target > 0 && (reviews ?? 0) >= target;
  return (
    <span className="relative block shrink-0" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r="42" fill="none" style={{ stroke: "var(--surface2)" }} strokeWidth="11" />
        {share > 0 ? (
          <circle cx="50" cy="50" r="42" fill="none" style={{ stroke: done ? "var(--ok)" : color }} strokeWidth="11" strokeLinecap="round" pathLength={100} strokeDasharray={`${share * 100} 100`} className="sp-gauge-arc" />
        ) : null}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-bold tabular-nums">{reviews == null ? "—" : compact(reviews)}</span>
    </span>
  );
}

// ---- Headline tiles --------------------------------------------------------------------------------------------------

/** A big flat tile. A link to a section, or a plain card. */
/** One KPI card (graphite-spec 4): a 46px icon badge, then the Label and the figures; a link when `href`. */
function Tile({ href, label, index, icon, tint, children }: { href?: string; label: string; glow?: string; index: number; icon: ReactNode; tint: Tint; children: ReactNode }) {
  const inner = (
    <>
      <IconBadge icon={icon} tint={tint} large />
      <span className="kpi-body">
        <span className="flex items-center justify-between gap-2">
          <span className="t-label">{label}</span>
          {href ? (
            <span aria-hidden="true" className="text-muted">
              ↓
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block">{children}</span>
      </span>
    </>
  );
  const cls = "sp-card kpi-card !items-start min-w-0";
  return href ? (
    <a href={href} className={`focus-ring ${cls} transition-colors duration-160 hover:bg-panel2`} data-i={index}>
      {inner}
    </a>
  ) : (
    <div className={cls} data-i={index}>
      {inner}
    </div>
  );
}

function Headline({ view, onPlatform }: { view: ReviewsView; onPlatform: (p: ReviewPlatform) => void }) {
  const { lines, prevDay, trend } = view;
  const t = reviewTotals(lines);
  const goal = targetProgress(lines);
  const near = byDistanceToTarget(lines, "nearest").filter((l) => (toGo(l) ?? 0) <= 10).length;
  const share = pct(goal.have, goal.target);
  return (
    <div className="kpi-row span-12" role="group" aria-label="Reviews in figures">
      <Tile href="#reviews-links" label="Written reviews" index={0} icon={<StarIcon />} tint="violet">
        <CountUp value={t.reviews} className="t-stat block" />
        <span className="t-caption mt-2 flex flex-wrap items-center gap-1.5">
          {prevDay ? <Chip tone={t.change < 0 ? "bad" : t.change > 0 ? "ok" : "neutral"}>{signed(t.change)} since {dayShort(prevDay)}</Chip> : <Chip tone="info">First check</Chip>}
          {t.dropped ? <Chip tone="bad">{t.dropped} lost reviews</Chip> : null}
          <span>{lines.length} links, shared listings once</span>
        </span>
        {trend.length >= 2 ? (
          <span className="mt-2 block">
            <Sparkline values={trend.map((x) => x.reviews)} tone="accent" label="Written reviews at each check" />
          </span>
        ) : null}
      </Tile>

      <Tile href="#reviews-priority" label="Towards targets" index={1} icon={<TrendIcon />} tint="blue">
        <span className="t-stat block text-ok">{share}%</span>
        <span className="g-track mt-3 block" aria-hidden="true">
          <span className="sp-bar" style={{ width: `${share}%` }} />
        </span>
        <span className="t-caption mt-2 block">
          {formatNumber(goal.have)} of the {formatNumber(goal.target)} reviews the targets ask for
        </span>
      </Tile>

      <Tile label="Flipkart vs Shopsy" index={2} icon={<StarIcon />} tint="violet">
        <span className="flex h-3.5 w-full gap-[2px]" aria-hidden="true">
          {PLATFORMS.filter((p) => t.byPlatform[p].reviews > 0).map((p) => (
            <span key={p} className="sp-bar h-full min-w-[3px] first:rounded-l last:rounded-r" style={{ flexGrow: t.byPlatform[p].reviews, flexBasis: 0, background: PLATFORM_COLOR[p] }} />
          ))}
        </span>
        <span className="mt-3 grid gap-1.5">
          {PLATFORMS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                onPlatform(p);
                showLinks();
              }}
              className="focus-ring t-body flex min-h-10 items-center justify-between gap-2 rounded-[var(--radius)] px-1.5 text-left hover:bg-[var(--row-hover)]"
              title={`Show only ${p} links`}
            >
              <span className="flex items-center gap-2 font-semibold">
                <span aria-hidden="true" className="wh-dot" style={{ background: PLATFORM_COLOR[p], color: PLATFORM_COLOR[p] }} />
                {p}
              </span>
              <span className="font-medium tabular-nums">
                {formatNumber(t.byPlatform[p].reviews)} <span className="t-caption">{pct(t.byPlatform[p].reviews, t.reviews)}%</span>
                {prevDay ? <span className={`ml-1.5 text-xs ${changeClass(t.byPlatform[p].change)}`}>{signed(t.byPlatform[p].change)}</span> : null}
              </span>
            </button>
          ))}
        </span>
      </Tile>

      <Tile href="#reviews-closest" label="At target" index={3} icon={<TrendIcon />} tint="blue">
        <span className="flex items-center justify-between gap-3">
          <span className="t-stat block">
            {goal.atTarget}
            <span className="t-caption"> / {goal.links}</span>
          </span>
          <Gauge pct={pct(goal.atTarget, goal.links)} tone="ok" label={`${pct(goal.atTarget, goal.links)}% of links are at target`} />
        </span>
        <span className="t-caption mt-2 flex flex-wrap items-center gap-1.5">
          {near ? <Chip tone="warn">{near} within 10 reviews</Chip> : null}
          {t.notChecked ? <Chip tone="warn">{t.notChecked} not read</Chip> : <span>links with reviews ≥ target</span>}
        </span>
      </Tile>
    </div>
  );
}

// ---- Progress by priority --------------------------------------------------------------------------------------------

function PriorityChart({ lines, priority, onPriority }: { lines: ReviewLine[]; priority: string; onPriority: (p: string) => void }) {
  const rows = priorityProgress(lines).filter((r) => r.target > 0);
  const max = Math.max(1, ...rows.map((r) => r.target));
  return (
    <Section id="reviews-priority" title="Progress by priority" sub="Reviews so far against the sheet's targets, each link capped at its own target. Tap a priority to see its links." index={4}>
      {rows.length ? (
        <ul className="flex flex-col gap-2">
          {rows.map((r, i) => {
            const on = priority === String(r.priority);
            return (
              <li key={r.priority}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    onPriority(on ? "all" : String(r.priority));
                    if (!on) showLinks();
                  }}
                  className={`focus-ring grid min-h-10 w-full grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 rounded-[var(--radius)] px-2 py-1.5 text-left hover:bg-[var(--row-hover)] ${on ? "bg-accent-soft ring-1 ring-inset ring-accent" : ""}`}
                  title={`${priorityLong(r.priority)}: ${formatNumber(r.have)} of ${formatNumber(r.target)} reviews, ${r.atTarget} of ${r.links} links at target`}
                >
                  <span className="tabular-nums text-sm font-bold">{priorityName(r.priority)}</span>
                  <span className="block h-3.5 min-w-0">
                    <span className="flex h-full overflow-hidden rounded-full bg-surface2" style={{ width: `${Math.max(6, (r.target / max) * 100)}%` }}>
                      <span className="sp-bar block h-full rounded-full" style={{ ...style(i), width: `${pct(r.have, r.target)}%`, background: r.have >= r.target ? "var(--ok)" : "linear-gradient(90deg, var(--accent), var(--cyan))" }} />
                    </span>
                  </span>
                  <span className="whitespace-nowrap text-right text-xs tabular-nums">
                    <b className="text-sm">{pct(r.have, r.target)}%</b>
                    <span className="block text-muted">
                      {r.atTarget}/{r.links} done
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="t-caption py-8 text-center">No targets on the sheet yet.</p>
      )}
      <p className="t-caption mt-3">Bar length is the priority&apos;s total target; the fill is how much of it is reached.</p>
    </Section>
  );
}

// ---- Nearest and furthest from target --------------------------------------------------------------------------------

function ClosestChart({ lines }: { lines: ReviewLine[] }) {
  const [order, setOrder] = useState<"nearest" | "furthest">("nearest");
  const [all, setAll] = useState(false);
  const list = byDistanceToTarget(lines, order);
  const shown = all ? list : list.slice(0, 10);
  return (
    <Section
      id="reviews-closest"
      title={order === "nearest" ? "Nearly there" : "Furthest away"}
      sub={order === "nearest" ? "Links short of target, fewest reviews to go first: the quick wins." : "Links with the most reviews still to go."}
      index={5}
      action={
        <div role="group" aria-label="Order" className="seg">
          {(["nearest", "furthest"] as const).map((o) => (
            <button key={o} type="button" aria-pressed={order === o} onClick={() => setOrder(o)} className="seg-opt">
              {o === "nearest" ? "Nearly there" : "Furthest"}
            </button>
          ))}
        </div>
      }
    >
      {shown.length ? (
        <ul className="flex flex-col gap-2.5">
          {shown.map((l, i) => {
            const go = toGo(l) ?? 0;
            return (
              <li key={l.rowNo}>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="focus-ring grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_auto] items-center gap-3 rounded-[var(--radius)] px-1 py-0.5 hover:bg-[var(--row-hover)] sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto]"
                  title={`${l.product} (${l.platform}): ${formatNumber(l.reviews ?? 0)} of ${formatNumber(l.target ?? 0)}. Opens the listing.`}
                >
                  <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                    <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PLATFORM_COLOR[l.platform] }} />
                    <span className="truncate">{l.product}</span>
                  </span>
                  <span className="h-2.5 overflow-hidden rounded-full bg-surface2">
                    <span className="sp-bar block h-full rounded-full" style={{ ...style(i), width: `${pct(l.reviews ?? 0, l.target ?? 1)}%`, background: PLATFORM_COLOR[l.platform] }} />
                  </span>
                  <span className="whitespace-nowrap text-right text-xs tabular-nums">
                    <b className={`text-sm ${order === "nearest" && go <= 10 ? "text-warn" : ""}`}>{formatNumber(go)} to go</b>
                    <span className="block text-muted">
                      {formatNumber(l.reviews ?? 0)}/{formatNumber(l.target ?? 0)}
                    </span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="sp-inner tone-row tone-ok"><span className="tone-row-title">Every link shown is at its target.</span></p>
      )}
      <div className="t-caption mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap gap-3">
          {PLATFORMS.map((p) => (
            <span key={p} className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded" style={{ background: PLATFORM_COLOR[p] }} />
              {p}
            </span>
          ))}
        </span>
        {list.length > 10 ? (
          <button type="button" className={buttonClass("ghost")} onClick={() => setAll((a) => !a)}>
            {all ? "Show 10" : `Show all ${list.length}`}
          </button>
        ) : null}
      </div>
    </Section>
  );
}

// ---- Reviews removed -------------------------------------------------------------------------------------------------

function Removed({ lines, prevDay }: { lines: ReviewLine[]; prevDay: string }) {
  const dropped = sortForAttention(lines).filter((l) => l.status === "Dropped");
  return (
    <Section id="reviews-removed" title="Reviews removed" sub={`Links with fewer written reviews than on ${dayYear(prevDay)}, the biggest loss first`} index={6}>
      {dropped.length ? (
        <ul className="item-list m-0 list-none p-0">
          {dropped.map((l) => (
            <li key={l.rowNo}>
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="item-row focus-ring transition-colors duration-160 hover:bg-panel2">
                <IconBadge icon={<StarIcon />} tint="red" />
                <span className="min-w-0">
                  <span className="item-row-title">{l.product}</span>
                  <span className="item-row-detail">
                    <span className="font-mono">
                      {priorityName(l.priority)} · {l.sellerSku ?? "No SKU found"}
                    </span>{" "}
                    · {formatNumber(l.before ?? 0)} → {formatNumber(l.reviews ?? 0)}
                  </span>
                </span>
                <span className="item-row-end">
                  <PlatformPill platform={l.platform} />
                  <Chip tone="bad">{signed(l.change)}</Chip>
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="sp-inner tone-row tone-ok"><span className="tone-row-title">No link lost written reviews since {dayShort(prevDay)}.</span></p>
      )}
    </Section>
  );
}

// ---- Every link ------------------------------------------------------------------------------------------------------

type SortKey = "attention" | "priority" | "reviews" | "change" | "target";
type Sort = { key: SortKey; dir: 1 | -1 };

function sorted(lines: ReviewLine[], sort: Sort): ReviewLine[] {
  if (sort.key === "attention") return sortForAttention(lines);
  // By distance to target, either way round, links already there (or with no target or count) go last.
  if (sort.key === "target") {
    const short = byDistanceToTarget(lines, sort.dir === 1 ? "nearest" : "furthest");
    const rest = lines.filter((l) => !short.includes(l)).sort((a, b) => a.rowNo - b.rowNo);
    return [...short, ...rest];
  }
  const val = (l: ReviewLine) => (sort.key === "priority" ? l.priority || 99 : sort.key === "reviews" ? (l.reviews ?? -1) : (l.change ?? -Infinity));
  return [...lines].sort((a, b) => sort.dir * (val(a) - val(b)) || a.rowNo - b.rowNo);
}

function LinkCard({ l, index }: { l: ReviewLine; index: number }) {
  const go = toGo(l);
  return (
    <a
      href={l.url}
      target="_blank"
      rel="noopener noreferrer"
      className="focus-ring sp-inner flex min-w-0 items-center gap-3 p-3 transition-colors duration-160 hover:bg-[var(--row-hover)]"
      style={style(Math.min(index, 12))}
      title={`${l.product} on ${l.platform}: open the listing`}
    >
      <TargetRing reviews={l.reviews} target={l.target} color={PLATFORM_COLOR[l.platform]} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold">{l.product}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <PlatformPill platform={l.platform} />
          <SkuTag l={l} className="text-[11px] font-semibold" />
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
          {l.status === "Not checked" ? (
            <Chip tone="warn">Not read</Chip>
          ) : go == null ? (
            <span className="text-muted">No target</span>
          ) : go === 0 ? (
            <Chip tone="ok">Target reached</Chip>
          ) : (
            <span className="tabular-nums">
              <b className={go <= 10 ? "text-warn" : ""}>{formatNumber(go)}</b> <span className="text-muted">to go of {formatNumber(l.target ?? 0)}</span>
            </span>
          )}
          {l.change ? <Chip tone={l.change > 0 ? "ok" : "bad"}>{signed(l.change)}</Chip> : null}
        </span>
      </span>
    </a>
  );
}

/** Cards in lanes by priority, each lane with its own progress bar. */
function LinkCards({ list }: { list: ReviewLine[] }) {
  const lanes = useMemo(() => {
    const map = new Map<number, ReviewLine[]>();
    for (const l of list) map.set(l.priority ?? 0, [...(map.get(l.priority ?? 0) ?? []), l]);
    return [...map.entries()].sort(([a], [b]) => (a || 99) - (b || 99));
  }, [list]);
  if (!list.length) return <p className="t-caption py-6 text-center">No link matches.</p>;
  return (
    <div className="grid items-start gap-3 min-[700px]:grid-cols-2 min-[700px]:gap-4">
      {lanes.map(([p, ls]) => {
        const g = targetProgress(ls);
        return (
          <div key={p} className="sp-card g-pad min-w-0">
            <div className="g-head flex flex-wrap items-center gap-x-3 gap-y-1">
              <h3 className="t-card-title">{priorityLong(p)}</h3>
              <span className="t-caption tabular-nums">
                {ls.length} link{ls.length === 1 ? "" : "s"} · {g.atTarget} at target
              </span>
              {g.target ? (
                <span className="flex min-w-[8rem] flex-1 items-center gap-2 sm:max-w-xs">
                  <span className="g-track g-track-thin flex-1" aria-hidden="true">
                    <span className="sp-bar" style={{ width: `${pct(g.have, g.target)}%` }} />
                  </span>
                  <span className="text-xs font-semibold tabular-nums">{pct(g.have, g.target)}%</span>
                </span>
              ) : null}
            </div>
            <div className="grid gap-2 min-[1400px]:grid-cols-2">
              {ls.map((l, i) => (
                <LinkCard key={l.rowNo} l={l} index={i} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LinkTable({ list, prevDay, sort, onSort }: { list: ReviewLine[]; prevDay: string | null; sort: Sort; onSort: (s: Sort) => void }) {
  const head = (key: SortKey, label: string, right = true) => (
    <th scope="col" className={right ? "num" : "text-left"} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className="focus-ring rounded font-[inherit] uppercase tracking-[inherit]" onClick={() => onSort(sort.key === key ? { key, dir: sort.dir === 1 ? -1 : 1 } : { key, dir: key === "priority" ? 1 : -1 })}>
        {label}
        {sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
      </button>
    </th>
  );
  const plain = (label: string, extra = "") => (
    <th scope="col" className={`text-left ${extra}`}>
      {label}
    </th>
  );
  return (
    <div className="sp-inner ledger-card max-h-[36rem]">
      <table className={`w-full border-collapse text-sm ${prevDay ? "min-w-[720px]" : "min-w-[560px]"}`}>
        <thead>
          <tr>
            {head("priority", "Priority", false)}
            {plain("Product")}
            {plain("Platform")}
            {head("reviews", "Reviews")}
            {prevDay ? (
              <th scope="col" className="num whitespace-nowrap">
                {dayShort(prevDay)}
              </th>
            ) : null}
            {prevDay ? head("change", "Change") : null}
            {head("target", "To target", false)}
            {prevDay ? plain("Status") : null}
          </tr>
        </thead>
        <tbody>
          {list.length ? (
            list.map((l) => (
              <tr key={l.rowNo} className="align-top">
                <td className="font-bold">{priorityName(l.priority)}</td>
                <td className="min-w-[13rem]">
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="focus-ring rounded font-bold hover:underline">
                    {l.product}
                  </a>
                  <SkuTag l={l} className="block text-[11px] font-semibold" />
                </td>
                <td>
                  <PlatformPill platform={l.platform} />
                </td>
                <td className="num">{l.reviews == null ? "—" : formatNumber(l.reviews)}</td>
                {prevDay ? <td className="num text-muted">{l.before == null ? "—" : formatNumber(l.before)}</td> : null}
                {prevDay ? <td className={`px-3 py-2 text-right font-bold tabular-nums ${changeClass(l.change)}`}>{signed(l.change)}</td> : null}
                <td>
                  <TargetBar reviews={l.reviews} target={l.target} color={PLATFORM_COLOR[l.platform]} />
                </td>
                {prevDay ? (
                  <td>
                    <Chip tone={STATUS_TONE[l.status]}>{l.status}</Chip>
                  </td>
                ) : null}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={8} className="text-center text-muted">
                No link matches.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function TargetBar({ reviews, target, color }: { reviews: number | null; target: number | null; color: string }) {
  if (!target) return <span className="text-muted">—</span>;
  const have = reviews ?? 0;
  const share = Math.min(1, have / target);
  const done = have >= target;
  return (
    <span className="flex min-w-[8.5rem] items-center gap-2" title={`${formatNumber(have)} of ${formatNumber(target)}`}>
      <span className="h-2 w-16 shrink-0 overflow-hidden rounded-full bg-surface2">
        <span className="block h-full rounded-full" style={{ width: `${share * 100}%`, background: done ? "var(--ok)" : color }} />
      </span>
      <span className={`whitespace-nowrap text-xs tabular-nums ${done ? "text-ok" : "text-muted"}`}>{done ? "done" : `${formatNumber(target - have)} to go`}</span>
    </span>
  );
}

type Filters = { platform: "all" | ReviewPlatform; priority: string };

function EveryLink({ lines, prevDay, filters, setFilters }: { lines: ReviewLine[]; prevDay: string | null; filters: Filters; setFilters: (f: Filters) => void }) {
  const [mode, setMode] = useState<"cards" | "table">("cards");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "attention", dir: 1 });
  const priorities = useMemo(() => [...new Set(lines.map((l) => l.priority ?? 0))].sort((a, b) => (a || 99) - (b || 99)), [lines]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = lines.filter(
      (l) =>
        (filters.platform === "all" || l.platform === filters.platform) &&
        (filters.priority === "all" || String(l.priority ?? 0) === filters.priority) &&
        (!q || [l.product, l.listingId, l.sellerSku ?? ""].some((s) => s.toLowerCase().includes(q))),
    );
    return sorted(shown, sort);
  }, [lines, filters, query, sort]);

  const sortOptions: [string, Sort][] = [
    [prevDay ? "Drops first" : "Sheet order", { key: "attention", dir: 1 }],
    ["Nearest target", { key: "target", dir: 1 }],
    ["Furthest from target", { key: "target", dir: -1 }],
    ["Most reviews", { key: "reviews", dir: -1 }],
    ["Fewest reviews", { key: "reviews", dir: 1 }],
    ...(prevDay ? ([["Biggest gain", { key: "change", dir: -1 }]] as [string, Sort][]) : []),
  ];
  const sortValue = sortOptions.findIndex(([, s]) => s.key === sort.key && s.dir === sort.dir);
  const filtered = filters.platform !== "all" || filters.priority !== "all" || query.trim() !== "";

  return (
    <Section
      id="reviews-links"
      title="Every link"
      sub={`Written reviews only, not star ratings. ${list.length} of ${lines.length} links shown. Tap a card to open the listing.`}
      index={8}
      action={
        <div role="group" aria-label="View" className="seg">
          {(["cards", "table"] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className="seg-opt">
              {m === "cards" ? "Cards" : "Table"}
            </button>
          ))}
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Platform" className="seg">
          {(["all", ...PLATFORMS] as const).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={filters.platform === p}
              onClick={() => setFilters({ ...filters, platform: p })}
              className="seg-opt gap-1.5"
            >
              {p !== "all" ? <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: PLATFORM_COLOR[p] }} /> : null}
              {p === "all" ? "All" : p}
            </button>
          ))}
        </div>
        <select id="reviews-priority-filter" aria-label="Priority" className="input w-auto" value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })}>
          <option value="all">All priorities</option>
          {priorities.map((p) => (
            <option key={p} value={String(p)}>
              {priorityLong(p)}
            </option>
          ))}
        </select>
        <select id="reviews-sort" aria-label="Sort" className="input w-auto" value={sortValue < 0 ? "" : String(sortValue)} onChange={(e) => setSort(sortOptions[Number(e.target.value)][1])}>
          {sortValue < 0 ? <option value="">Sorted by column</option> : null}
          {sortOptions.map(([label], i) => (
            <option key={label} value={String(i)}>
              {label}
            </option>
          ))}
        </select>
        <input id="reviews-search" type="search" className="input min-w-[10rem] flex-1 sm:max-w-56" placeholder="Search product, SKU or ID" aria-label="Search product, SKU or ID" value={query} onChange={(e) => setQuery(e.target.value)} />
        {filtered ? (
          <button
            type="button"
            className={buttonClass("ghost")}
            onClick={() => {
              setFilters({ platform: "all", priority: "all" });
              setQuery("");
            }}
          >
            Clear filters
          </button>
        ) : null}
      </div>
      {mode === "cards" ? <LinkCards list={list} /> : <LinkTable list={list} prevDay={prevDay} sort={sort} onSort={setSort} />}
    </Section>
  );
}

// ---- Sync now --------------------------------------------------------------------------------------------------------

/** Sync now: the site reads the links it can reach (under a minute) and adds them to today's counts. */
function SyncButton() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const sync = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/reviews/sync", { method: "POST" });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; text?: string } | null;
      if (toast.result({ ok: Boolean(res.ok && body?.ok), message: body?.text ?? "Sync didn't finish. Try again." })) router.refresh();
    } catch {
      toast.result({ ok: false, message: "Sync didn't finish. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className={buttonClass("primary")} disabled={busy} onClick={() => void sync()} title="Read the links the site can reach now and update today's counts">
      <RefreshIcon className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
      {busy ? "Syncing… under a minute" : "Sync now"}
    </button>
  );
}

// ---- Check by check --------------------------------------------------------------------------------------------------

/**
 * The total at each check as a line. The scale fits the totals (it doesn't start at zero), because a few dozen new
 * reviews on six thousand would otherwise read as a flat line. Labels are HTML so they stay sharp on a phone.
 */
function TrendLine({ trend, day }: { trend: ReviewsView["trend"]; day: string | null }) {
  const id = useId();
  const values = trend.map((t) => t.reviews);
  const hi = Math.max(...values);
  const lo = Math.min(...values);
  const pad = Math.max(10, (hi - lo) * 0.25);
  const top = hi + pad;
  const bottom = Math.max(0, lo - pad);
  const x = (i: number) => (i / (trend.length - 1)) * 100;
  const y = (v: number) => 6 + (1 - (v - bottom) / (top - bottom)) * 88;
  const line = trend.map((t, i) => `${i ? "L" : "M"}${x(i)} ${y(t.reviews)}`).join(" ");
  return (
    <div role="img" aria-label={`Written reviews at each check: ${trend.map((t) => `${dayShort(t.day)} ${formatNumber(t.reviews)}`).join(", ")}`}>
      <div className="relative h-44 sm:h-52" aria-hidden="true">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="sp-wipe absolute inset-0 h-full w-full">
          <defs>
            <linearGradient id={`${id}f`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" style={{ stopColor: "var(--accent)" }} stopOpacity="0.4" />
              <stop offset="1" style={{ stopColor: "var(--accent)" }} stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${id}l`} x1="0" x2="100" y1="0" y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0" style={{ stopColor: "var(--accent)" }} />
              <stop offset="1" style={{ stopColor: "var(--accent)" }} />
            </linearGradient>
          </defs>
          {[6, 50, 94].map((g) => (
            <line key={g} x1="0" x2="100" y1={g} y2={g} style={{ stroke: g === 94 ? "var(--line)" : "var(--line-soft)" }} strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}
          <path d={`${line} L100 100 L0 100 Z`} fill={`url(#${id}f)`} />
          <path d={line} fill="none" stroke={`url(#${id}l)`} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
        {trend.map((t, i) => (
          <span key={t.day} className="sp-fade absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${x(i)}%`, top: `${y(t.reviews)}%` }}>
            <span
              className="block h-3 w-3 rounded-full border-2 border-surface"
              style={{ background: t.day === day ? "var(--ok)" : "var(--accent)", boxShadow: t.day === day ? "0 0 0 5px color-mix(in srgb, var(--ok) 22%, transparent)" : undefined }}
            />
          </span>
        ))}
        {trend.map((t, i) => (
          <span
            key={`${t.day}-v`}
            className="sp-fade absolute whitespace-nowrap pb-2 text-[11px] font-bold tabular-nums text-ink"
            style={{ left: `${x(i)}%`, top: `${y(t.reviews)}%`, transform: `translate(${i === 0 ? "0" : i === trend.length - 1 ? "-100%" : "-50%"}, -100%)` }}
          >
            {compact(t.reviews)}
          </span>
        ))}
      </div>
      <div className="tabular-nums relative mt-2 h-4 text-[11px] text-faint" aria-hidden="true">
        {trend.map((t, i) => (
          <span key={t.day} className="absolute whitespace-nowrap" style={{ left: `${x(i)}%`, transform: i === 0 ? "none" : i === trend.length - 1 ? "translateX(-100%)" : "translateX(-50%)" }}>
            {dayShort(t.day)}
          </span>
        ))}
      </div>
    </div>
  );
}

function Trend({ trend, day }: { trend: ReviewsView["trend"]; day: string | null }) {
  if (trend.length < 2) return null;
  return (
    <Section id="reviews-trend" title="Check by check" sub="Total written reviews at each check, all links added up. A check with links that didn't load reads low." index={7}>
      <TrendLine trend={trend} day={day} />
      <ul className="mt-4 flex flex-wrap gap-2">
        {trend.map((t, i) => {
          const prev = trend[i - 1];
          const change = prev ? t.reviews - prev.reviews : null;
          return (
            <li key={t.day} className={`tabular-nums g-chip ${t.day === day ? "tone-accent" : ""}`}>
              <b>{dayShort(t.day)}</b> {formatNumber(t.reviews)}
              {change != null ? <span className={`ml-1.5 ${changeClass(change)}`}>{signed(change)}</span> : null}
              {t.missing ? <span className="ml-1.5 text-warn">{t.missing} not read</span> : null}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

// ---- The page --------------------------------------------------------------------------------------------------------

export function ReviewTracker({ view }: { view: ReviewsView | null }) {
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>({ platform: "all", priority: "all" });
  if (!view) {
    return (
      <div className="flex min-w-0 flex-col gap-5">
        <h1 className="t-h1">Review tracker</h1>
        <EmptyState
          title="The Review tracker isn't set up in the database yet"
          body="Apply the review tracker migrations (in supabase/migrations, starting 20261021120000) to the Supabase project, then reload this page."
        />
      </div>
    );
  }
  const note = view.checks.find((c) => c.day === view.day)?.note;
  const unread = view.lines.filter((l) => l.status === "Not checked");
  // The charts follow the platform and priority filters, so a tap on a priority shows its quick wins too.
  const chartLines = view.lines.filter((l) => filters.platform === "all" || l.platform === filters.platform);
  const closestLines = chartLines.filter((l) => filters.priority === "all" || String(l.priority ?? 0) === filters.priority);
  return (
    <div className="g-grid items-start">
      <header className="span-12 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="t-h1">Review tracker</h1>
          <p className="t-headline mt-1">Flipkart &amp; Shopsy · written reviews</p>
          <p className="t-caption mt-0.5">
            {view.day ? `Checked ${dayYear(view.day)}${view.prevDay ? `, compared with ${dayYear(view.prevDay)}` : ""}${note ? ` · ${note}` : ""}` : "No check saved yet."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {view.checks.length ? (
            <select id="reviews-check" aria-label="Choose a check" className="input w-auto" value={view.day ?? ""} onChange={(e) => router.push(`/reviews?check=${encodeURIComponent(e.target.value)}`)}>
              {view.checks.map((c) => (
                <option key={c.day} value={c.day}>
                  {dayYear(c.day)}
                </option>
              ))}
            </select>
          ) : null}
          <SyncButton />
        </div>
      </header>
      <p className="t-caption span-12">Every 5 days the counts are read on Aman&apos;s PC (Flipkart and Shopsy block the site&apos;s own server) and saved here. Sync now tries from the site and adds what it can read; links it can&apos;t read keep their latest count.</p>
      {view.day ? (
        <>
          <Headline view={view} onPlatform={(p) => setFilters({ ...filters, platform: p })} />
          {unread.length ? (
            <p className="sp-card tone-row tone-warn tone-row-title span-12">
              {unread.length} link{unread.length > 1 ? "s" : ""} could not be read this time ({unread.map((l) => l.product).join(", ")}), so a change there would not show.
            </p>
          ) : null}
          {filters.platform !== "all" ? (
            <p className="t-caption span-12 flex items-center gap-2">
              Charts show <PlatformPill platform={filters.platform} /> only.
              <button type="button" className={buttonClass("ghost")} onClick={() => setFilters({ ...filters, platform: "all" })}>
                Show both
              </button>
            </p>
          ) : null}
          <div className="span-7 min-w-0">
            <PriorityChart lines={chartLines} priority={filters.priority} onPriority={(p) => setFilters({ ...filters, priority: p })} />
          </div>
          <div className="span-5 min-w-0">
            <Trend trend={view.trend} day={view.day} />
          </div>
          <div className="span-6 min-w-0">
            <ClosestChart lines={closestLines} />
          </div>
          {view.prevDay ? (
            <div className="span-6 min-w-0">
              <Removed lines={view.lines} prevDay={view.prevDay} />
            </div>
          ) : null}
          <div className="span-12 min-w-0">
            <EveryLink lines={view.lines} prevDay={view.prevDay} filters={filters} setFilters={setFilters} />
          </div>
        </>
      ) : (
        <EmptyState title="No review check yet" body="Once the first counts are saved, every link's written reviews show here." />
      )}
    </div>
  );
}
