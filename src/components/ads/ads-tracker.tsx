"use client";

import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { RefreshIcon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { buttonClass, Chip, EmptyState } from "@/components/ui";
import { formatINR, formatNumber } from "@/lib/format";
import type { AdCampaignStatus } from "@/lib/types";
import { addTrackedSku, deleteAdCampaign, removeTrackedSku, saveAdCampaign, syncAdsReport } from "@/server/actions/ads";

// ---- What the page sends ---------------------------------------------------------------------------------------------

export type ScanRow = {
  sku: string;
  campaignId: string;
  campaignName: string;
  spend: number;
  views: number;
  clicks: number;
  units: number;
  revenue: number;
  /** Days the campaign ran inside the scan's period. */
  days: number;
  budget: number | null;
  shared: boolean;
  status: AdCampaignStatus | null;
};
export type CampaignLogRow = {
  campaignId: string;
  name: string;
  skus: string[];
  type: string | null;
  budget: number | null;
  shared: boolean;
  startDate: string | null;
  status: AdCampaignStatus;
  notes: string | null;
  source: "manual" | "report";
  createdAt: string;
  inScan: { spend: number; revenue: number; units: number } | null;
};
export type AdsView = {
  scans: { id: string; from: string; to: string; days: number; filename: string | null; createdAt: string }[];
  scanId: string | null;
  skus: string[];
  rows: ScanRow[];
  trend: { id: string; from: string; to: string; days: number; spend: number; avg: number }[];
  log: CampaignLogRow[];
};

// ---- Small helpers ---------------------------------------------------------------------------------------------------

const rs = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : formatINR(Math.round(n)));
/** ₹ in lakh for the big numbers (₹3.35L); exact rupees below a lakh. */
const short = (n: number) => (Math.abs(n) >= 1e5 ? `₹${(n / 1e5).toFixed(2)}L` : rs(n));
const roiText = (roi: number | null) => (roi == null || !Number.isFinite(roi) ? "—" : roi.toFixed(1));
const day = (d: string) => new Date(`${d}T12:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
const dayYear = (d: string) => new Date(`${d}T12:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const platformOf = (sku: string) => (/^SH[_-]/i.test(sku) ? "Shopsy" : "Flipkart");
/** Bad when money went out and nothing sold, or ROI is under 3.5; warning under 5. */
const roiTone = (spend: number, revenue: number, units: number): "ok" | "warn" | "bad" => {
  if (spend > 0 && units === 0) return "bad";
  const roi = spend > 0 ? revenue / spend : Infinity;
  return roi < 3.5 ? "bad" : roi < 5 ? "warn" : "ok";
};
const STATUS_TONE: Record<AdCampaignStatus, "ok" | "warn" | "neutral" | "info"> = { Live: "ok", Paused: "warn", Ended: "neutral", Draft: "info" };
const TYPES = ["Auto", "Keyword Exact", "Keyword Phrase", "ExactPhrase", "Kickstart / Growth", "Other"];

type SkuSummary = { sku: string; platform: string; rows: (ScanRow & { avg: number })[]; spend: number; avg: number; units: number; revenue: number; roi: number | null };
type SortKey = "sku" | "ads" | "spend" | "avg" | "units" | "revenue" | "roi";

function summarise(skus: string[], rows: ScanRow[]): SkuSummary[] {
  return skus.map((sku) => {
    const mine = rows.filter((r) => r.sku === sku).map((r) => ({ ...r, avg: r.spend / Math.max(1, r.days) }));
    mine.sort((a, b) => b.spend - a.spend);
    const spend = mine.reduce((n, r) => n + r.spend, 0);
    const revenue = mine.reduce((n, r) => n + r.revenue, 0);
    return { sku, platform: platformOf(sku), rows: mine, spend, avg: mine.reduce((n, r) => n + r.avg, 0), units: mine.reduce((n, r) => n + r.units, 0), revenue, roi: spend > 0 ? revenue / spend : null };
  });
}

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

// ---- Sync ------------------------------------------------------------------------------------------------------------

/** The Sync button: takes the PLA Consolidated FSN Report as downloaded from Seller Hub. */
function SyncButton() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const sync = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      if (toast.result(await syncAdsReport(await file.text(), file.name))) router.refresh();
    } catch {
      toast.result({ ok: false, message: "The file could not be read. Upload the report as downloaded (CSV)." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <label className={buttonClass("primary", busy ? "pointer-events-none opacity-60" : "cursor-pointer")} title="Upload the PLA Consolidated FSN Report from Seller Hub">
      <RefreshIcon className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
      {busy ? "Syncing…" : "Sync"}
      <input
        id="ads-sync-file"
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        disabled={busy}
        onChange={(e) => {
          const input = e.currentTarget;
          void sync(input.files?.[0] ?? undefined).finally(() => (input.value = ""));
        }}
      />
    </label>
  );
}

function HowToSync() {
  return (
    <details className="rounded-2xl border border-line-soft bg-surface2/40 px-4 py-3 text-sm">
      <summary className="focus-ring cursor-pointer rounded font-bold">How Sync works</summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
        <li>In Seller Hub open Ads, Reports, Other Reports.</li>
        <li>Choose PLA and Consolidated FSN Report, pick the dates (the last 7 days is usual) and press Download.</li>
        <li>Press Sync here and choose that file. Syncing the same dates again replaces them.</li>
      </ol>
      <p className="mt-2 text-xs text-muted">
        The weekly scan does this by itself every Tuesday morning. Campaigns found on tracked SKUs are added to the campaign log; add their daily budget and start date there so
        Avg / day is exact.
      </p>
    </details>
  );
}

// ---- Headline figures and the attention list -------------------------------------------------------------------------

function Kpis({ summary, rows, scan }: { summary: SkuSummary[]; rows: ScanRow[]; scan: AdsView["scans"][number] | null }) {
  const spend = summary.reduce((n, s) => n + s.spend, 0);
  const revenue = summary.reduce((n, s) => n + s.revenue, 0);
  const units = summary.reduce((n, s) => n + s.units, 0);
  const avg = summary.reduce((n, s) => n + s.avg, 0);
  const withAds = summary.filter((s) => s.rows.length).length;
  const tiles: [string, string, string][] = [
    ["Ad spend", short(spend), scan ? `${scan.days} days` : ""],
    ["Avg daily spend", rs(avg), "all campaigns added up"],
    ["Ad revenue", short(revenue), `${formatNumber(units)} units sold`],
    ["ROI", spend > 0 ? roiText(revenue / spend) : "—", "revenue ÷ spend"],
    ["SKUs with ads", `${withAds} / ${summary.length}`, `${summary.length - withAds} with no ad activity`],
    ["Campaigns", formatNumber(new Set(rows.map((r) => r.campaignId)).size), "running these SKUs"],
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {tiles.map(([label, value, foot]) => (
        <div key={label} className="sp-card min-w-0 p-4">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted">{label}</p>
          <p className="mt-1 font-mono text-xl font-bold tabular-nums">{value}</p>
          <p className="text-xs text-muted">{foot}</p>
        </div>
      ))}
    </div>
  );
}

type Flag = { r: SkuSummary["rows"][number]; tone: "bad" | "warn"; why: string; weight: number };

function Attention({ summary }: { summary: SkuSummary[] }) {
  const items = summary
    .flatMap((s) =>
      s.rows.flatMap((r): Flag[] => {
        if (r.spend >= 50 && r.units === 0) return [{ r, tone: "bad", why: `${rs(r.spend)} spent, no sales`, weight: r.spend * 10 }];
        if (r.spend >= 200 && r.revenue / r.spend < 3.5) return [{ r, tone: "warn", why: `ROI ${roiText(r.revenue / r.spend)} at ${rs(r.avg)} a day`, weight: r.spend }];
        return [];
      }),
    )
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 8);
  return (
    <Section id="ads-attention" title="Needs a look" sub="Campaigns with spend and no sales, or ROI under 3.5">
      {items.length ? (
        <ul className="grid gap-2">
          {items.map(({ r, tone, why }) => (
            <li key={`${r.sku}-${r.campaignId}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-surface2/50 px-3 py-2 text-sm">
              <Chip tone={tone}>{r.sku}</Chip>
              <span className="font-bold">{r.campaignName}</span>
              <span className="font-mono text-xs text-muted">{r.campaignId}</span>
              <span className="text-muted">{why}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Nothing below the line in this scan.</p>
      )}
    </Section>
  );
}

// ---- The SKU table ---------------------------------------------------------------------------------------------------

function CopyId({ id }: { id: string }) {
  const [done, setDone] = useState(false);
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs">
      <span className="select-all">{id}</span>
      <button
        type="button"
        className="focus-ring rounded-md border border-line px-1.5 py-0.5 text-[10px] font-bold text-muted hover:text-ink"
        aria-label={`Copy campaign ID ${id}`}
        onClick={(e) => {
          e.stopPropagation();
          navigator.clipboard?.writeText(id).then(
            () => {
              setDone(true);
              setTimeout(() => setDone(false), 1500);
            },
            () => undefined,
          );
        }}
      >
        {done ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

function SkuTable({ summary }: { summary: SkuSummary[] }) {
  const [platform, setPlatform] = useState<"all" | "Flipkart" | "Shopsy">("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "spend", dir: -1 });
  const [open, setOpen] = useState<Set<string>>(new Set());

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = summary.filter(
      (s) => (platform === "all" || s.platform === platform) && (!q || s.sku.toLowerCase().includes(q) || s.rows.some((r) => r.campaignName.toLowerCase().includes(q) || r.campaignId.toLowerCase().includes(q))),
    );
    const val = (s: SkuSummary): number | string => (sort.key === "sku" ? s.sku : sort.key === "ads" ? s.rows.length : sort.key === "roi" ? (s.roi ?? -1) : s[sort.key]);
    return shown.sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return typeof x === "string" ? sort.dir * x.localeCompare(String(y)) : sort.dir * (x - Number(y));
    });
  }, [summary, platform, query, sort]);
  const maxAvg = Math.max(1, ...list.map((s) => s.avg));
  const toggle = (sku: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });
  const head = (key: SortKey, label: string, right = true) => (
    <th scope="col" className={`whitespace-nowrap px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-muted ${right ? "text-right" : "text-left"}`} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className="focus-ring rounded" onClick={() => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "sku" ? 1 : -1 }))}>
        {label}
        {sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
      </button>
    </th>
  );

  return (
    <Section
      id="ads-skus"
      title="Every tracked SKU"
      sub="Tap a SKU to see its campaigns with name and ID. Avg / day is spend ÷ the days each campaign ran in the period. A shared budget is one campaign advertising several SKUs."
      action={
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Platform" className="inline-flex overflow-hidden rounded-xl border border-line">
            {(["all", "Flipkart", "Shopsy"] as const).map((p) => (
              <button key={p} type="button" aria-pressed={platform === p} onClick={() => setPlatform(p)} className={`focus-ring min-h-10 px-3 text-sm font-bold ${platform === p ? "bg-accent-soft text-accent-text" : "text-muted hover:bg-surface2"}`}>
                {p === "all" ? "All" : p}
              </button>
            ))}
          </div>
          <input id="ads-search" type="search" className="input max-w-56" placeholder="Search SKU or campaign" aria-label="Search SKU or campaign" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      }
    >
      <div className="overflow-x-auto rounded-2xl border border-line-soft">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead className="bg-surface2/40">
            <tr>
              {head("sku", "SKU", false)}
              <th scope="col" className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-muted">
                Platform
              </th>
              {head("ads", "Ads")}
              {head("spend", "Spend")}
              {head("avg", "Avg / day")}
              <th scope="col" className="w-24 px-3 py-2">
                <span className="sr-only">Avg / day bar</span>
              </th>
              {head("units", "Units")}
              {head("revenue", "Revenue")}
              {head("roi", "ROI")}
            </tr>
          </thead>
          <tbody>
            {list.length ? (
              list.map((s) => {
                const isOpen = open.has(s.sku);
                const has = s.rows.length > 0;
                return (
                  <Fragment key={s.sku}>
                    <tr className="cursor-pointer border-t border-line-soft hover:bg-surface2/40" onClick={() => toggle(s.sku)}>
                      <td className="px-3 py-2">
                        <button type="button" aria-expanded={isOpen} className="focus-ring flex items-center gap-1.5 rounded font-mono font-bold" onClick={(e) => (e.stopPropagation(), toggle(s.sku))}>
                          <span aria-hidden="true" className={`inline-block text-muted transition-transform ${isOpen ? "rotate-90" : ""}`}>
                            ›
                          </span>
                          {s.sku}
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <Chip tone={s.platform === "Shopsy" ? "warn" : "accent"}>{s.platform}</Chip>
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{has ? s.rows.length : <Chip tone="bad">No ads</Chip>}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{has ? rs(s.spend) : "—"}</td>
                      <td className="px-3 py-2 text-right font-mono font-bold tabular-nums">{has ? rs(s.avg) : "—"}</td>
                      <td className="px-3 py-2">{has ? <span className="block h-1.5 rounded-full bg-accent/70" style={{ width: `${Math.max(3, (s.avg / maxAvg) * 100)}%` }} /> : null}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{has ? formatNumber(s.units) : "—"}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{has ? rs(s.revenue) : "—"}</td>
                      <td className="px-3 py-2 text-right">{has ? <Chip tone={roiTone(s.spend, s.revenue, s.units)}>{roiText(s.roi)}</Chip> : "—"}</td>
                    </tr>
                    {isOpen ? (
                      <tr className="bg-surface2/30">
                        <td colSpan={9} className="px-3 pb-4 pt-1">
                          {has ? (
                            <div className="overflow-x-auto">
                              <table className="w-full min-w-[820px] border-collapse text-xs">
                                <thead>
                                  <tr className="text-[10px] uppercase tracking-wide text-muted">
                                    {["Campaign", "Campaign ID", "Status", "Daily budget", "Spend", "Avg / day", "Days", "Views", "Clicks", "Units", "Revenue", "ROI"].map((h, i) => (
                                      <th key={h} scope="col" className={`px-2 py-1.5 font-bold ${i >= 3 ? "text-right" : "text-left"}`}>
                                        {h}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {s.rows.map((r) => (
                                    <tr key={r.campaignId} className="border-t border-line-soft">
                                      <td className="px-2 py-1.5 font-bold">{r.campaignName}</td>
                                      <td className="px-2 py-1.5">
                                        <CopyId id={r.campaignId} />
                                      </td>
                                      <td className="px-2 py-1.5">{r.status ? <Chip tone={STATUS_TONE[r.status]}>{r.status}</Chip> : <span className="text-muted">Not in log</span>}</td>
                                      <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                                        {rs(r.budget)}
                                        {r.shared ? <span className="ml-1.5 rounded-full bg-surface2 px-1.5 py-0.5 text-[10px] font-bold text-muted">shared</span> : null}
                                      </td>
                                      <td className="px-2 py-1.5 text-right font-mono tabular-nums">{rs(r.spend)}</td>
                                      <td className="px-2 py-1.5 text-right font-mono font-bold tabular-nums">{rs(r.avg)}</td>
                                      <td className="px-2 py-1.5 text-right font-mono tabular-nums">{r.days}</td>
                                      <td className="px-2 py-1.5 text-right font-mono tabular-nums">{formatNumber(r.views)}</td>
                                      <td className="px-2 py-1.5 text-right font-mono tabular-nums">{formatNumber(r.clicks)}</td>
                                      <td className="px-2 py-1.5 text-right font-mono tabular-nums">{formatNumber(r.units)}</td>
                                      <td className="px-2 py-1.5 text-right font-mono tabular-nums">{rs(r.revenue)}</td>
                                      <td className="px-2 py-1.5 text-right">
                                        <Chip tone={roiTone(r.spend, r.revenue, r.units)}>{roiText(r.spend > 0 ? r.revenue / r.spend : null)}</Chip>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <p className="py-2 text-sm text-muted">No ad spend or views for this SKU in this period. Put it in a campaign, then log the campaign below.</p>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })
            ) : (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-muted">
                  No SKU matches.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ---- Trend -----------------------------------------------------------------------------------------------------------

function Trend({ trend, scanId }: { trend: AdsView["trend"]; scanId: string | null }) {
  const max = Math.max(1, ...trend.map((t) => t.avg)) * 1.18;
  return (
    <Section id="ads-trend" title="Average daily spend, scan by scan" sub={trend.length < 2 ? "The trend fills in from the second scan." : `Last ${trend.length} scans, tracked SKUs only`}>
      {trend.length ? (
        <div className="flex h-44 items-end gap-3 overflow-x-auto" role="img" aria-label={`Average daily spend: ${trend.map((t) => `${day(t.to)} ${rs(t.avg)}`).join(", ")}`}>
          {trend.map((t) => (
            <div key={t.id} className="flex h-full min-w-16 flex-1 flex-col items-center justify-end gap-1">
              <span className="font-mono text-[11px] font-bold tabular-nums">{rs(t.avg)}</span>
              <span className={`w-full max-w-14 rounded-t-lg ${t.id === scanId ? "bg-accent" : "bg-surface2"}`} style={{ height: `${Math.max(2, (t.avg / max) * 100)}%` }} />
              <span className="whitespace-nowrap font-mono text-[11px] text-muted">{day(t.to)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">No scans yet.</p>
      )}
    </Section>
  );
}

// ---- Campaign log ----------------------------------------------------------------------------------------------------

type Draft = { campaignId: string; name: string; skus: string; type: string; budget: string; shared: boolean; startDate: string; status: AdCampaignStatus; notes: string };
const EMPTY: Draft = { campaignId: "", name: "", skus: "", type: "Auto", budget: "", shared: false, startDate: "", status: "Live", notes: "" };

function CampaignForm({ initial, editing, onDone }: { initial: Draft; editing: boolean; onDone: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [d, setD] = useState<Draft>(initial);
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((cur) => ({ ...cur, [k]: v }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const budget = d.budget.replace(/[,₹\s]/g, "");
    if (budget !== "" && !(Number(budget) >= 0)) return toast.result({ ok: false, message: "Daily budget should be a number of rupees." });
    startTransition(async () => {
      const res = await saveAdCampaign({
        campaignId: d.campaignId,
        name: d.name,
        skus: d.skus.split(/[,\s]+/).filter(Boolean),
        type: d.type || null,
        dailyBudget: budget === "" ? null : Number(budget),
        sharedBudget: d.shared,
        startDate: d.startDate || null,
        status: d.status,
        notes: d.notes.trim() || null,
      });
      if (toast.result(res)) {
        onDone();
        router.refresh();
      }
    });
  };
  const label = "flex flex-col gap-1 text-xs font-bold text-muted";
  return (
    <form onSubmit={submit} className="mb-5 grid gap-3 rounded-2xl border border-line-soft bg-surface2/30 p-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className={label}>
        Campaign name
        <input id="ads-f-name" className="input" required maxLength={200} value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="HFLY1_Auto" />
      </label>
      <label className={label}>
        Campaign ID
        <input id="ads-f-id" className="input font-mono uppercase" required maxLength={30} value={d.campaignId} readOnly={editing} onChange={(e) => set("campaignId", e.target.value)} placeholder="7SCQQ9CHX7RP" />
      </label>
      <label className={`${label} sm:col-span-2`}>
        SKUs (comma separated)
        <input id="ads-f-skus" className="input font-mono uppercase" required maxLength={2000} value={d.skus} onChange={(e) => set("skus", e.target.value)} placeholder="HFLY1, SH_HFLY1" />
      </label>
      <label className={label}>
        Type
        <select id="ads-f-type" className="input" value={d.type} onChange={(e) => set("type", e.target.value)}>
          {TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <label className={label}>
        Daily budget (₹)
        <input id="ads-f-budget" className="input font-mono" inputMode="numeric" value={d.budget} onChange={(e) => set("budget", e.target.value)} placeholder="800" />
      </label>
      <label className={label}>
        Start date
        <input id="ads-f-start" className="input" type="date" value={d.startDate} onChange={(e) => set("startDate", e.target.value)} />
      </label>
      <label className={label}>
        Status
        <select id="ads-f-status" className="input" value={d.status} onChange={(e) => set("status", e.target.value as AdCampaignStatus)}>
          {(["Live", "Paused", "Ended", "Draft"] as const).map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <label className={`${label} sm:col-span-2 lg:col-span-3`}>
        Notes
        <input id="ads-f-notes" className="input" maxLength={500} value={d.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Why it was made, target ROI, bids…" />
      </label>
      <label className="flex items-center gap-2 self-end pb-3 text-sm font-semibold">
        <input id="ads-f-shared" type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={d.shared} onChange={(e) => set("shared", e.target.checked)} />
        Budget shared with other SKUs
      </label>
      <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4">
        <button type="submit" className={buttonClass("primary")} disabled={pending}>
          {pending ? "Saving…" : editing ? "Save campaign" : "Add campaign"}
        </button>
        <button type="button" className={buttonClass("ghost")} onClick={onDone} disabled={pending}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function RemoveButton({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [armed, setArmed] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className={`focus-ring rounded-lg px-2 py-1 text-xs font-bold ${armed ? "bg-bad-soft text-bad" : "text-muted hover:text-bad"}`}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          setTimeout(() => setArmed(false), 3000);
          return;
        }
        startTransition(async () => {
          if (toast.result(await deleteAdCampaign(campaignId))) router.refresh();
        });
      }}
    >
      {pending ? "Removing…" : armed ? "Confirm remove" : "Remove"}
    </button>
  );
}

function CampaignLog({ log }: { log: CampaignLogRow[] }) {
  const [editing, setEditing] = useState<Draft | null>(null);
  const [isEdit, setIsEdit] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const sorted = [...log].sort((a, b) => Number(!a.inScan) - Number(!b.inScan) || (b.inScan?.spend ?? 0) - (a.inScan?.spend ?? 0) || b.createdAt.localeCompare(a.createdAt));
  const waiting = log.filter((c) => !c.inScan && c.status === "Live").length;
  const open = (draft: Draft, edit: boolean) => {
    setEditing(draft);
    setIsEdit(edit);
    setFormKey((k) => k + 1);
    document.getElementById("ads-log")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <Section
      id="ads-log"
      title="Campaign log"
      sub={`${log.length} campaigns${waiting ? ` · ${waiting} live with no spend in this period` : ""}. Add each new campaign when you make it; a sync fills in its numbers.`}
      action={
        editing ? null : (
          <button type="button" className={buttonClass("secondary")} onClick={() => open(EMPTY, false)}>
            + Add campaign
          </button>
        )
      }
    >
      {editing ? <CampaignForm key={formKey} initial={editing} editing={isEdit} onDone={() => setEditing(null)} /> : null}
      {sorted.length ? (
        <div className="overflow-x-auto rounded-2xl border border-line-soft">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead className="bg-surface2/40 text-[11px] uppercase tracking-wide text-muted">
              <tr>
                {["Campaign", "Campaign ID", "SKUs", "Status", "Daily budget", "Start", "Spend (period)", "ROI", ""].map((h, i) => (
                  <th key={h || "actions"} scope="col" className={`px-3 py-2 font-bold ${i === 4 || i === 6 || i === 7 ? "text-right" : "text-left"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => (
                <tr key={c.campaignId} className="border-t border-line-soft align-top">
                  <td className="px-3 py-2">
                    <p className="font-bold">{c.name}</p>
                    <p className="text-xs text-muted">
                      {c.type ?? "—"}
                      {c.source === "report" ? " · found by a sync" : " · added by hand"}
                      {c.notes ? ` · ${c.notes}` : ""}
                    </p>
                  </td>
                  <td className="px-3 py-2">
                    <CopyId id={c.campaignId} />
                  </td>
                  <td className="max-w-56 px-3 py-2 font-mono text-xs">{c.skus.join(", ")}</td>
                  <td className="px-3 py-2">
                    <Chip tone={STATUS_TONE[c.status]}>{c.status}</Chip>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {rs(c.budget)}
                    {c.shared ? <span className="ml-1.5 rounded-full bg-surface2 px-1.5 py-0.5 text-[10px] font-bold text-muted">shared</span> : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">{c.startDate ? dayYear(c.startDate) : "—"}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{c.inScan ? rs(c.inScan.spend) : <Chip tone="warn">No spend yet</Chip>}</td>
                  <td className="px-3 py-2 text-right">{c.inScan ? <Chip tone={roiTone(c.inScan.spend, c.inScan.revenue, c.inScan.units)}>{roiText(c.inScan.spend > 0 ? c.inScan.revenue / c.inScan.spend : null)}</Chip> : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <button
                      type="button"
                      className="focus-ring rounded-lg px-2 py-1 text-xs font-bold text-accent-text hover:bg-accent-soft"
                      onClick={() =>
                        open(
                          {
                            campaignId: c.campaignId,
                            name: c.name,
                            skus: c.skus.join(", "),
                            type: c.type ?? "Other",
                            budget: c.budget == null ? "" : String(c.budget),
                            shared: c.shared,
                            startDate: c.startDate ?? "",
                            status: c.status,
                            notes: c.notes ?? "",
                          },
                          true,
                        )
                      }
                    >
                      Edit
                    </button>
                    {c.createdAt ? <RemoveButton campaignId={c.campaignId} /> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted">No campaigns yet. Add your first one, or press Sync.</p>
      )}
    </Section>
  );
}

// ---- Tracked SKUs ----------------------------------------------------------------------------------------------------

function TrackedSkus({ skus, active }: { skus: string[]; active: Set<string> }) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState("");
  const [pending, startTransition] = useTransition();
  const add = (e: FormEvent) => {
    e.preventDefault();
    const sku = value.trim().toUpperCase();
    if (!sku) return;
    if (skus.includes(sku)) return toast.result({ ok: false, message: `${sku} is already tracked.` });
    startTransition(async () => {
      if (toast.result(await addTrackedSku(sku))) {
        setValue("");
        router.refresh();
      }
    });
  };
  const remove = (sku: string) =>
    startTransition(async () => {
      if (toast.result(await removeTrackedSku(sku))) router.refresh();
    });
  return (
    <Section id="ads-tracked" title="Tracked SKUs" sub={`${skus.length} SKUs. Dashed ones had no ad activity in this period. SKUs starting SH_ are Shopsy listings.`}>
      <form onSubmit={add} className="mb-4 flex flex-wrap gap-2">
        <input id="ads-add-sku" className="input max-w-64 font-mono uppercase" placeholder="Seller SKU, e.g. HFLY2" aria-label="Seller SKU to track" maxLength={60} value={value} onChange={(e) => setValue(e.target.value)} />
        <button type="submit" className={buttonClass("secondary")} disabled={pending}>
          Track SKU
        </button>
      </form>
      <ul className="flex flex-wrap gap-2">
        {skus.map((sku) => (
          <li key={sku} className={`inline-flex items-center gap-1 rounded-full border py-1 pl-3 pr-1 font-mono text-xs ${active.has(sku) ? "border-line bg-surface" : "border-dashed border-line text-muted"}`}>
            {sku}
            <button type="button" disabled={pending} aria-label={`Stop tracking ${sku}`} className="focus-ring flex h-6 w-6 items-center justify-center rounded-full text-muted hover:bg-bad-soft hover:text-bad" onClick={() => remove(sku)}>
              ×
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ---- The page --------------------------------------------------------------------------------------------------------

export function AdsTracker({ view }: { view: AdsView | null }) {
  const router = useRouter();
  const summary = useMemo(() => (view ? summarise(view.skus, view.rows) : []), [view]);
  if (!view) {
    return (
      <div className="flex min-w-0 flex-col gap-5">
        <h1 className="font-display text-[1.65rem] font-semibold tracking-tight">Ads tracker</h1>
        <EmptyState
          title="The Ads tracker isn't set up in the database yet"
          body="Apply the migrations 20261021090000_ads_tracker.sql and 20261021091000_ads_tracker_first_scan.sql (in supabase/migrations) to the Supabase project, then reload this page."
        />
      </div>
    );
  }
  const scan = view.scans.find((s) => s.id === view.scanId) ?? null;
  const active = new Set(view.rows.map((r) => r.sku));
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Flipkart &amp; Shopsy · PLA ads</p>
          <h1 className="font-display text-[1.65rem] font-semibold tracking-tight">Ads tracker</h1>
          <p className="mt-0.5 text-sm text-muted">
            {scan
              ? `${scan.days}-day period, ${dayYear(scan.from)} to ${dayYear(scan.to)} · synced ${new Date(scan.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}`
              : "No scan yet. Press Sync to load the first report."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {view.scans.length ? (
            <select id="ads-scan" aria-label="Choose a scan" className="input w-auto" value={view.scanId ?? ""} onChange={(e) => router.push(`/ads?scan=${encodeURIComponent(e.target.value)}`)}>
              {view.scans.map((s) => (
                <option key={s.id} value={s.id}>
                  {day(s.from)} – {dayYear(s.to)}
                </option>
              ))}
            </select>
          ) : null}
          <SyncButton />
        </div>
      </header>
      <HowToSync />
      <Kpis summary={summary} rows={view.rows} scan={scan} />
      <Attention summary={summary} />
      <SkuTable summary={summary} />
      <Trend trend={view.trend} scanId={view.scanId} />
      <CampaignLog log={view.log} />
      <TrackedSkus skus={view.skus} active={active} />
    </div>
  );
}
