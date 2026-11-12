"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type ReactNode } from "react";
import { RefreshIcon } from "@/components/icons";
import { Sheet } from "@/components/shell/sheet";
import { useToast } from "@/components/toast";
import { buttonClass } from "@/components/ui";
import {
  campaigns as campaignRows,
  daySeries,
  DESK_DEFAULTS as S,
  finish,
  flow,
  keywords as keywordRows,
  negatives as negativeRows,
  products as productRows,
  rangeFor,
  readDeskData,
  searchTerms as termRows,
  spikes as spikeRows,
  total,
  VERDICTS,
  weekdays as weekdayRows,
  type CampaignRow,
  type DeskData,
  type NegStatus,
  type RangePreset,
  type Result,
  type Verdict,
} from "@/lib/ads-desk";
import { adsFileKind, readAdsTermReport } from "@/lib/ads-report";
import { saveAdTerms, setAdNegative, syncAdsReport } from "@/server/actions/ads";

// ---- Formatting ---------------------------------------------------------------------------------------------------------

const inr = (x: number) => {
  const a = Math.abs(x);
  const s = x < 0 ? "-" : "";
  if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(2)}L`;
  if (a >= 1e3) return `${s}₹${(a / 1e3).toFixed(1)}K`;
  return `${s}₹${Math.round(a)}`;
};
const rs = (x: number) => `₹${Math.round(x).toLocaleString("en-IN")}`;
const rs2 = (x: number) => `₹${x.toFixed(2)}`;
const n0 = (x: number) => Math.round(x).toLocaleString("en-IN");
const roi2 = (x: number) => x.toFixed(2);
const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dm = (d: string) => `${Number(d.slice(8))} ${MON[Number(d.slice(5, 7)) - 1]}`;
const span = (a: string, b: string) => (a === b ? dm(a) : a.slice(5, 7) === b.slice(5, 7) ? `${Number(a.slice(8))}–${dm(b)}` : `${dm(a)} – ${dm(b)}`);

const V_COLOR: Record<Verdict, string> = {
  winner: "var(--ok)",
  promising: "color-mix(in srgb, var(--ok) 55%, var(--info))",
  ok: "var(--info)",
  losing: "var(--warn-mark)",
  zero: "var(--bad)",
  early: "var(--muted)",
};
const V_LABEL = Object.fromEntries(VERDICTS.map((v) => [v.v, v.label])) as Record<Verdict, string>;
const V_TIP = Object.fromEntries(VERDICTS.map((v) => [v.v, v.tip])) as Record<Verdict, string>;
const roiColor = (r: number) => (r >= S.good ? "var(--ok)" : r >= S.be ? "var(--info)" : r > 0 ? "var(--warn-mark)" : "var(--bad)");

function Pill({ v }: { v: Verdict }) {
  return (
    <span title={V_TIP[v]} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line-soft px-2 py-0.5 text-[11px] font-bold">
      <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: V_COLOR[v] }} />
      {V_LABEL[v]}
    </span>
  );
}
const Roi = ({ r }: { r: Result }) => <span style={{ color: roiColor(r.roi) }}>{r.units > 0 || r.rev > 0 ? roi2(r.roi) : r.spend > 0 ? "0 sales" : "—"}</span>;

function Panel({ title, sub, action, children }: { title: string; sub?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="sp-card min-w-0 p-4 sm:p-5">
      <header className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold">{title}</h2>
          {sub ? <p className="text-xs text-muted">{sub}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}
const Note = ({ children }: { children: ReactNode }) => <p className="text-sm text-muted">{children}</p>;

// ---- A table that sorts, filters by result and shows more on request ----------------------------------------------------

type Col<R> = { label: string; num?: boolean; render: (r: R) => ReactNode; sort?: (r: R) => number | string; wide?: boolean };

function DataTable<R extends Result>({ rows, cols, initial, onRow, search, filter, onFilter }: { rows: R[]; cols: Col<R>[]; initial: number; onRow?: (r: R) => void; search?: (r: R) => string; filter: Verdict | "all"; onFilter: (v: Verdict | "all") => void }) {
  const [sort, setSort] = useState<{ i: number; dir: 1 | -1 }>({ i: initial, dir: -1 });
  const [limit, setLimit] = useState(50);
  const [q, setQ] = useState("");
  const counts = new Map<Verdict, number>();
  for (const r of rows) counts.set(r.v, (counts.get(r.v) ?? 0) + 1);
  const needle = q.trim().toLowerCase();
  let list = rows.filter((r) => (filter === "all" || r.v === filter) && (!needle || !search || search(r).toLowerCase().includes(needle)));
  const by = cols[sort.i]?.sort;
  if (by)
    list = [...list].sort((a, b) => {
      const x = by(a);
      const y = by(b);
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * sort.dir;
    });
  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {(["all", ...VERDICTS.map((v) => v.v).filter((v) => counts.get(v))] as (Verdict | "all")[]).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={filter === v}
            onClick={() => {
              onFilter(v);
              setLimit(50);
            }}
            className={`focus-ring inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-bold ${filter === v ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-muted hover:text-ink"}`}
          >
            {v !== "all" ? <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: V_COLOR[v] }} /> : null}
            {v === "all" ? "All" : V_LABEL[v]} <span className="font-mono tabular-nums opacity-80">{n0(v === "all" ? rows.length : (counts.get(v) ?? 0))}</span>
          </button>
        ))}
        {search ? <input className="input ml-auto min-h-9 w-full sm:w-56" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search this table" /> : null}
      </div>
      <div className="relative overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] font-bold uppercase tracking-wider text-muted">
              {cols.map((c, i) => (
                <th key={c.label} scope="col" className={`whitespace-nowrap px-2 py-2 ${c.num ? "text-right" : ""}`} aria-sort={sort.i === i ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
                  {c.sort ? (
                    <button type="button" className="focus-ring rounded font-bold uppercase tracking-wider hover:text-ink" onClick={() => setSort((s) => ({ i, dir: s.i === i ? (s.dir === 1 ? -1 : 1) : -1 }))}>
                      {c.label}
                      {sort.i === i ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.slice(0, limit).map((r, i) => (
              <tr key={i} className={`border-b border-line-soft ${onRow ? "cursor-pointer hover:bg-surface2/60" : ""}`} onClick={onRow ? () => onRow(r) : undefined}>
                {cols.map((c) => (
                  <td key={c.label} className={`px-2 py-2 align-top ${c.num ? "whitespace-nowrap text-right font-mono tabular-nums" : ""} ${c.wide ? "min-w-48 max-w-80" : ""}`}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.length === 0 ? <p className="py-6 text-center text-sm text-muted">Nothing here.</p> : null}
      {list.length > limit ? (
        <button type="button" onClick={() => setLimit(list.length)} className={buttonClass("secondary", "mt-3")}>
          Show all {n0(list.length)}
        </button>
      ) : null}
    </div>
  );
}

const metricCols = <R extends Result>(): Col<R>[] => [
  { label: "Result", render: (r) => <Pill v={r.v} />, sort: (r) => VERDICTS.findIndex((v) => v.v === r.v) },
  { label: "Spend", num: true, render: (r) => rs(r.spend), sort: (r) => r.spend },
  { label: "Revenue", num: true, render: (r) => rs(r.rev), sort: (r) => r.rev },
  { label: "ROI", num: true, render: (r) => <Roi r={r} />, sort: (r) => r.roi },
  { label: "Units", num: true, render: (r) => n0(r.units), sort: (r) => r.units },
  { label: "Clicks", num: true, render: (r) => n0(r.clicks), sort: (r) => r.clicks },
  { label: "CPC", num: true, render: (r) => rs2(r.cpc), sort: (r) => r.cpc },
  { label: "CVR", num: true, render: (r) => pct(r.cvr), sort: (r) => r.cvr },
];
const nameCell = (title: string, sub?: string) => (
  <>
    <span className="block font-bold [overflow-wrap:anywhere]">{title}</span>
    {sub ? <span className="block font-mono text-[11px] text-muted">{sub}</span> : null}
  </>
);

// ---- Sync: the four Seller Hub reports -----------------------------------------------------------------------------------

function SyncButton() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const sync = async (files: File[]) => {
    const done: string[] = [];
    try {
      for (const file of files) {
        setBusy(`Reading ${file.name}…`);
        const text = await file.text();
        const kind = adsFileKind(text);
        if (kind === "daily" || kind === "fsn") {
          const r = await syncAdsReport(text, file.name);
          if (!r.ok) {
            toast.result(r);
            continue;
          }
          done.push(kind === "daily" ? "Daily" : "SKU (FSN)");
        } else if (kind === "st" || kind === "kw") {
          const read = readAdsTermReport(text);
          if (!read.ok) {
            toast.result({ ok: false, message: read.error });
            continue;
          }
          const { from, to, rows, lines } = read.report;
          let ok = true;
          for (let i = 0; i < Math.max(1, rows.length) && ok; i += 2500) {
            setBusy(`Saving ${kind === "st" ? "search terms" : "keywords"}: ${Math.min(rows.length, i + 2500).toLocaleString("en-IN")} of ${rows.length.toLocaleString("en-IN")}`);
            const r = await saveAdTerms({ kind, from, to, rows: rows.slice(i, i + 2500), append: i > 0, lines });
            if (!r.ok) {
              toast.result(r);
              ok = false;
            }
          }
          if (ok) done.push(kind === "st" ? "Search Term" : "Keyword");
        } else toast.result({ ok: false, message: `${file.name} is not one of the four reports (Consolidated Daily, Consolidated FSN, Search Term, Keyword).` });
      }
      if (done.length) toast.result({ ok: true, message: `Synced: ${done.join(", ")}` });
    } catch {
      toast.result({ ok: false, message: "A file could not be read. Upload the reports as downloaded (CSV)." });
    } finally {
      setBusy(null);
      router.refresh();
    }
  };
  return (
    <label className={buttonClass("primary", busy ? "pointer-events-none opacity-70" : "cursor-pointer")} title="Upload the Seller Hub ads reports (any of the four, several at once)">
      <RefreshIcon className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
      {busy ?? "Sync reports"}
      <input
        id="desk-sync-files"
        type="file"
        accept=".csv,text/csv"
        multiple
        className="sr-only"
        disabled={Boolean(busy)}
        onChange={(e) => {
          const input = e.currentTarget;
          void sync([...(input.files ?? [])]).finally(() => (input.value = ""));
        }}
      />
    </label>
  );
}

// ---- The page ------------------------------------------------------------------------------------------------------------

type Tab = "overview" | "campaigns" | "products" | "terms" | "keywords" | "negatives" | "weekdays";
type Basis = "campaigns" | "products" | "terms" | "keywords";
const PRESETS: [RangePreset, string][] = [
  ["10x", "Last 10 days, without today and yesterday"],
  ["7", "Last 7 days"],
  ["14", "Last 14 days"],
  ["30", "Last 30 days"],
  ["all", "All synced days"],
];

function Change({ now, was, goodUp, fmt }: { now: number; was: number | null; goodUp: boolean | null; fmt?: (x: number) => string }) {
  if (was === null || !Number.isFinite(was) || was === 0) return null;
  const ch = now / was - 1;
  if (Math.abs(ch) < 0.005) return <span className="text-muted">no change</span>;
  const good = goodUp === null ? null : ch > 0 === goodUp;
  return (
    <span className={good === null ? "text-muted" : good ? "text-ok" : "text-bad"}>
      {ch > 0 ? "▲" : "▼"} {Math.abs(Math.round(ch * 100))}% <span className="text-muted">was {fmt ? fmt(was) : n0(was)}</span>
    </span>
  );
}

function Row({ title, sub, right, onClick, children }: { title: ReactNode; sub?: ReactNode; right: ReactNode; onClick?: () => void; children?: ReactNode }) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold">{title}</span>
        {sub ? <span className="block truncate text-xs text-muted">{sub}</span> : null}
        {children}
      </span>
      <span className="flex shrink-0 flex-col items-end font-mono text-sm tabular-nums">{right}</span>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="focus-ring flex w-full items-start gap-3 border-b border-line-soft py-2.5 text-left last:border-0 hover:bg-surface2/50">
      {body}
    </button>
  ) : (
    <div className="flex items-start gap-3 border-b border-line-soft py-2.5 last:border-0">{body}</div>
  );
}

export function AdsDesk({ raw, today }: { raw: unknown; today: string }) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const data: DeskData = useMemo(() => readDeskData(raw), [raw]);
  const [tab, setTab] = useState<Tab>("overview");
  const [preset, setPreset] = useState<RangePreset>("10x");
  const [basis, setBasis] = useState<Basis>("campaigns");
  const [filters, setFilters] = useState<Record<string, Verdict | "all">>({});
  const [open, setOpen] = useState<string | null>(null);
  const [neg, setNeg] = useState<{ cid: string; status: NegStatus }>({ cid: "all", status: "todo" });

  const days = useMemo(() => [...new Set(data.daily.map((d) => d.day))], [data]);
  const range = useMemo(() => rangeFor(days, preset, today), [days, preset, today]);
  const camps = useMemo(() => (range ? campaignRows(data.daily, range, S) : []), [data, range]);
  const prods = useMemo(() => (data.fsn ? productRows(data.fsn.rows, S) : []), [data]);
  const terms = useMemo(() => (data.st ? termRows(data.st.rows, S) : []), [data]);
  const kws = useMemo(() => (data.kw ? keywordRows(data.kw.rows, S) : []), [data]);
  const negs = useMemo(() => (data.st ? negativeRows(data.st.rows, data.neg, S) : []), [data]);
  const filterOf = (k: string) => filters[k] ?? "all";
  const setFilter = (k: string) => (v: Verdict | "all") => setFilters((f) => ({ ...f, [k]: v }));
  const goTo = (t: Tab, v?: Verdict) => {
    if (v) setFilters((f) => ({ ...f, [t]: v }));
    setTab(t);
    window.scrollTo({ top: 0 });
  };

  const header = (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Flipkart &amp; Shopsy · PLA ads</p>
        <h1 className="font-display text-[1.65rem] font-semibold tracking-tight">Ads Desk</h1>
        <p className="mt-0.5 text-sm text-muted">
          {range ? `${span(range.from, range.to)}${range.hasPrev ? `, compared with ${span(range.pFrom, range.pTo)}` : ""}` : "No reports synced yet."}{" "}
          <Link href="/ads" prefetch={false} className="font-semibold text-accent-text underline-offset-2 hover:underline">
            Ads tracker →
          </Link>
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {range ? (
          <select aria-label="Dates" className="input w-auto max-w-full" value={preset} onChange={(e) => setPreset(e.target.value as RangePreset)}>
            {PRESETS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        ) : null}
        <SyncButton />
      </div>
    </header>
  );

  if (!range) {
    return (
      <div className="flex min-w-0 flex-col gap-5">
        {header}
        <Panel title="Start by syncing the reports" sub="Seller Hub → Ads → Reports → Other Reports → PLA">
          <Note>Download the Consolidated Daily, Consolidated FSN, Search Term and Keyword reports for the same dates, then press Sync reports and choose all four files.</Note>
        </Panel>
      </div>
    );
  }

  const T = finish(total(camps), S);
  const P = range.hasPrev ? finish(total(camps.flatMap((c) => (c.prev ? [c.prev] : []))), S) : null;
  const losing = camps.filter((c) => c.v === "losing" || c.v === "zero");
  const worse = camps.filter((c) => c.worse);
  const room = camps.filter((c) => c.v === "winner" && (!c.prev || c.spend <= c.prev.spend * 1.05)).sort((a, b) => b.units - a.units);
  const cut = kws.filter((k) => k.cut).sort((a, b) => b.excess - a.excess);
  const spk = spikeRows(data.daily, range, S);
  const stRestSpend = data.st ? data.st.rest.reduce((n, r) => n + r.spend, 0) : 0;
  const stSpend = terms.reduce((n, t) => n + t.spend, 0) + stRestSpend;
  const zeroSpend = terms.filter((t) => t.v === "zero").reduce((n, t) => n + t.spend, 0);
  const todo = negs.filter((n) => n.status === "todo");
  const staleDays = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${range.max}T00:00:00Z`)) / 86_400_000);
  const snapNote = (name: string, s: { from: string; to: string } | null) => (s ? `${name} ${span(s.from, s.to)}` : `${name} not synced`);
  const flowRows: Record<Basis, { rows: Result[]; label: string; tab: Tab }> = {
    campaigns: { rows: camps, label: span(range.from, range.to), tab: "campaigns" },
    products: { rows: prods, label: data.fsn ? span(data.fsn.from, data.fsn.to) : "", tab: "products" },
    terms: { rows: terms, label: data.st ? span(data.st.from, data.st.to) : "", tab: "terms" },
    keywords: { rows: kws, label: data.kw ? span(data.kw.from, data.kw.to) : "", tab: "keywords" },
  };
  const fl = flowRows[basis];
  const groups = flow(fl.rows);
  const offenders = (cid: string) => {
    const k = kws.filter((x) => x.cid === cid && (x.v === "zero" || x.v === "losing") && x.spend >= S.minSpend / 2).slice(0, 2);
    const q = (data.st?.rows ?? [])
      .filter((x) => x.cid === cid)
      .map((x) => finish(x, S))
      .filter((x) => x.v === "zero" || x.v === "losing")
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 3 - k.length);
    if (!k.length && !q.length) return null;
    return (
      <span className="mt-1 flex flex-col gap-0.5 text-xs text-muted">
        {k.map((x) => (
          <span key={`k${x.key}`} className="truncate">
            <b className="font-mono text-[10px] text-ink">KW</b> {x.kw} · {rs(x.spend)} · {x.units ? `ROI ${roi2(x.roi)}` : "0 sales"}
          </span>
        ))}
        {q.map((x) => (
          <span key={`q${x.term}`} className="truncate">
            <b className="font-mono text-[10px] text-ink">ST</b> {x.term} · {rs(x.spend)} · {x.units ? `ROI ${roi2(x.roi)}` : "0 sales"}
          </span>
        ))}
      </span>
    );
  };
  const mark = (cid: string, term: string, status: NegStatus) =>
    startTransition(async () => {
      if (toast.result(await setAdNegative(cid, term, status))) router.refresh();
    });

  const TABS: [Tab, string, number | null][] = [
    ["overview", "Overview", null],
    ["campaigns", "Campaigns", camps.length],
    ["products", "Products", prods.length],
    ["terms", "Search terms", terms.length],
    ["keywords", "Keywords", kws.length],
    ["negatives", "Negative keywords", todo.length],
    ["weekdays", "Day of week", null],
  ];

  return (
    <div className="flex min-w-0 flex-col gap-5 [&>*]:min-w-0">
      {header}

      <p className={`rounded-xl border px-3 py-2 text-xs font-semibold ${staleDays > 3 ? "border-warn/40 bg-warn-soft text-warn" : "border-line-soft bg-surface2/50 text-muted"}`} role="status">
        Daily spend synced up to {dm(range.max)}
        {staleDays > 3 ? ` (${staleDays} days ago; sync is due)` : ""} · {snapNote("Products", data.fsn)} · {snapNote("Search terms", data.st)} · {snapNote("Keywords", data.kw)}. Results use break-even ROI {S.be}, good ROI{" "}
        {S.good}, and need ₹{S.minSpend} spend or {S.minClicks} clicks before judging.
      </p>

      <nav aria-label="Ads Desk sections" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:px-0 [&::-webkit-scrollbar]:hidden">
        {TABS.map(([k, label, count]) => (
          <button
            key={k}
            type="button"
            aria-current={tab === k ? "page" : undefined}
            onClick={() => setTab(k)}
            className={`focus-ring flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm font-bold ${tab === k ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-muted hover:text-ink"}`}
          >
            {label}
            {count ? <span className="font-mono text-xs tabular-nums opacity-80">{n0(count)}</span> : null}
          </button>
        ))}
      </nav>

      {tab === "overview" ? (
        <>
          <section className="sp-card sp-card-lg p-5 sm:p-6">
            <p className="font-display text-xl font-semibold leading-snug sm:text-2xl">
              <span style={{ color: "var(--madder)" }}>{inr(T.spend)}</span> <span className="text-muted">spent,</span> <span className="text-ok">{inr(T.rev)}</span> <span className="text-muted">back. ROI</span>{" "}
              <span style={{ color: roiColor(T.roi) }}>{roi2(T.roi)}</span>
              <span className="text-muted">.</span>{" "}
              {losing.length ? (
                <>
                  <span className="text-bad">{losing.length}</span> <span className="text-muted">{losing.length === 1 ? "campaign is" : "campaigns are"} losing money.</span>
                </>
              ) : null}
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
              {(
                [
                  ["Spend", inr(T.spend), <Change key="c" now={T.spend} was={P?.spend ?? null} goodUp={null} fmt={inr} />],
                  ["Revenue", inr(T.rev), <Change key="c" now={T.rev} was={P?.rev ?? null} goodUp fmt={inr} />],
                  ["ROI", roi2(T.roi), <Change key="c" now={T.roi} was={P?.roi ?? null} goodUp fmt={roi2} />],
                  ["Units", n0(T.units), <Change key="c" now={T.units} was={P?.units ?? null} goodUp />],
                  ["Cost per click", rs2(T.cpc), <Change key="c" now={T.cpc} was={P?.cpc ?? null} goodUp={false} fmt={rs2} />],
                  ["Conversion", pct(T.cvr), <Change key="c" now={T.cvr} was={P?.cvr ?? null} goodUp fmt={(x) => pct(x)} />],
                ] as [string, string, ReactNode][]
              ).map(([label, value, change]) => (
                <div key={label} className="min-w-0 rounded-xl bg-surface2/60 p-3">
                  <dt className="font-mono text-[11px] font-bold uppercase tracking-wider text-muted">{label}</dt>
                  <dd className="mt-1 font-mono text-xl font-bold tabular-nums">{value}</dd>
                  <dd className="text-[11px] font-bold">{change}</dd>
                </div>
              ))}
            </dl>
          </section>

          <Panel
            title="Where every rupee went"
            sub={fl.rows.length ? `Ad spend split by result · ${fl.label}. Tap a result to see its list.` : "This report is not synced yet."}
            action={
              <div role="group" aria-label="Split by" className="inline-flex rounded-xl border border-line bg-panel2 p-0.5">
                {(
                  [
                    ["campaigns", "Campaigns"],
                    ["products", "Products"],
                    ["terms", "Search terms"],
                    ["keywords", "Keywords"],
                  ] as [Basis, string][]
                ).map(([k, l]) => (
                  <button key={k} type="button" aria-pressed={basis === k} onClick={() => setBasis(k)} className={`focus-ring min-h-9 rounded-[10px] px-2.5 text-xs font-bold ${basis === k ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"}`}>
                    {l}
                  </button>
                ))}
              </div>
            }
          >
            {groups.length ? (
              <>
                <div className="flex h-12 overflow-hidden rounded-xl">
                  {groups
                    .filter((g) => g.spend > 0)
                    .map((g) => (
                      <button
                        key={g.v}
                        type="button"
                        title={`${g.label}: ${rs(g.spend)} (${pct(g.share)}) across ${g.n}`}
                        onClick={() => goTo(fl.tab, g.v)}
                        className="focus-ring flex min-w-1 items-center justify-center overflow-hidden text-xs font-bold text-white"
                        style={{ flex: `${g.share} 1 0`, background: V_COLOR[g.v] }}
                      >
                        {g.share > 0.09 ? inr(g.spend) : g.share > 0.04 ? `${Math.round(g.share * 100)}%` : ""}
                      </button>
                    ))}
                </div>
                <ul className="mt-3 grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                  {groups.map((g) => (
                    <li key={g.v}>
                      <button type="button" onClick={() => goTo(fl.tab, g.v)} className="focus-ring flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-surface2/60">
                        <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: V_COLOR[g.v] }} />
                        <span className="font-bold">{g.label}</span>
                        <span className="font-mono tabular-nums">{inr(g.spend)}</span>
                        <span className="text-muted">
                          {pct(g.share, 0)} · {n0(g.n)} · ROI {roi2(g.roi)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <Note>Sync this report to see the split.</Note>
            )}
          </Panel>

          <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
            <div className="flex min-w-0 flex-col gap-5">
              <Panel title="Losing money" sub={`ROI under ${S.be} · the worst keywords (KW) and search terms (ST) inside each`} action={losing.length > 8 ? <button type="button" className="text-xs font-bold text-accent-text" onClick={() => goTo("campaigns", "losing")}>All {losing.length} →</button> : null}>
                {losing.length ? (
                  losing.slice(0, 8).map((c) => (
                    <Row
                      key={c.cid}
                      title={c.name}
                      sub={`${n0(c.units)} units · CPC ${rs2(c.cpc)}`}
                      onClick={() => setOpen(c.cid)}
                      right={
                        <>
                          <b>{inr(c.spend)}</b>
                          <span style={{ color: roiColor(c.roi) }}>{c.units ? `ROI ${roi2(c.roi)}` : "0 sales"}</span>
                        </>
                      }
                    >
                      {offenders(c.cid)}
                    </Row>
                  ))
                ) : (
                  <Note>No campaign is under break-even.</Note>
                )}
              </Panel>
              <Panel title="Changed for the worse" sub={range.hasPrev ? `${span(range.from, range.to)} against ${span(range.pFrom, range.pTo)}` : "Needs daily spend for the days before"}>
                {worse.length ? (
                  worse.slice(0, 8).map((c) => (
                    <Row
                      key={c.cid}
                      title={c.name}
                      sub={c.why.join(" · ")}
                      onClick={() => setOpen(c.cid)}
                      right={
                        <>
                          <b>{inr(c.spend)}</b>
                          <span style={{ color: roiColor(c.roi) }}>ROI {roi2(c.roi)}</span>
                        </>
                      }
                    />
                  ))
                ) : (
                  <Note>Nothing got noticeably worse.</Note>
                )}
              </Panel>
              <div className="grid gap-5 sm:grid-cols-2">
                <Panel title="Bids to cut" sub={data.kw ? `${inr(cut.reduce((n, k) => n + k.excess, 0))} overspend · ${span(data.kw.from, data.kw.to)}` : undefined} action={cut.length > 6 ? <button type="button" className="text-xs font-bold text-accent-text" onClick={() => goTo("keywords")}>All {cut.length} →</button> : null}>
                  {!data.kw ? (
                    <Note>Sync the Keyword report.</Note>
                  ) : cut.length ? (
                    cut.slice(0, 6).map((k) => (
                      <Row
                        key={k.key}
                        title={
                          <>
                            {k.kw} <span className="font-mono text-[10px] text-muted">{k.mt}</span>
                          </>
                        }
                        sub={`${k.name} · paying ${rs2(k.cpc)}`}
                        onClick={() => setOpen(k.cid)}
                        right={
                          <>
                            <b className={k.units ? "" : "text-bad"}>{k.units ? `Bid ≤ ${rs2(k.beCpc)}` : "Pause"}</b>
                            <span className="text-muted">{rs(k.spend)}</span>
                          </>
                        }
                      />
                    ))
                  ) : (
                    <Note>No keyword is paying more than it earns.</Note>
                  )}
                </Panel>
                <Panel title="Winners with room" sub={`ROI ${S.good}+, ${S.minUnits}+ units, spend not growing`}>
                  {room.length ? (
                    room.slice(0, 6).map((c) => (
                      <Row
                        key={c.cid}
                        title={c.name}
                        sub={`${n0(c.units)} units${c.prev ? ` · spend ${c.spend >= c.prev.spend ? "flat" : `down ${Math.round((1 - c.spend / c.prev.spend) * 100)}%`}` : ""}`}
                        onClick={() => setOpen(c.cid)}
                        right={
                          <>
                            <b className="text-ok">ROI {roi2(c.roi)}</b>
                            <span className="text-muted">{inr(c.spend)}</span>
                          </>
                        }
                      />
                    ))
                  ) : (
                    <Note>No winners with flat or falling spend right now.</Note>
                  )}
                </Panel>
              </div>
            </div>
            <div className="flex min-w-0 flex-col gap-5">
              <Panel title="Leaks">
                <Row
                  title="Zero-sale search terms"
                  sub={data.st ? `${pct(stSpend ? zeroSpend / stSpend : 0)} of search spend · ${span(data.st.from, data.st.to)}` : "Sync the Search Term report"}
                  onClick={data.st ? () => goTo("negatives") : undefined}
                  right={<b className="text-bad">{data.st ? inr(zeroSpend) : "—"}</b>}
                />
                <Row title="Negative keywords to add" sub={`${todo.length} terms in campaigns, ₹${S.minSpend}+ each`} onClick={data.st ? () => goTo("negatives") : undefined} right={<b className="text-bad">{data.st ? inr(todo.reduce((n, x) => n + x.spend, 0)) : "—"}</b>} />
              </Panel>
              <Panel title="Spend spikes" sub="A day at 1.5× the campaign's usual day">
                {spk.length ? (
                  spk.slice(0, 6).map((x) => (
                    <Row
                      key={`${x.cid}${x.day}`}
                      title={x.name}
                      sub={`${dm(x.day)} · usual ${inr(x.avg)} · ROI ${roi2(x.roi)}`}
                      onClick={() => setOpen(x.cid)}
                      right={
                        <>
                          <b>{inr(x.spend)}</b>
                          <span className="text-muted">{x.ratio.toFixed(1)}×</span>
                        </>
                      }
                    />
                  ))
                ) : (
                  <Note>No spikes in these dates.</Note>
                )}
              </Panel>
            </div>
          </div>
        </>
      ) : null}

      {tab === "campaigns" ? (
        <Panel title="Every campaign" sub={`${span(range.from, range.to)} · tap one for its days, products, keywords and search terms`}>
          <DataTable
            rows={camps}
            initial={2}
            filter={filterOf("campaigns")}
            onFilter={setFilter("campaigns")}
            onRow={(c) => setOpen(c.cid)}
            search={(c) => `${c.name} ${c.cid}`}
            cols={[
              { label: "Campaign", wide: true, render: (c) => nameCell(c.name, c.cid), sort: (c) => c.name },
              ...metricCols<CampaignRow>(),
              { label: "Before", num: true, render: (c) => (c.prev ? <span className={c.worse ? "text-bad" : "text-muted"}>ROI {roi2(c.prev.roi)}</span> : <span className="text-muted">new</span>), sort: (c) => c.prev?.roi ?? -1 },
            ]}
          />
        </Panel>
      ) : null}

      {tab === "products" ? (
        <Panel title="Products" sub={data.fsn ? `SKU report · ${span(data.fsn.from, data.fsn.to)}` : undefined}>
          {data.fsn ? (
            <DataTable
              rows={prods}
              initial={2}
              filter={filterOf("products")}
              onFilter={setFilter("products")}
              search={(p) => p.sku}
              cols={[{ label: "SKU", wide: true, render: (p) => nameCell(p.sku, `${p.campaigns} ${p.campaigns === 1 ? "campaign" : "campaigns"}`), sort: (p) => p.sku }, ...metricCols<(typeof prods)[number]>()]}
            />
          ) : (
            <Note>Sync the Consolidated FSN Report to see products.</Note>
          )}
        </Panel>
      ) : null}

      {tab === "terms" ? (
        <Panel title="Search terms" sub={data.st ? `What shoppers typed · ${span(data.st.from, data.st.to)} · terms with a sale or ₹10+ spend (${inr(stRestSpend)} more went to ${n0(data.st.rest.reduce((n, r) => n + r.terms, 0))} smaller terms)` : undefined}>
          {data.st ? (
            <DataTable
              rows={terms}
              initial={2}
              filter={filterOf("terms")}
              onFilter={setFilter("terms")}
              search={(t) => t.term}
              cols={[{ label: "Search term", wide: true, render: (t) => nameCell(t.term, t.campaigns > 1 ? `${t.campaigns} campaigns` : undefined), sort: (t) => t.term }, ...metricCols<(typeof terms)[number]>()]}
            />
          ) : (
            <Note>Sync the Search Term report to see this.</Note>
          )}
        </Panel>
      ) : null}

      {tab === "keywords" ? (
        <Panel title="Keywords" sub={data.kw ? `Keyword report · ${span(data.kw.from, data.kw.to)} · top and bottom of search only. Bid guide: the bid for ROI ${S.good}, and the most a click can cost at break-even.` : undefined}>
          {data.kw ? (
            <DataTable
              rows={kws}
              initial={2}
              filter={filterOf("keywords")}
              onFilter={setFilter("keywords")}
              onRow={(k) => setOpen(k.cid)}
              search={(k) => `${k.kw} ${k.name}`}
              cols={[
                { label: "Keyword", wide: true, render: (k) => nameCell(`${k.kw} · ${k.mt}`, k.name), sort: (k) => k.kw },
                ...metricCols<(typeof kws)[number]>().slice(0, 7),
                {
                  label: "Bid guide",
                  num: true,
                  render: (k) => (k.units ? <span className={k.cut ? "text-bad" : ""}>{rs2(k.goodCpc)} <span className="text-muted">max {rs2(k.beCpc)}</span></span> : k.spend >= S.minSpend ? <span className="text-bad">Pause</span> : "—"),
                  sort: (k) => k.excess,
                },
              ]}
            />
          ) : (
            <Note>Sync the Keyword report to see keywords.</Note>
          )}
        </Panel>
      ) : null}

      {tab === "negatives" ? (
        <NegativesPanel negs={negs} state={neg} setState={setNeg} mark={mark} period={data.st ? span(data.st.from, data.st.to) : null} onCopied={(n) => toast.result({ ok: true, message: `Copied ${n} terms` })} />
      ) : null}

      {tab === "weekdays" ? (
        <Panel title="Day of week" sub={`${span(range.from, range.to)} · the whole account, per average day of each weekday`}>
          <div className="relative overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] font-bold uppercase tracking-wider text-muted">
                  {["Day", "Days", "Spend / day", "Revenue / day", "ROI", "Units / day", "CPC", "CVR"].map((h, i) => (
                    <th key={h} scope="col" className={`whitespace-nowrap px-2 py-2 ${i ? "text-right" : ""}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weekdayRows(data.daily, range.from, range.to, S).map((w) => (
                  <tr key={w.name} className="border-b border-line-soft">
                    <th scope="row" className="px-2 py-2 text-left font-bold">{w.name}</th>
                    {[String(w.days), w.days ? rs(w.spend) : "—", w.days ? rs(w.rev) : "—"].map((x, i) => (
                      <td key={i} className="px-2 py-2 text-right font-mono tabular-nums">{x}</td>
                    ))}
                    <td className="px-2 py-2 text-right font-mono font-bold tabular-nums" style={{ color: w.days ? roiColor(w.roi) : undefined }}>{w.days ? roi2(w.roi) : "—"}</td>
                    {[w.days ? n0(w.units) : "—", w.days ? rs2(w.cpc) : "—", w.days ? pct(w.cvr) : "—"].map((x, i) => (
                      <td key={i} className="px-2 py-2 text-right font-mono tabular-nums">{x}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted">Choose “Last 30 days” at the top for the steadiest picture: each weekday then appears four times.</p>
        </Panel>
      ) : null}

      <CampaignSheet cid={open} onClose={() => setOpen(null)} data={data} camps={camps} kws={kws} from={range.from} to={range.to} min={range.min} max={range.max} />
    </div>
  );
}

// ---- Negative keywords ---------------------------------------------------------------------------------------------------

function NegativesPanel({ negs, state, setState, mark, period, onCopied }: { negs: ReturnType<typeof negativeRows>; state: { cid: string; status: NegStatus }; setState: (s: { cid: string; status: NegStatus }) => void; mark: (cid: string, term: string, status: NegStatus) => void; period: string | null; onCopied: (n: number) => void }) {
  if (!period) return <Panel title="Negative keywords"><Note>Sync the Search Term report. Candidates are search terms that spent money and sold nothing, or sold at a very poor ROI.</Note></Panel>;
  const campaigns = new Map<string, { name: string; todo: number; waste: number }>();
  for (const n of negs) {
    const c = campaigns.get(n.cid) ?? { name: n.name, todo: 0, waste: 0 };
    if (n.status === "todo") {
      c.todo++;
      c.waste += n.spend;
    }
    campaigns.set(n.cid, c);
  }
  const inCampaign = negs.filter((n) => state.cid === "all" || n.cid === state.cid);
  const count = (s: NegStatus) => inCampaign.filter((n) => n.status === s).length;
  const rows = inCampaign.filter((n) => n.status === state.status);
  const copy = async () => {
    const list = [...new Set(rows.map((r) => r.term))];
    try {
      await navigator.clipboard.writeText(list.join("\n"));
      onCopied(list.length);
    } catch {
      window.prompt("Copy these terms:", list.join(", "));
    }
  };
  return (
    <Panel title="Negative keywords" sub={`${period} · search terms that spent ₹${S.minSpend}+ in a campaign with no sale, or sold at under ROI ${S.be / 2}. Add them as negatives in Flipkart, then mark them added here.`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select aria-label="Campaign" className="input min-h-10 w-full sm:w-auto sm:max-w-sm" value={state.cid} onChange={(e) => setState({ ...state, cid: e.target.value })}>
          <option value="all">All campaigns ({negs.filter((n) => n.status === "todo").length} to add)</option>
          {[...campaigns.entries()]
            .sort((a, b) => b[1].waste - a[1].waste)
            .map(([cid, c]) => (
              <option key={cid} value={cid}>
                {c.name} ({c.todo ? `${c.todo} to add, ${inr(c.waste)}` : "all handled"})
              </option>
            ))}
        </select>
        <div role="group" aria-label="Status" className="inline-flex rounded-xl border border-line bg-panel2 p-0.5">
          {(
            [
              ["todo", "To add"],
              ["added", "Added"],
              ["ignored", "Ignored"],
            ] as [NegStatus, string][]
          ).map(([k, l]) => (
            <button key={k} type="button" aria-pressed={state.status === k} onClick={() => setState({ ...state, status: k })} className={`focus-ring min-h-9 rounded-[10px] px-3 text-sm font-bold ${state.status === k ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"}`}>
              {l} <span className="font-mono text-xs tabular-nums">{count(k)}</span>
            </button>
          ))}
        </div>
        {rows.length ? (
          <button type="button" onClick={copy} className={buttonClass("secondary", "ml-auto")}>
            Copy {new Set(rows.map((r) => r.term)).size} terms
          </button>
        ) : null}
      </div>
      {rows.length ? (
        <ul className="divide-y divide-line-soft">
          {rows.slice(0, 300).map((n) => (
            <li key={`${n.cid}|${n.term}`} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
              <span className="min-w-0 flex-1 basis-56">
                <span className="block text-sm font-bold [overflow-wrap:anywhere]">{n.term}</span>
                <span className="block truncate text-xs text-muted">{n.name}</span>
              </span>
              <span className="font-mono text-sm tabular-nums">
                <b>{rs(n.spend)}</b> <span className="text-muted">· {n0(n.clicks)} clicks ·</span> <span style={{ color: roiColor(n.roi) }}>{n.units ? `ROI ${roi2(n.roi)}` : "0 sales"}</span>
              </span>
              <span className="flex gap-1.5">
                {n.status === "todo" ? (
                  <>
                    <button type="button" onClick={() => mark(n.cid, n.term, "added")} className={buttonClass("primary", "min-h-9 px-3")}>
                      Added
                    </button>
                    <button type="button" onClick={() => mark(n.cid, n.term, "ignored")} className={buttonClass("ghost", "min-h-9 px-3")}>
                      Ignore
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => mark(n.cid, n.term, "todo")} className={buttonClass("ghost", "min-h-9 px-3")}>
                    Undo
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Note>{state.status === "todo" ? "Nothing to add here." : "Nothing in this list yet."}</Note>
      )}
    </Panel>
  );
}

// ---- One campaign ----------------------------------------------------------------------------------------------------------

function MiniTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-line text-left text-[10px] font-bold uppercase tracking-wider text-muted">
            {head.map((h, i) => (
              <th key={h} scope="col" className={`whitespace-nowrap px-1.5 py-1.5 ${i ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line-soft">
              {r.map((c, j) => (
                <td key={j} className={`px-1.5 py-1.5 ${j ? "whitespace-nowrap text-right font-mono tabular-nums" : "font-semibold [overflow-wrap:anywhere]"}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CampaignSheet({ cid, onClose, data, camps, kws, from, to, min, max }: { cid: string | null; onClose: () => void; data: DeskData; camps: CampaignRow[]; kws: ReturnType<typeof keywordRows>; from: string; to: string; min: string; max: string }) {
  if (!cid) return null;
  const c = camps.find((x) => x.cid === cid);
  const name = c?.name ?? data.daily.find((d) => d.cid === cid)?.name ?? cid;
  const series = daySeries(data.daily, min, max, S, cid).slice(-21);
  const top = Math.max(1, ...series.map((d) => d.spend));
  const prods = data.fsn ? productRows(data.fsn.rows.filter((r) => r.cid === cid), S) : [];
  const myKw = kws.filter((k) => k.cid === cid);
  const myTerms = (data.st?.rows ?? []).filter((r) => r.cid === cid).map((r) => finish(r, S)).sort((a, b) => b.spend - a.spend);
  const h3 = "mb-1.5 mt-5 text-sm font-bold";
  return (
    <Sheet open onClose={onClose} title={name} subtitle={`Campaign ${cid} · ${span(from, to)}`}>
      {c ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Pill v={c.v} />
            {c.worse ? <span className="text-xs font-bold text-bad">Got worse: {c.why.join(" · ")}</span> : null}
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-2">
            {(
              [
                ["Spend", inr(c.spend), c.prev ? `was ${inr(c.prev.spend)}` : ""],
                ["Revenue", inr(c.rev), c.prev ? `was ${inr(c.prev.rev)}` : ""],
                ["ROI", roi2(c.roi), c.prev ? `was ${roi2(c.prev.roi)}` : ""],
                ["Units", n0(c.units), c.prev ? `was ${n0(c.prev.units)}` : ""],
                ["CPC", rs2(c.cpc), c.prev ? `was ${rs2(c.prev.cpc)}` : ""],
                ["Conversion", pct(c.cvr), c.prev ? `was ${pct(c.prev.cvr)}` : ""],
              ] as [string, string, string][]
            ).map(([l, v, w]) => (
              <div key={l} className="min-w-0 rounded-xl bg-surface2/60 p-2.5">
                <dt className="text-[10px] font-bold uppercase tracking-wider text-muted">{l}</dt>
                <dd className="font-mono text-base font-bold tabular-nums" style={l === "ROI" ? { color: roiColor(c.roi) } : undefined}>{v}</dd>
                <dd className="text-[11px] text-muted">{w}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <Note>No spend in the selected dates.</Note>
      )}

      <h3 className={h3}>Day by day <span className="font-normal text-muted">spend bars, ROI under each</span></h3>
      {series.length ? (
        <div className="flex h-36 items-end gap-1 overflow-x-auto" role="img" aria-label={`Spend per day: ${series.map((d) => `${dm(d.day)} ${rs(d.spend)} ROI ${roi2(d.roi)}`).join(", ")}`}>
          {series.map((d) => (
            <div key={d.day} title={`${dm(d.day)}: ${rs(d.spend)}, ROI ${roi2(d.roi)}, ${n0(d.units)} units`} className="flex h-full min-w-6 flex-1 flex-col items-center justify-end gap-0.5">
              <span className={`w-full rounded-t ${d.day >= from && d.day <= to ? "bg-accent" : "bg-surface2"}`} style={{ height: `${Math.max(2, (d.spend / top) * 100)}%` }} />
              <span className="font-mono text-[9px] font-bold" style={{ color: roiColor(d.roi) }}>{d.roi.toFixed(1)}</span>
              <span className="font-mono text-[9px] text-muted">{Number(d.day.slice(8))}</span>
            </div>
          ))}
        </div>
      ) : (
        <Note>No daily spend synced for this campaign.</Note>
      )}

      <h3 className={h3}>Products {data.fsn ? <span className="font-normal text-muted">{span(data.fsn.from, data.fsn.to)}</span> : null}</h3>
      {prods.length ? <MiniTable head={["SKU", "Spend", "ROI", "Units"]} rows={prods.slice(0, 12).map((p) => [p.sku, rs(p.spend), <Roi key="r" r={p} />, n0(p.units)])} /> : <Note>{data.fsn ? "No products for this campaign in the SKU report." : "Sync the Consolidated FSN Report."}</Note>}

      <h3 className={h3}>Keywords {data.kw ? <span className="font-normal text-muted">{span(data.kw.from, data.kw.to)}</span> : null}</h3>
      {myKw.length ? (
        <MiniTable
          head={["Keyword", "Spend", "ROI", "Units", "CPC", "Bid guide"]}
          rows={myKw.slice(0, 15).map((k) => [`${k.kw} · ${k.mt}`, rs(k.spend), <Roi key="r" r={k} />, n0(k.units), <span key="c" className={k.cut ? "text-bad" : ""}>{rs2(k.cpc)}</span>, k.units ? `≤ ${rs2(k.beCpc)}` : k.spend >= S.minSpend ? <span key="p" className="text-bad">Pause</span> : "—"])}
        />
      ) : (
        <Note>{data.kw ? "No keyword targeting here. Auto campaigns have no keywords; see the search terms below." : "Sync the Keyword report."}</Note>
      )}

      <h3 className={h3}>Search terms {data.st ? <span className="font-normal text-muted">{span(data.st.from, data.st.to)}</span> : null}</h3>
      {myTerms.length ? (
        <MiniTable head={["Search term", "Result", "Spend", "ROI", "Units"]} rows={myTerms.slice(0, 20).map((t) => [t.term, <Pill key="p" v={t.v} />, rs(t.spend), <Roi key="r" r={t} />, n0(t.units)])} />
      ) : (
        <Note>{data.st ? "No search terms with a sale or ₹10+ spend for this campaign." : "Sync the Search Term report."}</Note>
      )}
    </Sheet>
  );
}
