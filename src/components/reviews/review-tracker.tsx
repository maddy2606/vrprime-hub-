"use client";

import { useRouter } from "next/navigation";
import { RefreshIcon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { useMemo, useState, type ReactNode } from "react";
import { buttonClass, Chip, EmptyState } from "@/components/ui";
import { formatNumber } from "@/lib/format";
import { reviewTotals, sortForAttention, type ReviewLine, type ReviewStatus } from "@/lib/reviews";

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
const priorityName = (p: number | null) => (p == null ? "—" : p >= 8 ? "Last" : `P${p}`);
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
  const withTarget = lines.filter((l) => l.target != null && l.target > 0);
  const atTarget = withTarget.filter((l) => (l.reviews ?? 0) >= (l.target ?? 0)).length;
  const tiles: [string, string, string, string][] = [
    ["Written reviews", formatNumber(t.reviews), `all ${lines.length} links added up`, ""],
    ["Change", prevDay ? signed(t.change) : "—", since, prevDay ? changeClass(t.change) : ""],
    ["Links with reviews removed", formatNumber(t.dropped), t.dropped ? "see the list below" : "none", t.dropped ? "text-bad" : "text-ok"],
    ["Flipkart", formatNumber(t.byPlatform.Flipkart.reviews), prevDay ? `${signed(t.byPlatform.Flipkart.change)} ${since}` : "", ""],
    ["Shopsy", formatNumber(t.byPlatform.Shopsy.reviews), prevDay ? `${signed(t.byPlatform.Shopsy.change)} ${since}` : "", ""],
    ["At target", `${atTarget} / ${withTarget.length}`, t.notChecked ? `${t.notChecked} links not read` : "links with reviews ≥ target", t.notChecked ? "text-warn" : ""],
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
                {priorityName(l.priority)} · {l.platform} · {l.sku}
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
          {unread.length} link{unread.length > 1 ? "s" : ""} could not be read this time ({unread.map((l) => l.product).join(", ")}), so a removal there would not show.
        </p>
      ) : null}
    </Section>
  );
}

// ---- Every link ------------------------------------------------------------------------------------------------------

type SortKey = "attention" | "priority" | "reviews" | "change" | "target";

function LinkTable({ lines, prevDay }: { lines: ReviewLine[]; prevDay: string | null }) {
  const [platform, setPlatform] = useState<"all" | "Flipkart" | "Shopsy">("all");
  const [priority, setPriority] = useState<string>("all");
  const priorities = useMemo(() => [...new Set(lines.map((l) => l.priority ?? 0))].sort((a, b) => a - b), [lines]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "attention", dir: 1 });

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = lines.filter(
      (l) =>
        (platform === "all" || l.platform === platform) &&
        (priority === "all" || String(l.priority ?? 0) === priority) &&
        (!q || l.product.toLowerCase().includes(q) || l.sku.toLowerCase().includes(q)),
    );
    if (sort.key === "attention") return sortForAttention(shown);
    const left = (l: ReviewLine) => (l.target ? l.target - (l.reviews ?? 0) : -Infinity);
    const val = (l: ReviewLine) =>
      sort.key === "priority" ? (l.priority ?? 99) : sort.key === "reviews" ? (l.reviews ?? -1) : sort.key === "target" ? left(l) : (l.change ?? -Infinity);
    return [...shown].sort((a, b) => sort.dir * (val(a) - val(b)) || a.rowNo - b.rowNo);
  }, [lines, platform, priority, query, sort]);

  const head = (key: SortKey, label: string, right = true) => (
    <th scope="col" className={`whitespace-nowrap px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-muted ${right ? "text-right" : "text-left"}`} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className="focus-ring rounded" onClick={() => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "priority" ? 1 : -1 }))}>
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
      sub="Written reviews only, not star ratings. Opens with drops first. Target bar: reviews so far against the sheet's target; sort by To target to see what is furthest away."
      action={
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Platform" className="inline-flex overflow-hidden rounded-xl border border-line">
            {(["all", "Flipkart", "Shopsy"] as const).map((p) => (
              <button key={p} type="button" aria-pressed={platform === p} onClick={() => setPlatform(p)} className={`focus-ring min-h-10 px-3 text-sm font-bold ${platform === p ? "bg-accent-soft text-accent-text" : "text-muted hover:bg-surface2"}`}>
                {p === "all" ? "All" : p}
              </button>
            ))}
          </div>
          <select id="reviews-priority" aria-label="Priority" className="input w-auto" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="all">All priorities</option>
            {priorities.map((p) => (
              <option key={p} value={String(p)}>
                {p === 0 ? "No priority" : p >= 8 ? "Last" : `Priority ${p}`}
              </option>
            ))}
          </select>
          <input id="reviews-search" type="search" className="input max-w-56" placeholder="Search product or ID" aria-label="Search product or ID" value={query} onChange={(e) => setQuery(e.target.value)} />
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
              {head("priority", "Priority", false)}
              {plain("Product")}
              {plain("Platform")}
              {head("reviews", "Reviews")}
              <th scope="col" className="whitespace-nowrap px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide text-muted">
                {prevDay ? dayShort(prevDay) : "Before"}
              </th>
              {head("change", "Change")}
              {head("target", "To target", false)}
              {plain("Status")}
            </tr>
          </thead>
          <tbody>
            {list.length ? (
              list.map((l) => (
                <tr key={l.rowNo} className="border-t border-line-soft align-top hover:bg-surface2/40">
                  <td className="px-3 py-2 font-mono font-bold">{priorityName(l.priority)}</td>
                  <td className="min-w-[13rem] px-3 py-2">
                    <a href={l.url} target="_blank" rel="noopener noreferrer" className="focus-ring rounded font-bold hover:underline">
                      {l.product}
                    </a>
                    <span className="block font-mono text-[11px] text-muted">{l.sku}</span>
                  </td>
                  <td className="px-3 py-2">{l.platform}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{l.reviews == null ? "—" : formatNumber(l.reviews)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">{l.before == null ? "—" : formatNumber(l.before)}</td>
                  <td className={`px-3 py-2 text-right font-mono font-bold tabular-nums ${changeClass(l.change)}`}>{signed(l.change)}</td>
                  <td className="px-3 py-2">
                    <TargetBar reviews={l.reviews} target={l.target} />
                  </td>
                  <td className="px-3 py-2">
                    <Chip tone={STATUS_TONE[l.status]}>{l.status}</Chip>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-sm text-muted">
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

function TargetBar({ reviews, target }: { reviews: number | null; target: number | null }) {
  if (!target) return <span className="text-muted">—</span>;
  const have = reviews ?? 0;
  const share = Math.min(1, have / target);
  const done = have >= target;
  return (
    <span className="flex min-w-[8.5rem] items-center gap-2" title={`${formatNumber(have)} of ${formatNumber(target)}`}>
      <span className="h-2 w-16 shrink-0 overflow-hidden rounded-full bg-surface2">
        <span className={`block h-full rounded-full ${done ? "bg-ok" : "bg-accent"}`} style={{ width: `${share * 100}%` }} />
      </span>
      <span className={`whitespace-nowrap font-mono text-xs tabular-nums ${done ? "text-ok" : "text-muted"}`}>{done ? "done" : `${formatNumber(target - have)} to go`}</span>
    </span>
  );
}

// ---- Sync now --------------------------------------------------------------------------------------------------------

/** Sync now: the site opens every link and saves today's counts. Takes about a minute. */
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
      {busy ? "Syncing… about a minute" : "Sync now"}
    </button>
  );
}

// ---- Check by check --------------------------------------------------------------------------------------------------

function Trend({ trend, day }: { trend: ReviewsView["trend"]; day: string | null }) {
  if (trend.length < 2) return null;
  const max = Math.max(1, ...trend.map((t) => t.reviews));
  return (
    <Section id="reviews-trend" title="Check by check" sub="Total written reviews at each check, all links added up. A check with links that didn't load reads low.">
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
          body="Apply the review tracker migrations (in supabase/migrations, starting 20261021120000) to the Supabase project, then reload this page."
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
      <p className="-mt-2 text-xs text-muted">Every 5 days the counts are read in Aman&apos;s Chrome and saved here. Sync now updates the links the site itself can read; links it can&apos;t read keep their latest count.</p>
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
