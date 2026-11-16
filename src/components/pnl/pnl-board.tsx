"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { SearchIcon } from "@/components/icons";
import { UploadReport } from "@/components/money/upload-report";
import { useToast } from "@/components/toast";
import { buttonClass, Chip, EmptyState, PageTitle, Stat, StatStrip } from "@/components/ui";
import { masterUnitCost, skuCost, type MasterInfo, type MonthCounts, type PnlLine, type ReportCounts } from "@/lib/costing";
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
  report: ReportCounts | null;
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
    <section id="unlinked" className="sp-inner m-3 scroll-mt-20 overflow-hidden min-[700px]:m-5" aria-labelledby="unlinked-title">
      <div className="px-4 pt-4">
        <h2 id="unlinked-title" className="t-card-title">
          Not linked to a master, {m.label}
        </h2>
        <p className="t-caption pb-3">
          {m.unlinked.length} Flipkart {m.unlinked.length === 1 ? "SKU" : "SKUs"}, {formatNumber(units)} units, {money(sales)} of sales with no cost. Pick each one&apos;s master SKU and how many
          units one order has (2 for a pack of 2), then press Link; its cost then counts here and on the Master SKU sheet.
        </p>
      </div>
      <ul className="m-0 list-none divide-y divide-line-soft border-t border-line-soft p-0">
        {m.unlinked.map((r) => {
          const p = pick[r.sku] ?? { master: "", units: "1" };
          const set = (v: Partial<typeof p>) => setPick((x) => ({ ...x, [r.sku]: { ...p, ...v } }));
          return (
            <li key={r.sku} className="grid gap-2 px-4 py-3 min-[700px]:grid-cols-[minmax(0,1fr)_auto] min-[700px]:items-center">
              <div className="min-w-0">
                <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="font-mono text-sm font-medium">{r.sku}</span>
                  <span className="t-caption tabular-nums">
                    {formatNumber(r.units)} units · {money(r.sales)}
                  </span>
                </p>
                {r.title ? <p className="t-caption truncate">{r.title}</p> : null}
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
                <label className="t-label flex items-center gap-1.5">
                  Units
                  <input className="tabular-nums input w-16" inputMode="numeric" value={p.units} onChange={(e) => set({ units: e.target.value.replace(/[^0-9]/g, "") })} aria-label={`Units per order for ${r.sku}`} />
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
  // The days the month covers: Flipkart's report and the synced orders together.
  const span = {
    from: [m.report?.from, m.from].filter(Boolean).sort()[0] ?? null,
    to: [m.report?.to, m.to].filter(Boolean).sort().reverse()[0] ?? null,
  };
  return (
    <>
      <section aria-labelledby="pnl-month">
        <div className="g-head flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="pnl-month" className="t-card-title flex flex-wrap items-center gap-2">
            {t.net < 0 ? "Loss" : "Profit"} in {m.label}
            {t.ads > 0 ? ", after ads" : ""}
            {mg !== null ? <Chip tone={mg < 0 ? "bad" : mg < 10 ? "warn" : "ok"}>{mg}% margin</Chip> : null}
          </h2>
          {span.from && span.to ? <span className="t-caption">Orders {day(span.from)} to {day(span.to)}</span> : null}
        </div>
        <StatStrip className="wrap-5" ariaLabel={`${m.label} in figures`}>
          <Stat label="Sales (seller price)" value={money(t.sales)} sub={`${formatNumber(t.units)} units sold`} />
          <Stat label="Product cost" value={`−${money(t.cost)}`} />
          <Stat label="Ads (incl. 18% GST)" value={m.adsUpload || t.ads > 0 ? `−${money(t.ads)}` : "not added"} />
          <Stat label="Flipkart fees" value={`−${money(t.fees)}`} />
          <Stat
            label={t.net < 0 ? "Loss after ads" : "Profit after ads"}
            value={<span className={t.net < 0 ? "text-bad" : "t-grad"}>{t.net < 0 ? `−${money(-t.net)}` : money(t.net)}</span>}
          />
        </StatStrip>
        {m.from && m.from > `${m.month}-01` && !(m.report?.from && m.report.from <= `${m.month}-01`) ? (
          <p className="sp-card tone-row tone-bad tone-row-title mt-3">
            Only orders from {day(m.from)} are in the app: {day(`${m.month}-01`)} to {day(new Date(Date.parse(`${m.from}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10))} are missing, so
            this month is short. Older orders are read from Flipkart at night (10:15 pm to 6:45 am) once asked for.
          </p>
        ) : null}
        {t.uncostedSales > 0 ? (
          <p className="sp-card tone-row tone-warn tone-row-title mt-3">
            {money(t.uncostedSales)} of these sales are for master SKUs with no cost yet, so the profit shows too high. Add their costs below.
          </p>
        ) : null}
        <div className="t-caption mt-3 space-y-1">
          {!m.adsUpload ? (
            <p className="font-semibold text-warn">Ads spend for {m.label} is not added yet. Upload that month&apos;s Flipkart Ads report below.</p>
          ) : m.from && m.adsUpload.to < (m.to ?? "") ? (
            <p>The ads report covers up to {day(m.adsUpload.to)}; upload a newer one to include later ad spend.</p>
          ) : null}
          {m.report ? (
            <p>
              <b className="text-ink">Flipkart&apos;s P&amp;L report</b> covers orders {m.report.from ? day(m.report.from) : "?"} to {m.report.to ? day(m.report.to) : "?"}: gross{" "}
              {formatNumber(m.report.gross)} units, returned or cancelled {formatNumber(m.report.retCanc)}, net {formatNumber(m.report.net)}. Its own seller price, fees and net earnings are
              used for those orders.
            </p>
          ) : (
            <p>
              <b className="text-ink">No Flipkart P&amp;L report for {m.label} yet</b>: the figures are worked out from the synced orders. Upload the report below for Flipkart&apos;s own
              numbers.
            </p>
          )}
          {t.estSales > 0 ? (
            <p>
              {money(t.estSales)} of sales are estimated from synced orders{m.report?.to ? ` after ${day(m.report.to)}` : ""}: each SKU&apos;s seller price and earnings per unit from
              Flipkart&apos;s report (or, for a SKU it never had, its selling price scaled the same way and fees at {feePct}%).
            </p>
          ) : null}
          <p>
            Synced orders: {formatNumber(m.counts.ordered + m.counts.cancelled)} · cancelled {formatNumber(m.counts.cancelled)} · returned by customers {formatNumber(m.counts.custReturned)} ·
            courier returns (RTO) {formatNumber(m.counts.rto)}. Buyers paid {money(t.itemValue)} (Seller Hub&apos;s &quot;sales&quot;); your revenue is the seller price, {money(t.sales)}.
          </p>
          {t.listPricedUnits > 0 ? <p>{formatNumber(t.listPricedUnits)} sold units have no order price saved yet, so they use today&apos;s listing price.</p> : null}
          {t.unpricedUnits > 0 ? <p>{formatNumber(t.unpricedUnits)} units have no selling price on Flipkart now, so their sales are left out.</p> : null}
        </div>
      </section>

      <section className="sp-card mt-4 overflow-hidden" aria-labelledby="pnl-products">
        <div className="g-pad pb-3">
          <h2 id="pnl-products" className="t-card-title">
            By product, {m.label}
          </h2>
          <p className="t-caption mt-1">Biggest sales first</p>
        </div>
        <div className="overflow-x-auto border-t border-line-soft">
          <table className="ledger min-w-[40rem]">
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col" className="num">Units</th>
                <th scope="col" className="num">Sales</th>
                <th scope="col" className="num">Cost</th>
                <th scope="col" className="num">Ads</th>
                <th scope="col" className="num">Profit after ads</th>
              </tr>
            </thead>
            <tbody>
              {m.byMaster.map((r) => (
                <tr key={r.id}>
                  <td className="max-w-[16rem] truncate font-semibold">
                    {r.id === "unlinked" ? (
                      <a href="#unlinked" className="text-accent-text underline underline-offset-2">
                        {r.name}
                      </a>
                    ) : (
                      r.name
                    )}
                    {r.uncostedSales > 0 ? <span className="ml-2"><Chip tone="warn">no cost</Chip></span> : null}
                  </td>
                  <td className="num">{formatNumber(r.units)}</td>
                  <td className="num">{money(r.sales)}</td>
                  <td className="num text-muted">{r.uncostedSales > 0 && r.cost === 0 ? "—" : money(r.cost)}</td>
                  <td className="num text-muted">{r.ads ? money(r.ads) : "—"}</td>
                  <td className="num">
                    <ProfitText value={r.net} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {m.unlinked.length ? <Unlinked m={m} masters={masters} /> : null}
      </section>
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
    <section className="sp-card g-pad" aria-labelledby="costing-title">
      <div className="g-head flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="costing-title" className="t-card-title">
            Costing: pack of 1
          </h2>
          <p className="t-caption mt-1">
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
        <div role="group" aria-label="Show" className="seg">
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
              className="seg-opt"
            >
              {text}
            </button>
          ))}
        </div>
      </div>

      <ul className="sp-inner m-0 list-none divide-y divide-line-soft overflow-hidden p-0">
        {shown.map((r) => {
          const unit = unitCost(r.id);
          const isKit = r.kitParts.length > 0;
          const fromParts = isKit && current[r.id] === undefined ? unit : null;
          const v = value(r);
          const invalid = Number.isNaN(parse(v));
          return (
            <li key={r.id} className="grid gap-2 px-4 py-3 min-[700px]:grid-cols-[minmax(0,1fr)_9.5rem] min-[700px]:items-start">
              <div className="min-w-0">
                <p className="t-body flex flex-wrap items-center gap-2 font-semibold">
                  {r.name}
                  {isKit ? <Chip tone="info">Kit</Chip> : null}
                  {draft[r.id] !== undefined && parse(draft[r.id]) !== r.cost ? <Chip tone="warn">Not saved</Chip> : null}
                </p>
                {isKit ? (
                  <p className="t-caption mt-0.5">
                    {r.kitParts.map((p) => `${p.qty} × ${p.name}`).join(" + ")}
                    {current[r.id] !== undefined ? " (uses its own cost)" : fromParts !== null ? ` = ${formatINR(fromParts)} from its parts` : " (add the parts' costs, or type the kit's own cost)"}
                  </p>
                ) : null}
                {r.skus.length ? (
                  <p className="mt-1 flex flex-wrap gap-1.5">
                    {r.skus.map((s) => {
                      const c = skuCost(s.units, unit);
                      return (
                        <span key={s.sku} className="g-chip">
                          <span className="max-w-[12rem] truncate font-mono">{s.sku}</span>
                          {s.units > 1 ? <span>pack of {s.units}</span> : null}
                          <b className="tabular-nums text-ink">{c === null ? "—" : formatINR(c)}</b>
                        </span>
                      );
                    })}
                  </p>
                ) : (
                  <p className="t-caption mt-0.5">No Flipkart SKU linked</p>
                )}
              </div>
              <label className="t-label flex flex-col gap-1">
                Cost of 1 (₹)
                <input
                  className={`tabular-nums input ${invalid ? "border-bad" : ""}`}
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
        {shown.length === 0 ? <li className="t-caption px-5 py-8 text-center">{show === "missing" ? "Every master SKU has a cost." : "No master SKU matches that."}</li> : null}
      </ul>

      {changed.length ? (
        <div className="sp-pop sticky bottom-20 z-10 mt-3 flex items-center justify-between gap-3 p-3 min-[700px]:bottom-4">
          <span className="t-body font-semibold">
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
    <section className="sp-card g-pad" aria-labelledby="ads-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="ads-title" className="t-card-title">
            Ads spend from Flipkart Ads
          </h2>
          <p className="t-caption mt-1">
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
        <ul className="sp-inner m-0 mt-4 list-none divide-y divide-line-soft p-0">
          {uploads.map((u) => (
            <li key={u.month} className="t-body flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5">
              <span className="font-semibold">{u.label}</span>
              <span className="t-caption">
                {day(u.from)} to {day(u.to)} · {formatNumber(u.skus)} SKUs · uploaded {new Date(u.uploadedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}
              </span>
              <span className="font-medium tabular-nums">
                {money(u.spend)} <span className="t-caption">+ 18% GST = {money(u.spend * 1.18)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="t-caption mt-3">No ads report uploaded yet.</p>
      )}
    </section>
  );
}

/** Flipkart's Profit and Loss Report: Flipkart's own fees for every order, so each SKU's real fee rate is known. */
function FeesReport({ reportSkus, feePct }: { reportSkus: number; feePct: number }) {
  return (
    <section className="sp-card g-pad" aria-labelledby="fees-title">
      <h2 id="fees-title" className="t-card-title">
        Flipkart&apos;s P&amp;L report
      </h2>
      <p className="t-caption mb-3 mt-1">
        {reportSkus > 0 ? `Flipkart's own figures are in for ${reportSkus} SKUs.` : "No report uploaded yet."} In Seller Hub open Reports, Request New Report, Payment Reports, Profit and Loss
        Report, pick a month (or the days so far), and when it is generated download the Excel file and upload it here. For the orders it covers, the P&amp;L uses Flipkart&apos;s own units,
        seller price, fees and net earnings; orders after it are priced from each SKU&apos;s figures in it. Uploading the same orders again never counts them twice. Files over 10 MB can be
        uploaded too; it takes a few minutes. Without any report, fees are estimated at {feePct}%.
      </p>
      <UploadReport />
    </section>
  );
}

export function PnlBoard({ months, month, costing, uploads, feePct, reportSkus, error }: { months: MonthPnl[]; month: string | null; costing: CostingRow[]; uploads: AdsUpload[]; feePct: number; reportSkus: number; error: string | null }) {
  const m = months.find((x) => x.month === month) ?? null;
  return (
    <div className="flex min-w-0 flex-col">
      <PageTitle
        title="P&L"
        sub="Profit and loss by month: Flipkart sales, less fees and what the products cost you"
        action={
          months.length ? (
            <nav aria-label="Months" className="seg max-w-full">
              {months.map((x) => (
                <Link key={x.month} prefetch={false} href={`/pnl?month=${x.month}`} aria-current={x.month === month ? "page" : undefined} className="seg-opt gap-2">
                  {x.label}
                  <span className="seg-count">
                    <ProfitText value={x.total.net} />
                  </span>
                </Link>
              ))}
            </nav>
          ) : null
        }
      />
      {error ? <p className="sp-card tone-row tone-bad tone-row-title mb-4">The month figures could not be loaded: {error}</p> : null}
      {m ? <MonthView m={m} feePct={feePct} masters={costing.map((c) => ({ id: c.id, name: c.name }))} /> : <EmptyState title="No orders yet" body="No orders yet to work out a profit from." />}
      <p className="t-caption mt-4">
        How it is worked out: for orders Flipkart&apos;s P&amp;L report covers, its own net units, seller price (your revenue) and net earnings; Flipkart fees are the seller price
        less net earnings. Later orders: units sold are orders not cancelled less customer and courier returns, priced from each SKU&apos;s report figures. Product cost is your cost per unit
        times units sold. Ads come from the Flipkart Ads reports, plus 18% GST. Storage, other Flipkart charges and warehouse expenses are not included.
      </p>
      <div className="g-grid mt-4 items-start">
        <div className="span-7 min-w-0">
          <Costing rows={costing} />
        </div>
        <div className="span-5 flex min-w-0 flex-col gap-3 min-[700px]:gap-4">
          <AdsReports uploads={uploads} />
          <FeesReport reportSkus={reportSkus} feePct={feePct} />
        </div>
      </div>
    </div>
  );
}
