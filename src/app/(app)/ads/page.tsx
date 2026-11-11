import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdsTracker, type AdsView, type CampaignLogRow, type ScanRow } from "@/components/ads/ads-tracker";
import { daysBetween, fsnCoverage } from "@/lib/ads-report";
import { canManage, requireUser } from "@/lib/auth";
import { todayIST } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { AdCampaignRecord, AdScanRecord, AdScanRowRecord } from "@/lib/types";

export const metadata: Metadata = { title: "Ads tracker" };

// The tables are newer than the generated types.
type DbErr = { code?: string; message?: string } | null;
type Loose = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: DbErr }>;
};
type DayTotal = { day: string; spend: number; revenue: number; units: number; campaigns: number };
const shiftDay = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The tables are not there yet: the migration has not been applied to this database. */
const missingTable = (e: DbErr) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache/i.test(e.message ?? ""));

const ROW_COLS = "scan_id, sku, campaign_id, campaign_name, spend, views, clicks, units, revenue";

/** Reads every row of a query, 1,000 at a time (the most one request returns). */
async function all<T>(make: () => any, max = 20_000): Promise<T[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const out: T[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await make().range(from, from + 999);
    if (error || !data) break;
    out.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return out;
}

/** Flipkart Ads spend per SKU and campaign, scan by scan, with the campaign log. Owner and admin. */
export default async function AdsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  if (!canManage(user)) notFound();
  const db = (await createClient()) as unknown as Loose;
  const sp = await searchParams;

  const today = todayIST();
  const [skuRes, campRes, scanRes, dailyRes] = await Promise.all([
    db.from("ad_tracked_skus").select("sku").order("sku"),
    db.from("ad_campaigns").select("*").order("updated_at", { ascending: false }).limit(2000),
    db.from("ad_scans").select("id, period_start, period_end, days, filename, uploaded_by, created_at").order("period_end", { ascending: false }).limit(200),
    // The true spend per day, all campaigns (Consolidated Daily Report), the last 6 months.
    db.rpc("ads_daily_totals", { p_from: shiftDay(today, -183), p_to: today }),
  ]);
  const daily: DayTotal[] = (Array.isArray(dailyRes.data) ? dailyRes.data : []).map((r: Record<string, unknown>) => ({
    day: String(r.day),
    spend: Number(r.spend),
    revenue: Number(r.revenue),
    units: Number(r.units),
    campaigns: Number(r.campaigns),
  }));
  const byDay = new Map(daily.map((d) => [d.day, d]));
  /** All campaigns added up for a range of days, or null unless every one of those days is in the daily record. */
  const range = (from: string, to: string) => {
    const days: DayTotal[] = [];
    for (let d = from; d <= to; d = shiftDay(d, 1)) {
      const t = byDay.get(d);
      if (!t) return null;
      days.push(t);
    }
    return { spend: days.reduce((n, t) => n + t.spend, 0), revenue: days.reduce((n, t) => n + t.revenue, 0), units: days.reduce((n, t) => n + t.units, 0) };
  };
  const dataTo = daily.length ? daily[daily.length - 1].day : null;
  if (missingTable(skuRes.error) || missingTable(campRes.error) || missingTable(scanRes.error)) {
    return <AdsTracker view={null} />;
  }

  const skus = ((skuRes.data ?? []) as { sku: string }[]).map((r) => r.sku);
  const campaigns = (campRes.data ?? []) as AdCampaignRecord[];
  const scans = (scanRes.data ?? []) as AdScanRecord[];
  const asked = typeof sp.scan === "string" ? sp.scan : null;
  const scan = scans.find((s) => s.id === asked) ?? scans[0] ?? null;
  const byId = new Map(campaigns.map((c) => [c.campaign_id, c]));

  // The chosen scan: every row (to know which campaigns advertise several SKUs), then the tracked SKUs' rows.
  const scanRows = scan ? await all<AdScanRowRecord>(() => db.from("ad_scan_rows").select(ROW_COLS).eq("scan_id", scan.id).order("sku").order("campaign_id")) : [];
  const skusPerCampaign = new Map<string, Set<string>>();
  for (const r of scanRows) {
    const set = skusPerCampaign.get(r.campaign_id) ?? new Set<string>();
    set.add(r.sku);
    skusPerCampaign.set(r.campaign_id, set);
  }
  const tracked = new Set(skus);
  const toRow = (r: AdScanRowRecord, s: AdScanRecord): ScanRow => {
    const c = byId.get(r.campaign_id);
    return {
      sku: r.sku,
      campaignId: r.campaign_id,
      campaignName: c?.name ?? r.campaign_name,
      spend: Number(r.spend),
      views: Number(r.views),
      clicks: Number(r.clicks),
      units: Number(r.units),
      revenue: Number(r.revenue),
      // Average a day over the whole period (the report's days), so per-SKU figures add up to the headline.
      days: s.days,
      budget: c?.daily_budget == null ? null : Number(c.daily_budget),
      shared: Boolean(c?.shared_budget) || (c?.skus.length ?? 0) > 1 || (skusPerCampaign.get(r.campaign_id)?.size ?? 0) > 1,
      status: c?.status ?? null,
    };
  };
  const rows = scan ? scanRows.filter((r) => tracked.has(r.sku)).map((r) => toRow(r, scan)) : [];

  // The trend: average daily spend on tracked SKUs, for the last 8 scans.
  const recent = scans.slice(0, 8);
  const trendRows =
    recent.length && skus.length
      ? await all<AdScanRowRecord>(() =>
          db
            .from("ad_scan_rows")
            .select(ROW_COLS)
            .in(
              "scan_id",
              recent.map((s) => s.id),
            )
            .in("sku", skus)
            .order("scan_id")
            .order("sku")
            .order("campaign_id"),
        )
      : [];
  // With the daily record, the trend is week by week from it (exact, all campaigns); without it, scan by scan as before.
  const weeks = dataTo
    ? Array.from({ length: 8 }, (_, k) => {
        const to = shiftDay(dataTo, -7 * k);
        const from = shiftDay(to, -6);
        const t = range(from, to);
        return t ? { id: `week-${from}`, from, to, days: 7, spend: t.spend, avg: t.spend / 7 } : null;
      })
        .filter((w): w is NonNullable<typeof w> => w !== null)
        .reverse()
    : [];
  const scanTrend = recent
    .map((s) => {
      const mine = trendRows.filter((r) => r.scan_id === s.id);
      const spend = mine.reduce((n, r) => n + Number(r.spend), 0);
          // Average a day over the whole period: all of the scan's spend, divided by its days.
      return { id: s.id, from: s.period_start, to: s.period_end, days: s.days, spend, avg: spend / Math.max(1, s.days) };
    })
    .reverse();
  const trend = weeks.length >= 2 ? weeks : scanTrend;

  // The chosen scan against the true spend for its days: the headline numbers, and whether its SKU split is complete.
  const truth = scan ? range(scan.period_start, scan.period_end) : null;
  const fsnTotal = scanRows.reduce((n, r) => n + Number(r.spend), 0);
  const coverage = truth ? fsnCoverage(fsnTotal, truth.spend) : null;
  const lastWeek = dataTo ? range(shiftDay(dataTo, -6), dataTo) : null;

  // The campaign log, with each campaign's numbers in the chosen scan (tracked SKUs only).
  const inScan = new Map<string, { spend: number; revenue: number; units: number }>();
  for (const r of rows) {
    const t = inScan.get(r.campaignId) ?? { spend: 0, revenue: 0, units: 0 };
    t.spend += r.spend;
    t.revenue += r.revenue;
    t.units += r.units;
    inScan.set(r.campaignId, t);
  }
  const log: CampaignLogRow[] = campaigns.map((c) => ({
    campaignId: c.campaign_id,
    name: c.name,
    skus: c.skus,
    type: c.campaign_type,
    budget: c.daily_budget == null ? null : Number(c.daily_budget),
    shared: c.shared_budget,
    startDate: c.start_date,
    status: c.status,
    notes: c.notes,
    source: c.source,
    createdAt: c.created_at,
    inScan: inScan.get(c.campaign_id) ?? null,
  }));
  // Campaigns in the scan that are not in the log (a SKU tracked after the sync that found them).
  for (const [id, t] of inScan) {
    if (byId.has(id)) continue;
    const r = rows.find((x) => x.campaignId === id)!;
    log.push({ campaignId: id, name: r.campaignName, skus: [...new Set(rows.filter((x) => x.campaignId === id).map((x) => x.sku))], type: null, budget: null, shared: r.shared, startDate: null, status: "Live", notes: null, source: "report", createdAt: "", inScan: t });
  }

  const view: AdsView = {
    scans: scans.map((s) => ({ id: s.id, from: s.period_start, to: s.period_end, days: s.days, filename: s.filename, createdAt: s.created_at })),
    scanId: scan?.id ?? null,
    skus,
    rows,
    trend,
    trendBy: trend === weeks && weeks.length >= 2 ? "week" : "scan",
    log,
    daily: {
      to: dataTo,
      staleDays: dataTo ? daysBetween(dataTo, today) - 1 : null,
      scan: truth,
      fsnTotal,
      coverage,
      lastWeek: lastWeek && dataTo ? { from: shiftDay(dataTo, -6), to: dataTo, ...lastWeek } : null,
    },
  };
  return <AdsTracker view={view} />;
}
