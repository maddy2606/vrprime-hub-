"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { Chip, EmptyState } from "@/components/ui";
import { formatNumber } from "@/lib/format";
import { reviewTotals, sortForAttention, type ReviewLine, type ReviewStatus } from "@/lib/reviews";

// ---- What the page sends ---------------------------------------------------------------------------------------------

export type ReviewsView = {
  checks: { day: string; note: string | null }[];
  /** The check shown, and the one it is compared with. */
  day: string | null;
  prevDay: string | null;
  lines: ReviewLine[];
  /** Total written reviews per check, oldest first, shared listings counted once. */
  trend: { day: string; reviews: number; missing: number }[];
};

// ---- Small helpers ---------------------------------------------------------------------------------------------------

const dayShort = (d: string) => new Date(`${d}T12:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
const dayYear = (d: string) => new Date(`${d}T12:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const signed = (n: number | null) => (n == null ? "—" : n > 0 ? `+${formatNumber(n)}` : n < 0 ? `−${formatNumber(-n)}` : "0");
const changeClass = (n: number | null) => (n == null || n === 0 ? "text-muted" : n > 0 ? "text-ok" : "text-bad");
const STATUS_TONE: Record<ReviewStatus, "ok" | "warn" | "bad" | "neutral" | "info"> = { Dropped: "bad", Gained: "ok", "No change": "neutral", "Not checked": "warn", New: "info" };

function Section({ id, title, sub, action, children }: { id: string; title: string; sub?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="sp-card min-w-0 p-5 sm:p-6" aria-labelledby={`${id}-title`}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="font-display text-lg font-semibold">
            {title}
          </h2>
          {sub ? <p className="max-w-2xl text-xs text-muted">{sub}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

// ---- Headline figures ------------------------------------------------------------------------------------------------

function Kpis({ lines, prevDay }: { lines: ReviewLine[]; prevDay: string | null }) {
  const t = reviewTotals(lines);
  const since = prevDay ? `since ${dayShort(prevDay)}` : "no earlier check";
  const tiles: [string, string, string, string][] = [
    ["Written reviews", formatNumber(t.reviews), "Flipkart + Shopsy, shared listings once", ""],
    ["Change", prevDay ? signed(t.change) : "—", since, prevDay ? changeClass(t.change) : ""],
    ["Links with reviews removed", formatNumber(t.dropped), t.dropped ? "see the list below" : "none", t.dropped ? "text-bad" : "text-ok"],
    ["Flipkart", formatNumber(t.byPlatform.Flipkart.reviews), prevDay ? `${signed(t.byPlatform.Flipkart.change)} ${since}` : "", ""],
    ["Shopsy", formatNumber(t.byPlatform.Shopsy.reviews), prevDay ? `${signed(t.byPlatform.Shopsy.change)} ${since}` : "", ""],
    ["Links not read", formatNumber(t.notChecked), t.notChecked ? "page didn't load, check again" : `all ${lines.length} read`, t.notChecked ? "text-warn" : ""],
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {tiles.map(([label, value, foot, tone]) => (
        <div key={label} className="sp-card min-w-0 p-4">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted">{label}</p>
          <p className={`mt-1 font-mono text-xl font-bold tabular-nums ${tone}`}>{value}</p>
          <p className="text-xs text-muted">{foot}</p>
        </div>
      ))}
    </div>
  );
}

// ---- Reviews removed -------------------------------------------------------------------------------------------------

function Removed({ lines, prevDay }: { lines: ReviewLine[]; prevDay: string | null }) {
  const dropped = sortForAttention(lines).filter((l) => l.status === "Dropped");
  const unread = lines.filter((l) => l.status === "Not checked");
  return (
    <Section id="reviews-removed" title="Reviews removed" sub={prevDay ? `Links with fewer written reviews than on ${dayYear(prevDay)}, the biggest loss first` : "Shows once there are two checks to compare"}>
      {dropped.length ? (
        <ul className="grid gap-2">
          {dropped.map((l) => (
            <li key={l.rowNo} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-surface2/50 px-3 py-2 text-sm">
              <Chip tone="bad">{signed(l.change)}</Chip>
              <span className="font-bold">{l.product}</span>
              <span className="font-mono text-xs text-muted">
                {l.platform} · {l.sku} · row {l.rowNo}
              </span>
              <span className="text-muted">
                {formatNumber(l.before ?? 0)} → {formatNumber(l.reviews ?? 0)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">{prevDay ? "No link lost written reviews." : "Nothing to compare yet."}</p>
      )}
      {unread.length ? (
        <p className="mt-3 text-sm text-warn">
          {unread.length} link{unread.length > 1 ? "s" : ""} could not be read this time (rows {unread.map((l) => l.rowNo).join(", ")}), so a removal there would not show.
        </p>
      ) : null}
    </Section>
  );
}

// ---- Every link ------------------------------------------------------------------------------------------------------

type SortKey = "attention" | "row" | "reviews" | "change";

function LinkTable({ lines, prevDay }: { lines: ReviewLine[]; prevDay: string | null }) {
  const [platform, setPlatform] = useState<"all" | "Flipkart" | "Shopsy">("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "attention", dir: 1 });

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = lines.filter((l) => (platform === "all" || l.platform === platform) && (!q || l.product.toLowerCase().includes(q) || l.sku.toLowerCase().includes(q) || String(l.rowNo) === q));
    if (sort.key === "attention") return sortForAttention(shown);
    const val = (l: ReviewLine) => (sort.key === "row" ? l.rowNo : sort.key === "reviews" ? (l.reviews ?? -1) : (l.change ?? -Infinity));
    return [...shown].sort((a, b) => sort.dir * (val(a) - val(b)) || a.rowNo - b.rowNo);
  }, [lines, platform, query, sort]);

  const head = (key: SortKey, label: string, right = true) => (
    <th scope="col" className={`whitespace-nowrap px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-muted ${right ? "text-right" : "text-left"}`} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className="focus-ring rounded" onClick={() => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "row" ? 1 : -1 }))}>
        {label}
        {sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
      </button>
    </th>
  );
  const plain = (label: string, extra = "") => (
    <th scope="col" className={`whitespace-nowrap px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-muted ${extra}`}>
      {label}
    </th>
  );

  return (
    <Section
      id="reviews-links"
      title="Every link"
      sub="Written reviews only, not star ratings. Opens with drops first. Rows marked “shares reviews” show the same reviews as another row and count once in the totals."
      action={
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Platform" className="inline-flex overflow-hidden rounded-xl border border-line">
            {(["all", "Flipkart", "Shopsy"] as const).map((p) => (
              <button key={p} type="button" aria-pressed={platform === p} onClick={() => setPlatform(p)} className={`focus-ring min-h-10 px-3 text-sm font-bold ${platform === p ? "bg-accent-soft text-accent-text" : "text-muted hover:bg-surface2"}`}>
                {p === "all" ? "All" : p}
              </button>
            ))}
          </div>
          <input id="reviews-search" type="search" className="input max-w-56" placeholder="Search product, SKU or row" aria-label="Search product, SKU or row" value={query} onChange={(e) => setQuery(e.target.value)} />
          {sort.key !== "attention" ? (
            <button type="button" className="focus-ring rounded-lg px-2 py-1 text-xs font-bold text-accent-text hover:bg-accent-soft" onClick={() => setSort({ key: "attention", dir: 1 })}>
              Drops first
            </button>
          ) : null}
        </div>
      }
    >
      <div className="max-h-[36rem] overflow-auto rounded-2xl border border-line-soft">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-panel2">
            <tr>
              {head("row", "Row", false)}
              {plain("Platform")}
              {plain("Product")}
              {plain("SKU")}
              {head("reviews", "Reviews")}
              <th scope="col" className="whitespace-nowrap px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide text-muted">
                {prevDay ? dayShort(prevDay) : "Before"}
              </th>
              {head("change", "Change")}
              {plain("Status")}
            </tr>
          </thead>
          <tbody>
            {list.length ? (
              list.map((l) => (
                <tr key={l.rowNo} className="border-t border-line-soft align-top hover:bg-surface2/40">
                  <td className="px-3 py-2 font-mono tabular-nums">{l.rowNo}</td>
                  <td className="px-3 py-2">{l.platform}</td>
                  <td className="min-w-[16rem] px-3 py-2">
                    <a href={l.url} target="_blank" rel="noopener noreferrer" className="focus-ring rounded font-bold hover:underline">
                      {l.product}
                    </a>
                    {l.sharesWith != null ? <span className="block text-xs text-muted">Shares reviews with row {l.sharesWith}</span> : null}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{l.sku}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{l.reviews == null ? "—" : formatNumber(l.reviews)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">{l.before == null ? "—" : formatNumber(l.before)}</td>
                  <td className={`px-3 py-2 text-right font-mono font-bold tabular-nums ${changeClass(l.change)}`}>{signed(l.change)}</td>
                  <td className="px-3 py-2">
                    <Chip tone={STATUS_TONE[l.status]}>{l.status}</Chip>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-sm text-muted">
                  No link matches.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ---- Check by check --------------------------------------------------------------------------------------------------

function Trend({ trend, day }: { trend: ReviewsView["trend"]; day: string | null }) {
  if (trend.length < 2) return null;
  const max = Math.max(1, ...trend.map((t) => t.reviews));
  return (
    <Section id="reviews-trend" title="Check by check" sub="Total written reviews at each check, shared listings counted once. A check with links that didn't load reads low.">
      <ul className="grid gap-2">
        {trend.map((t, i) => {
          const prev = trend[i - 1];
          const change = prev ? t.reviews - prev.reviews : null;
          return (
            <li key={t.day} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-3 text-sm">
              <span className={`font-mono text-xs ${t.day === day ? "font-bold text-ink" : "text-muted"}`}>{dayShort(t.day)}</span>
              <span className="h-3 overflow-hidden rounded-full bg-surface2">
                <span className={`block h-full rounded-full ${t.day === day ? "bg-accent" : "bg-accent/40"}`} style={{ width: `${(t.reviews / max) * 100}%` }} />
              </span>
              <span className="whitespace-nowrap text-right font-mono text-xs tabular-nums">
                {formatNumber(t.reviews)}
                {change != null ? <span className={`ml-2 ${changeClass(change)}`}>{signed(change)}</span> : null}
                {t.missing ? <span className="ml-2 text-warn">{t.missing} not read</span> : null}
              </span>
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
  if (!view) {
    return (
      <div className="flex min-w-0 flex-col gap-5">
        <h1 className="font-display text-[1.65rem] font-semibold tracking-tight">Review tracker</h1>
        <EmptyState
          title="The Review tracker isn't set up in the database yet"
          body="Apply the migrations 20261021120000_review_tracker.sql and 20261021121000_review_tracker_first_checks.sql (in supabase/migrations) to the Supabase project, then reload this page."
        />
      </div>
    );
  }
  const note = view.checks.find((c) => c.day === view.day)?.note;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Flipkart &amp; Shopsy · written reviews</p>
          <h1 className="font-display text-[1.65rem] font-semibold tracking-tight">Review tracker</h1>
          <p className="mt-0.5 text-sm text-muted">
            {view.day ? `Checked ${dayYear(view.day)}${view.prevDay ? `, compared with ${dayYear(view.prevDay)}` : ""}${note ? ` · ${note}` : ""}` : "No check saved yet."}
          </p>
        </div>
        {view.checks.length ? (
          <select id="reviews-check" aria-label="Choose a check" className="input w-auto" value={view.day ?? ""} onChange={(e) => router.push(`/reviews?check=${encodeURIComponent(e.target.value)}`)}>
            {view.checks.map((c) => (
              <option key={c.day} value={c.day}>
                {dayYear(c.day)}
              </option>
            ))}
          </select>
        ) : null}
      </header>
      {view.day ? (
        <>
          <Kpis lines={view.lines} prevDay={view.prevDay} />
          <Removed lines={view.lines} prevDay={view.prevDay} />
          <LinkTable lines={view.lines} prevDay={view.prevDay} />
          <Trend trend={view.trend} day={view.day} />
        </>
      ) : (
        <EmptyState title="No review check yet" body="Once the first counts are saved, every link's written reviews show here." />
      )}
    </div>
  );
}
