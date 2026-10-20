"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { SearchIcon } from "@/components/icons";
import { UploadReport } from "@/components/money/upload-report";
import { useToast } from "@/components/toast";
import { buttonClass, Chip } from "@/components/ui";
import { masterUnitCost, skuCost, type MasterInfo, type MonthCounts, type PnlLine } from "@/lib/costing";
import { formatINR, formatNumber } from "@/lib/format";
import { linkSku } from "@/server/actions/masters";
import { saveMasterCosts, uploadAdsReport } from "@/server/actions/pnl";

export type UnlinkedSku = { sku: string; title: string | null; units: number; sales: number };
export type AdsUpload = { month: string; label: string; from: string; to: string; filename: string | null; skus: number; spend: number; uploadedAt: string };
export type MonthPnl = {
  month: string;
  label: string;
  from: string | null;
  to: string | null;
  total: PnlLine;
  counts: MonthCounts;
  byMaster: (PnlLine & { id: string; name: string })[];
  unlinked: UnlinkedSku[];
  adsUpload: AdsUpload | null;
};
export type CostingRow = { id: string; name: string; cost: number | null; kitParts: { id: string; name: string; qty: number }[]; skus: { sku: string; units: number }[] };

const day = (d: string) => new Date(`${d}T12:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
// Margin after ads.
const margin = (l: PnlLine) => (l.sales > 0 ? Math.round((l.net / l.sales) * 100) : null);
const money = (n: number) => formatINR(Math.round(n));
const parse = (s: string): number | null => {
  const t = s.replace(/[,₹\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
};

function ProfitText({ value, className = "" }: { value: number; className?: string }) {
  return <span className={`${value < 0 ? "text-bad" : "text-ok"} ${className}`}>{value < 0 ? `−${money(-value)}` : money(value)}</span>;
}

// ---- Profit and loss by month -------------------------------------------------------------------------------------

/** Flipkart SKUs sold in the month that belong to no master SKU, so they have no cost: link each to its master here. */
function Unlinked({ m, masters }: { m: MonthPnl; masters: { id: string; name: string }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [pick, setPick] = useState<Record<string, { master: string; units: string }>>({});
  const units = m.unlinked.reduce((n, r) => n + r.units, 0);
  const sales = m.unlinked.reduce((n, r) => n + r.sales, 0);
  const link = (sku: string) =>
    startTransition(async () => {
      const p = pick[sku];
      const n = Number(p?.units || "1");
      if (toast.result(await linkSku(sku, p?.master ?? "", n))) router.refresh();
    });
  return (
    <section id="unlinked" className="sp-card mt-5 scroll-mt-20 overflow-hidden" aria-labelledby="unlinked-title">
      <div className="px-5 pt-5 sm:px-6">
        <h2 id="unlinked-title" className="font-display text-lg font-semibold">
          Not linked to a master, {m.label}
        </h2>
        <p className="pb-3 text-xs text-muted">
          {m.unlinked.length} Flipkart {m.unlinked.length === 1 ? "SKU" : "SKUs"}, {formatNumber(units)} units, {money(sales)} of sales with no cost. Pick each one&apos;s master SKU and how many
          units one order has (2 for a pack of 2), then press Link; its cost then counts here and on the Master SKU sheet.
        </p>
      </div>
      <ul className="divide-y divide-line-soft border-t border-line">
        {m.unlinked.map((r) => {
          const p = pick[r.sku] ?? { master: "", units: "1" };
          const set = (v: Partial<typeof p>) => setPick((x) => ({ ...x, [r.sku]: { ...p, ...v } }));
          return (
            <li key={r.sku} className="grid gap-2 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-6">
              <div className="min-w-0">
                <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="font-mono text-sm font-bold">{r.sku}</span>
                  <span className="font-mono text-xs text-muted tabular-nums">
                    {formatNumber(r.units)} units · {money(r.sales)}
                  </span>
                </p>
                {r.title ? <p className="truncate text-xs text-muted">{r.title}</p> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="min-w-0 flex-1 sm:w-56 sm:flex-none">
                  <span className="sr-only">Master SKU for {r.sku}</span>
                  <select className="input w-full" value={p.master} onChange={(e) => set({ master: e.target.value })}>
                    <option value="">Master SKU…</option>
                    {masters.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1.5 text-xs font-semibold text-muted">
                  Units
                  <input className="input w-16 font-mono" inputMode="numeric" value={p.units} onChange={(e) => set({ units: e.target.value.replace(/[^0-9]/g, "") })} aria-label={`Units per order for ${r.sku}`} />
                </label>
                <button type="button" disabled={pending || !p.master} onClick={() => link(r.sku)} className={buttonClass("primary")}>
                  Link
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function MonthView({ m, feePct, masters }: { m: MonthPnl; feePct: number; masters: { id: string; name: string }[] }) {
  const t = m.total;
  const mg = margin(t);
  return (
    <>
      <section className="sp-card sp-card-lg p-5 sm:p-6" aria-labelledby="pnl-month">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="pnl-month" className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
            {t.net < 0 ? "Loss" : "Profit"} in {m.label}
            {t.ads > 0 ? ", after ads" : ""}
          </h2>
          {m.from && m.to ? <span className="text-xs text-muted">Orders {day(m.from)} to {day(m.to)}</span> : null}
        </div>
        <p className="mt-3 font-mono text-[2.8rem] font-bold leading-none tracking-tight tabular-nums sm:text-6xl">
          <ProfitText value={t.net} />
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
          {formatNumber(t.units)} units sold{mg !== null ? <Chip tone={mg < 0 ? "bad" : mg < 10 ? "warn" : "ok"}>{mg}% margin</Chip> : null}
        </p>
        <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4 sm:grid-cols-5">
          {[
            ["Sales", money(t.sales)],
            ["Flipkart fees", `−${money(t.fees)}`],
            ["Product cost", `−${money(t.cost)}`],
            ["Ads (incl. 18% GST)", m.adsUpload || t.ads > 0 ? `−${money(t.ads)}` : "not added"],
            ["Units sold", formatNumber(t.units)],
          ].map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[11px] font-bold uppercase tracking-wider text-muted">{k}</dt>
              <dd className="mt-1 font-mono text-lg font-bold tabular-nums sm:text-xl">{v}</dd>
            </div>
          ))}
        </dl>
        {m.from && m.from > `${m.month}-01` ? (
          <p className="mt-4 rounded-lg bg-bad-soft px-3 py-2 text-sm font-semibold text-bad">
            Only orders from {day(m.from)} are in the app: {day(`${m.month}-01`)} to {day(new Date(Date.parse(`${m.from}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10))} are missing, so
            this month is short. Older orders are read from Flipkart at night (10:15 pm to 6:45 am) once asked for.
          </p>
        ) : null}
        {t.uncostedSales > 0 ? (
          <p className="mt-4 rounded-lg bg-warn-soft px-3 py-2 text-sm font-semibold text-warn">
            {money(t.uncostedSales)} of these sales are for master SKUs with no cost yet, so the profit shows too high. Add their costs below.
          </p>
        ) : null}
        {!m.adsUpload ? (
          <p className="mt-2 text-sm font-semibold text-warn">
            Ads spend for {m.label} is not added yet. Upload that month&apos;s Flipkart Ads report below.
          </p>
        ) : m.from && m.adsUpload.to < (m.to ?? "") ? (
          <p className="mt-2 text-xs text-muted">The ads report covers up to {day(m.adsUpload.to)}; upload a newer one to include later ad spend.</p>
        ) : null}
        <p className="mt-4 text-xs text-muted">
          Orders {formatNumber(m.counts.ordered + m.counts.cancelled)} · cancelled {formatNumber(m.counts.cancelled)} · returned by customers {formatNumber(m.counts.custReturned)} · net{" "}
          {formatNumber(m.counts.ordered - m.counts.custReturned)} (as Seller Hub counts) · courier returns (RTO) {formatNumber(m.counts.rto)} · <b className="text-ink">sold {formatNumber(t.units)}</b>
        </p>
        <p className="mt-1 text-xs text-muted">
          {t.estFeeSales > 0
            ? `Fees: ${money(t.estFeeSales)} of sales use the ${feePct}% estimate (no Flipkart P&L report data for those SKUs); the rest use each SKU's real Flipkart fee rate.`
            : "Fees: every SKU uses its real Flipkart fee rate from the P&L report."}
        </p>
        {t.listPricedUnits > 0 ? (
          <p className="mt-1 text-xs text-muted">
            {formatNumber(t.listPricedUnits)} sold units have no order price saved yet, so they use today&apos;s listing price.
          </p>
        ) : null}
        {t.unpricedUnits > 0 ? <p className="mt-2 text-xs text-muted">{formatNumber(t.unpricedUnits)} units have no selling price on Flipkart now, so their sales are left out.</p> : null}
      </section>

      <section className="sp-card mt-5 overflow-hidden" aria-labelledby="pnl-products">
        <h2 id="pnl-products" className="px-5 pt-5 font-display text-lg font-semibold sm:px-6">
          By product, {m.label}
        </h2>
        <p className="px-5 pb-3 text-xs text-muted sm:px-6">Biggest sales first</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-y border-line text-left text-[11px] font-bold uppercase tracking-wider text-muted">
                <th className="px-5 py-2 sm:px-6">Product</th>
                <th className="px-3 py-2 text-right">Units</th>
                <th className="px-3 py-2 text-right">Sales</th>
                <th className="px-3 py-2 text-right">Cost</th>
                <th className="px-3 py-2 text-right">Ads</th>
                <th className="px-5 py-2 text-right sm:px-6">Profit after ads</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {m.byMaster.map((r) => (
                <tr key={r.id}>
                  <td className="max-w-[16rem] truncate px-5 py-2.5 font-semibold sm:px-6">
                    {r.id === "unlinked" ? (
                      <a href="#unlinked" className="text-accent-text underline underline-offset-2">
                        {r.name}
                      </a>
                    ) : (
                      r.name
                    )}
                    {r.uncostedSales > 0 ? <span className="ml-2 text-[11px] font-bold text-warn">no cost</span> : null}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">{formatNumber(r.units)}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">{money(r.sales)}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums text-muted">{r.uncostedSales > 0 && r.cost === 0 ? "—" : money(r.cost)}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums text-muted">{r.ads ? money(r.ads) : "—"}</td>
                  <td className="px-5 py-2.5 text-right font-mono font-bold tabular-nums sm:px-6">
                    <ProfitText value={r.net} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {m.unlinked.length ? <Unlinked m={m} masters={masters} /> : null}
    </>
  );
}

// ---- Costing --------------------------------------------------------------------------------------------------------

function Costing({ rows }: { rows: CostingRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<"all" | "missing">("all");

  const saved = (r: CostingRow) => (r.cost === null ? "" : String(r.cost));
  const value = (r: CostingRow) => draft[r.id] ?? saved(r);
  const changed = rows.filter((r) => draft[r.id] !== undefined && parse(draft[r.id]) !== r.cost);
  const bad = changed.filter((r) => Number.isNaN(parse(draft[r.id])));

  // Costs as they stand with the edits, so kits and packs update while typing.
  const masters = new Map<string, MasterInfo>(rows.map((r) => [r.id, { id: r.id, name: r.name, kitParts: r.kitParts.map((p) => ({ part: p.id, qty: p.qty })) }]));
  const current: Record<string, number> = {};
  for (const r of rows) {
    const n = parse(value(r));
    if (n !== null && !Number.isNaN(n)) current[r.id] = n;
  }
  const unitCost = (id: string) => masterUnitCost(id, masters, current);
  const missing = rows.filter((r) => unitCost(r.id) === null).length;

  const q = query.trim().toLowerCase();
  const shown = rows.filter((r) => (show === "all" || unitCost(r.id) === null) && (!q || r.name.toLowerCase().includes(q) || r.skus.some((s) => s.sku.toLowerCase().includes(q))));

  const save = () =>
    startTransition(async () => {
      if (bad.length) {
        toast.result({ ok: false, message: `Check the cost for ${bad[0].name}: it should be a number.` });
        return;
      }
      if (toast.result(await saveMasterCosts(changed.map((r) => ({ masterId: r.id, cost: parse(draft[r.id]) }))))) {
        setDraft({});
        router.refresh();
      }
    });

  return (
    <section className="mt-8" aria-labelledby="costing-title">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="costing-title" className="font-display text-lg font-semibold">
            Costing: pack of 1
          </h2>
          <p className="text-xs text-muted">
            Type what one unit of each master SKU costs you (buying price plus packing). Packs of 2 or more, and kits, are worked out from it.
          </p>
        </div>
        <Chip tone={missing ? "warn" : "ok"}>{missing ? `${missing} of ${rows.length} without a cost` : "Every master SKU has a cost"}</Chip>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search master SKUs</span>
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className="input w-full pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a product or Flipkart SKU" />
        </label>
        <div role="group" aria-label="Show" className="inline-flex rounded-xl border border-line bg-panel2 p-0.5">
          {(
            [
              ["all", `All ${rows.length}`],
              ["missing", `No cost ${missing}`],
            ] as const
          ).map(([k, text]) => (
            <button
              key={k}
              type="button"
              aria-pressed={show === k}
              onClick={() => setShow(k)}
              className={`focus-ring min-h-10 rounded-[10px] px-3 text-sm font-semibold transition ${show === k ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"}`}
            >
              {text}
            </button>
          ))}
        </div>
      </div>

      <ul className="sp-card divide-y divide-line-soft overflow-hidden">
        {shown.map((r) => {
          const unit = unitCost(r.id);
          const isKit = r.kitParts.length > 0;
          const fromParts = isKit && current[r.id] === undefined ? unit : null;
          const v = value(r);
          const invalid = Number.isNaN(parse(v));
          return (
            <li key={r.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_9.5rem] sm:items-start sm:px-5">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                  {r.name}
                  {isKit ? <Chip tone="info">Kit</Chip> : null}
                  {draft[r.id] !== undefined && parse(draft[r.id]) !== r.cost ? <Chip tone="warn">Not saved</Chip> : null}
                </p>
                {isKit ? (
                  <p className="mt-0.5 text-xs text-muted">
                    {r.kitParts.map((p) => `${p.qty} × ${p.name}`).join(" + ")}
                    {current[r.id] !== undefined ? " (uses its own cost)" : fromParts !== null ? ` = ${formatINR(fromParts)} from its parts` : " (add the parts' costs, or type the kit's own cost)"}
                  </p>
                ) : null}
                {r.skus.length ? (
                  <p className="mt-1 flex flex-wrap gap-1.5">
                    {r.skus.map((s) => {
                      const c = skuCost(s.units, unit);
                      return (
                        <span key={s.sku} className="inline-flex items-center gap-1 rounded-full border border-line-soft bg-surface2/60 px-2 py-0.5 text-[11px]">
                          <span className="max-w-[12rem] truncate font-mono">{s.sku}</span>
                          {s.units > 1 ? <b className="text-muted">pack of {s.units}</b> : null}
                          <b className="font-mono">{c === null ? "—" : formatINR(c)}</b>
                        </span>
                      );
                    })}
                  </p>
                ) : (
                  <p className="mt-0.5 text-xs text-muted">No Flipkart SKU linked</p>
                )}
              </div>
              <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wider text-muted">
                Cost of 1 (₹)
                <input
                  className={`input font-mono ${invalid ? "border-bad" : ""}`}
                  inputMode="decimal"
                  value={v}
                  onChange={(e) => setDraft((d) => ({ ...d, [r.id]: e.target.value }))}
                  placeholder={fromParts !== null ? String(fromParts) : "0"}
                  aria-invalid={invalid || undefined}
                />
              </label>
            </li>
          );
        })}
        {shown.length === 0 ? <li className="px-5 py-8 text-center text-sm text-muted">{show === "missing" ? "Every master SKU has a cost." : "No master SKU matches that."}</li> : null}
      </ul>

      {changed.length ? (
        <div className="sticky bottom-20 z-10 mt-3 flex items-center justify-between gap-3 rounded-2xl border border-accent bg-panel2/95 p-3 shadow-lg backdrop-blur min-[561px]:bottom-4">
          <span className="text-sm font-semibold">
            {changed.length} {changed.length === 1 ? "cost" : "costs"} changed
          </span>
          <span className="flex gap-2">
            <button type="button" onClick={() => setDraft({})} className={buttonClass("ghost")}>
              Undo
            </button>
            <button type="button" disabled={pending} onClick={save} className={buttonClass("primary")}>
              {pending ? "Saving…" : "Save costs"}
            </button>
          </span>
        </div>
      ) : null}
    </section>
  );
}

// ---- The page -------------------------------------------------------------------------------------------------------

/** The Flipkart Ads reports: upload one month at a time; uploading a month again replaces it. */
function AdsReports({ uploads }: { uploads: AdsUpload[] }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      if (toast.result(await uploadAdsReport(await file.text(), file.name))) router.refresh();
    } catch {
      toast.result({ ok: false, message: "The file could not be read. Upload the report as downloaded (CSV)." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="sp-card mt-5 p-5 sm:p-6" aria-labelledby="ads-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="ads-title" className="font-display text-lg font-semibold">
            Ads spend from Flipkart Ads
          </h2>
          <p className="max-w-2xl text-xs text-muted">
            In Seller Hub open Ads, Reports, Other Reports. Choose PLA and Consolidated FSN Report, pick one month (Last Month, or This Month so far), press Download, and upload the
            file here. Spend is taken off each product it advertised. Uploading a month again replaces it.
          </p>
        </div>
        <label className={buttonClass("primary", busy ? "pointer-events-none opacity-60" : "cursor-pointer")}>
          {busy ? "Uploading…" : "Upload ads report"}
          <input type="file" accept=".csv,text/csv" className="sr-only" disabled={busy} onChange={(e) => upload(e.target.files?.[0] ?? undefined).finally(() => (e.target.value = ""))} />
        </label>
      </div>
      {uploads.length ? (
        <ul className="mt-4 divide-y divide-line-soft rounded-2xl border border-line-soft">
          {uploads.map((u) => (
            <li key={u.month} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 text-sm">
              <span className="font-bold">{u.label}</span>
              <span className="text-xs text-muted">
                {day(u.from)} to {day(u.to)} · {formatNumber(u.skus)} SKUs · uploaded {new Date(u.uploadedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}
              </span>
              <span className="font-mono font-bold tabular-nums">
                {money(u.spend)} <span className="text-xs font-normal text-muted">+ 18% GST = {money(u.spend * 1.18)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted">No ads report uploaded yet.</p>
      )}
    </section>
  );
}

/** Flipkart's Profit and Loss Report: Flipkart's own fees for every order, so each SKU's real fee rate is known. */
function FeesReport({ realFeeSkus, feePct }: { realFeeSkus: number; feePct: number }) {
  return (
    <section className="sp-card mt-5 p-5 sm:p-6" aria-labelledby="fees-title">
      <h2 id="fees-title" className="font-display text-lg font-semibold">
        Real Flipkart fees
      </h2>
      <p className="mb-3 max-w-2xl text-xs text-muted">
        {realFeeSkus > 0 ? `${realFeeSkus} SKUs use their real fee rate from Flipkart's reports; the rest use the ${feePct}% estimate.` : `All SKUs use the ${feePct}% estimate for now.`} In Seller Hub, search
        &quot;Profit and Loss Report&quot; (under Payments, Reports), download it for a month as Excel and upload it here. Each SKU&apos;s fee rate (commission, fixed, collection, pick and pack,
        shipping, reverse shipping and GST on them) then comes from Flipkart&apos;s own figures. Settlement reports can be uploaded here too.
      </p>
      <UploadReport />
    </section>
  );
}

export function PnlBoard({ months, month, costing, uploads, feePct, realFeeSkus, error }: { months: MonthPnl[]; month: string | null; costing: CostingRow[]; uploads: AdsUpload[]; feePct: number; realFeeSkus: number; error: string | null }) {
  const m = months.find((x) => x.month === month) ?? null;
  return (
    <div className="flex min-w-0 flex-col">
      <div className="mb-4 min-w-0">
        <h1 className="font-display text-[1.65rem] font-semibold tracking-tight">P&amp;L</h1>
        <p className="mt-0.5 text-sm text-muted">Profit and loss by month: Flipkart sales, less fees and what the products cost you</p>
      </div>

      {error ? <p className="mb-4 rounded-lg bg-bad-soft px-3 py-2 text-sm font-semibold text-bad">The month figures could not be loaded: {error}</p> : null}

      {months.length ? (
        <nav aria-label="Months" className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:px-0 [&::-webkit-scrollbar]:hidden">
          {months.map((x) => {
            const on = x.month === month;
            return (
              <Link
                key={x.month}
                prefetch={false}
                href={`/pnl?month=${x.month}`}
                aria-current={on ? "page" : undefined}
                className={`focus-ring flex shrink-0 flex-col rounded-2xl border px-4 py-2.5 transition ${on ? "border-accent bg-accent text-accent-ink sp-glow" : "border-line bg-surface hover:border-accent/50"}`}
              >
                <span className={`text-xs font-bold ${on ? "text-accent-ink/80" : "text-muted"}`}>{x.label}</span>
                <span className="font-mono text-base font-bold tabular-nums">
                  {on ? (x.total.net < 0 ? `−${money(-x.total.net)}` : money(x.total.net)) : <ProfitText value={x.total.net} />}
                </span>
              </Link>
            );
          })}
        </nav>
      ) : null}

      {m ? <MonthView m={m} feePct={feePct} masters={costing.map((c) => ({ id: c.id, name: c.name }))} /> : <p className="rounded-2xl border border-dashed border-line px-5 py-8 text-center text-sm text-muted">No orders yet to work out a profit from.</p>}

      <p className="mt-4 text-xs text-muted">
        How it is worked out: units sold are the month&apos;s orders that were not cancelled, less those returned by the customer or by the courier (RTO). Seller Hub&apos;s net
        units still count courier returns. Sales use each order&apos;s own selling price (today&apos;s listing price where an order has none saved). Flipkart fees use each SKU&apos;s real rate from Flipkart&apos;s P&amp;L report, or {feePct}% where there is none (Settings, Default fee %). Ads come from the Flipkart Ads reports
        uploaded below, plus 18% GST. Storage, other Flipkart charges and warehouse expenses are not included.
      </p>

      <AdsReports uploads={uploads} />

      <FeesReport realFeeSkus={realFeeSkus} feePct={feePct} />

      <Costing rows={costing} />
    </div>
  );
}
