import Link from "next/link";
import { Suspense } from "react";
import { CostsTable } from "@/components/money/costs-table";
import { ProfitTable, UnpaidTable, WeightTable, WrongFeesTable } from "@/components/money/tables";
import { UploadReport } from "@/components/money/upload-report";
import { Card, Chip, EmptyState } from "@/components/ui";
import { addDays, formatDate, formatDateTime, formatNumber, todayIST } from "@/lib/format";
import { percent, rupees, totalsOf } from "@/lib/money/profit";
import { PRESETS, readPeriod, type Period } from "@/lib/money/period";
import {
  databaseSizeMb,
  latestSettledDay,
  loadAccountLines,
  loadCosts,
  loadCrosscheck,
  loadEstimate,
  loadFlags,
  loadMoneyState,
  loadProfit,
  loadUnpaid,
  loadUploads,
  loadWeight,
  loadWrongFees,
  type MoneyDb,
} from "@/server/money-data";

export type Search = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? "";

export const KIND_LABEL: Record<string, string> = {
  ads: "Ads (PLA wallet)",
  google_ads: "Google Ads",
  storage: "Storage fees",
  recall: "Recall fees",
  fines: "Fines",
  spf_non_order: "SPF claims (lost in warehouse)",
  mp_rebate: "MP fee rebates",
  value_added: "Value added services",
  support_services: "Support services",
  review_accelerator: "Review accelerator",
  insight_subscription: "Insight subscription",
  tds_claim: "TDS claims",
  tcs_recovery: "TCS recovery",
};

async function periodOf(db: MoneyDb, sp: Search): Promise<{ period: Period; latest: string | null }> {
  const latest = await latestSettledDay(db);
  return { latest, period: readPeriod({ range: one(sp.range), from: one(sp.from), to: one(sp.to) }, latest, todayIST()) };
}

function PeriodPicker({ tab, period }: { tab: string; period: Period }) {
  const link = (days: number) => `/money?${tab === "profit" ? "" : `tab=${tab}&`}range=${days}`;
  return (
    <div className="mb-4 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((d) => (
          <Link
            key={d}
            prefetch={false}
            href={link(d)}
            aria-current={period.preset === d ? "true" : undefined}
            className={`focus-ring flex min-h-10 items-center rounded-full border px-3.5 text-sm font-bold ${
              period.preset === d ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-muted hover:text-ink"
            }`}
          >
            {d} days
          </Link>
        ))}
        <span className="text-sm text-muted">
          {formatDate(period.from)} to {formatDate(period.to)}
        </span>
      </div>
      <form method="get" action="/money" className="flex flex-wrap items-end gap-2">
        {tab !== "profit" ? <input type="hidden" name="tab" value={tab} /> : null}
        <label className="text-xs font-semibold text-muted">
          From
          <input type="date" name="from" defaultValue={period.from} className="input min-h-10 py-1.5" />
        </label>
        <label className="text-xs font-semibold text-muted">
          To
          <input type="date" name="to" defaultValue={period.to} className="input min-h-10 py-1.5" />
        </label>
        <button type="submit" className="focus-ring min-h-10 rounded-lg border border-line bg-surface px-4 text-sm font-bold hover:bg-surface2">
          Show
        </button>
      </form>
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "bad" | "ok" }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className={`mt-0.5 text-lg font-extrabold tabular-nums ${tone === "bad" ? "text-bad" : tone === "ok" ? "text-ok" : ""}`}>{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-muted">{sub}</p> : null}
    </div>
  );
}

const NO_DATA = (
  <EmptyState
    title="No settlement reports uploaded yet"
    body="Open the Uploads tab and upload a Settled Transactions report (Seller Hub, Payments, Reports). Then add your SKU costs on the Costs tab."
  />
);

// --- Profit ------------------------------------------------------------------------------------------------------

export async function ProfitPanel({ db, sp }: { db: MoneyDb; sp: Search }) {
  const { period, latest } = await periodOf(db, sp);
  if (!latest) return NO_DATA;
  const [rows, account, flags, state] = await Promise.all([
    loadProfit(db, period.from, period.to),
    loadAccountLines(db, period.from, period.to),
    loadFlags(db),
    loadMoneyState(db),
  ]);
  const t = totalsOf(rows);
  const accountTotal = account.reduce((n, a) => n + a.expense, 0);
  const beforeCost = t.revenue > 0 ? ((t.net_payout + t.itc) / t.revenue) * 100 : null;
  const low = flags?.low_margin_percent ?? 10;

  return (
    <>
      <PeriodPicker tab="profit" period={period} />
      <WorkingNote working={state?.working ?? false} />
      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Tile label="Sales kept" value={rupees(t.revenue)} sub={`${formatNumber(t.units_sold)} sold, ${formatNumber(t.units_returned)} returned`} />
        <Tile label="Net payout + tax credits" value={rupees(t.net_payout + t.itc)} sub={`after fees and returns`} />
        <Tile
          label={t.skusWithoutCost ? "Profit (SKUs with a cost)" : "Profit"}
          value={rupees(t.profit)}
          tone={t.profit < 0 ? "bad" : undefined}
          sub={t.skusWithoutCost ? `${t.skusWithoutCost} SKUs have no cost yet` : `margin ${percent(t.margin)}`}
        />
        <Tile label="Margin before product cost" value={percent(beforeCost)} sub={t.skusWithoutCost ? "counts every SKU" : "payout over sales kept"} />
      </div>

      <Card className="mb-4 p-4">
        <h2 className="text-base font-extrabold">Account-level costs (not tied to a SKU)</h2>
        <p className="mt-0.5 text-xs text-muted">
          The Flipkart reports do not link ads to a SKU or listing, so ads and the other account charges are shown here, not in the SKU rows.
        </p>
        {account.length ? (
          <ul className="mt-2 divide-y divide-line text-sm">
            {account.map((a) => (
              <li key={a.kind} className="flex items-baseline justify-between gap-3 py-1.5">
                <span>{KIND_LABEL[a.kind] ?? a.kind}</span>
                <span className={`font-semibold tabular-nums ${a.expense < 0 ? "text-bad" : ""}`}>{rupees(a.expense)}</span>
              </li>
            ))}
            <li className="flex items-baseline justify-between gap-3 py-1.5 font-extrabold">
              <span>Profit after these costs</span>
              <span className={`tabular-nums ${t.profit + accountTotal < 0 ? "text-bad" : ""}`}>{rupees(t.profit + accountTotal)}</span>
            </li>
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">None in this period.</p>
        )}
      </Card>

      <ProfitTable rows={rows} from={period.from} to={period.to} lowMargin={low} />

      <Suspense fallback={<div aria-busy="true" className="skeleton mt-6 h-40 w-full" />}>
        <EstimateCard db={db} />
      </Suspense>
      <Suspense fallback={<div aria-busy="true" className="skeleton mt-4 h-24 w-full" />}>
        <CrosscheckCard db={db} />
      </Suspense>
    </>
  );
}

// --- Costs -------------------------------------------------------------------------------------------------------

export async function CostsPanel({ db }: { db: MoneyDb }) {
  const latest = await latestSettledDay(db);
  const [costs, rows] = await Promise.all([loadCosts(db), latest ? loadProfit(db, addDays(latest, -89), latest) : Promise.resolve([])]);
  const missing = rows.filter((r) => r.cost_missing && r.sku !== "(no SKU)").sort((a, b) => b.units_sold - a.units_sold).map((r) => r.sku);
  return <CostsTable costs={costs} missing={missing} today={todayIST()} />;
}

// --- Weight ------------------------------------------------------------------------------------------------------

export async function WeightPanel({ db, sp }: { db: MoneyDb; sp: Search }) {
  const { period, latest } = await periodOf(db, sp);
  if (!latest) return NO_DATA;
  const rows = await loadWeight(db, period.from, period.to);
  const total = rows.reduce((n, r) => n + (r.extra_fee ?? 0), 0);
  const bySku = new Map<string, { n: number; extra: number }>();
  for (const r of rows) {
    const k = r.sku ?? "(no SKU)";
    const cur = bySku.get(k) ?? { n: 0, extra: 0 };
    cur.n++;
    cur.extra += r.extra_fee ?? 0;
    bySku.set(k, cur);
  }
  const ranked = [...bySku.entries()].sort((a, b) => b[1].extra - a[1].extra || b[1].n - a[1].n);
  return (
    <>
      <PeriodPicker tab="weight" period={period} />
      <Card className="mb-4 p-4">
        <p className="text-sm">
          <b>{formatNumber(rows.length)}</b> orders were charged a bigger weight slab than the package on your listing.
          Extra shipping paid: <b className="text-bad">{rupees(total)}</b>
          {rows.some((r) => r.extra_fee === null) ? " (orders with no other charge to compare with are counted as unknown)" : ""}.
        </p>
        <p className="mt-1 text-xs text-muted">
          Flipkart prices shipping by weight slab, using the larger of dead weight and volumetric weight (length × breadth × height in cm ÷ 5000: the divisor Flipkart&apos;s own report uses).
          Your package comes from the listing data. The report has slabs on returned orders (reverse shipping), so that is where overcharges show. Slabs go in 0.5 kg steps up to 2.5 kg, then 1 kg.
        </p>
        {ranked.length ? (
          <ul className="mt-2 divide-y divide-line text-sm">
            {ranked.slice(0, 8).map(([sku, v]) => (
              <li key={sku} className="flex items-baseline justify-between gap-3 py-1.5">
                <span className="break-all font-mono text-[13px] font-bold">{sku}</span>
                <span className="tabular-nums">{v.n} orders · {rupees(v.extra)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
      <WeightTable rows={rows} />
    </>
  );
}

// --- Settlement checks --------------------------------------------------------------------------------------------

export async function ChecksPanel({ db }: { db: MoneyDb }) {
  const latest = await latestSettledDay(db);
  if (!latest) return NO_DATA;
  const [unpaid, fees, flags] = await Promise.all([loadUnpaid(db), loadWrongFees(db), loadFlags(db)]);
  const extra = fees.reduce((n, f) => n + (f.extra_fee ?? 0), 0);
  return (
    <>
      <h2 className="mb-1 text-base font-extrabold">Unpaid orders</h2>
      <p className="mb-3 text-sm text-muted">
        Shipped orders with no settlement line, ordered more than the &quot;unpaid after&quot; days before the latest settlement day we hold ({formatDate(latest)}). Orders that
        were returned, cancelled or are in the returns data are left out.
      </p>
      <UnpaidTable rows={unpaid} />
      <h2 className="mb-1 mt-8 text-base font-extrabold">Wrong fees</h2>
      <p className="mb-3 text-sm text-muted">
        {formatNumber(fees.length)} settlement lines to check, about {rupees(extra)} above the usual. A commission rate that is far from the SKU&apos;s usual, a fixed
        fee clearly above the highest the SKU usually pays, or a fee charged twice for one order item. These are leads to look at, not proof: Flipkart changes fixed fees by order value.
        {flags ? "" : ""}
      </p>
      <WrongFeesTable rows={fees} />
    </>
  );
}

// --- Uploads -----------------------------------------------------------------------------------------------------

export async function UploadsPanel({ db }: { db: MoneyDb }) {
  const [uploads, size] = await Promise.all([loadUploads(db), databaseSizeMb(db)]);
  return (
    <>
      {size !== null ? (
        <p className={`mb-3 text-sm ${size > 400 ? "font-bold text-bad" : "text-muted"}`}>
          Database: {size} MB of 500 MB used (free plan). One month of settlements takes about 140 MB. Uploads are refused above 430 MB.
        </p>
      ) : null}
      <UploadReport />
      <h2 className="mb-2 mt-6 text-base font-extrabold">Uploaded reports</h2>
      {uploads.length ? (
        <ul className="flex flex-col gap-2">
          {uploads.map((u) => (
            <li key={u.id} className="rounded-xl border border-line bg-surface p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={u.status === "done" ? "ok" : u.status === "failed" ? "bad" : "warn"}>{u.status === "done" ? "Done" : u.status === "failed" ? "Failed" : "Running"}</Chip>
                <span className="font-bold">{u.kind === "settled" ? "Settled Transactions" : "Profit and Loss"}</span>
                <span className="text-xs text-muted">{formatDateTime(u.created_at)}</span>
              </div>
              <p className="mt-1 break-all text-xs text-muted">{u.filename}</p>
              <p className="mt-1">
                {u.period_from && u.period_to ? `${formatDate(u.period_from)} to ${formatDate(u.period_to)} · ` : ""}
                {formatNumber(u.rows_added)} added, {formatNumber(u.rows_dup)} duplicates{u.rows_updated ? `, ${formatNumber(u.rows_updated)} updated` : ""}
                {u.other_added ? `, ${formatNumber(u.other_added)} other rows` : ""}
                {u.total_net !== null ? ` · total ${rupees(Number(u.total_net))}` : ""}
              </p>
              {u.error ? <p className="mt-1 text-xs font-semibold text-bad">{u.error}</p> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Nothing uploaded yet.</p>
      )}
    </>
  );
}

function WorkingNote({ working }: { working: boolean }) {
  if (!working) return null;
  return (
    <p role="status" className="mb-4 rounded-lg bg-info-soft px-3 py-2 text-sm font-semibold text-info">
      The last upload is still being added up in the background (about a minute). Reload to see the final numbers; the checks on the Settlement tab update then too.
    </p>
  );
}

async function EstimateCard({ db }: { db: MoneyDb }) {
  const today = todayIST();
  const estimate = await loadEstimate(db, addDays(today, -29), today);
  const est = estimate.reduce((n, e) => n + e.est_profit, 0);
  const estRevenue = estimate.reduce((n, e) => n + e.revenue, 0);
  return (
    <Card className="mt-6 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-extrabold">Orders not settled yet</h2>
        <Chip tone="info">Estimated</Chip>
      </div>
      <p className="mt-0.5 text-xs text-muted">
        Orders from the last 30 days that are shipped or waiting and have no settlement line. Each SKU&apos;s current price, its fee % from recent settlements
        (or the default fee setting), and its cost. Kept apart from the settled figures above.
      </p>
      {estimate.length ? (
        <>
          <p className="mt-2 text-sm">
            <b>{formatNumber(estimate.reduce((n, e) => n + e.units, 0))}</b> units, about <b>{rupees(estRevenue)}</b> of sales, estimated profit{" "}
            <b className={est < 0 ? "text-bad" : ""}>{rupees(est)}</b>
            {estimate.some((e) => e.cost_missing) ? " (SKUs without a cost count as zero cost)" : ""}.
          </p>
          <div className="mt-2 overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-max border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface2 text-left text-xs uppercase tracking-wide text-muted">
                  <th className="p-2">SKU</th>
                  <th className="p-2 text-right">Units</th>
                  <th className="p-2 text-right">Price</th>
                  <th className="p-2 text-right">Fee %</th>
                  <th className="p-2 text-right">Est. payout</th>
                  <th className="p-2 text-right">Cost</th>
                  <th className="p-2 text-right">Est. profit</th>
                </tr>
              </thead>
              <tbody>
                {estimate.slice(0, 25).map((e) => (
                  <tr key={e.sku} className="border-b border-line last:border-b-0">
                    <td className="p-2 font-mono text-[13px] font-bold">{e.sku}</td>
                    <td className="p-2 text-right tabular-nums">{formatNumber(e.units)}</td>
                    <td className="p-2 text-right tabular-nums">{e.price === null ? "-" : rupees(e.price)}</td>
                    <td className="p-2 text-right tabular-nums" title={e.fee_source}>{e.fee_pct}%</td>
                    <td className="p-2 text-right tabular-nums">{rupees(e.est_payout)}</td>
                    <td className="p-2 text-right tabular-nums">{e.cost_missing ? <Chip tone="warn">Cost missing</Chip> : rupees(e.cost)}</td>
                    <td className={`p-2 text-right tabular-nums ${e.est_profit < 0 ? "font-bold text-bad" : ""}`}>{rupees(e.est_profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {estimate.length > 25 ? <p className="mt-1 text-xs text-muted">Showing the first 25 of {estimate.length} SKUs.</p> : null}
        </>
      ) : (
        <p className="mt-2 text-sm text-muted">No unsettled orders found in the order data.</p>
      )}
    </Card>


  );
}

async function CrosscheckCard({ db }: { db: MoneyDb }) {
  const cross = await loadCrosscheck(db);
  return (
    <Card className="mt-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-extrabold">Cross-check with Flipkart&apos;s Profit and Loss report</h2>
        {cross.compared ? <Chip tone={cross.differ ? "bad" : "ok"}>{cross.differ ? `${formatNumber(cross.differ)} differ` : "All match"}</Chip> : null}
      </div>
      {cross.compared ? (
        <>
          <p className="mt-1 text-sm">
            {formatNumber(cross.compared)} payments of orders in the P&L report were compared with the same payments in Settled Transactions.{" "}
            <b>{formatNumber(cross.differ)}</b> differ by more than ₹{cross.tolerance}.
          </p>
          {cross.rows.length ? (
            <ul className="mt-2 divide-y divide-line text-sm">
              {cross.rows.slice(0, 20).map((r) => (
                <li key={r.order_item_id + r.neft_id} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
                  <span className="break-all font-mono text-xs">{r.order_item_id}</span>
                  <span className="text-xs text-muted">{r.sku}</span>
                  <span className="tabular-nums">Flipkart {rupees(r.flipkart_amount)} · ours {rupees(r.our_amount)} · difference {rupees(r.diff)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p className="mt-1 text-sm text-muted">
          Needs both reports for the same orders: a Profit and Loss Report and the Settled Transactions reports that paid them. Upload both on the Uploads tab.
        </p>
      )}
    </Card>
  );
}
