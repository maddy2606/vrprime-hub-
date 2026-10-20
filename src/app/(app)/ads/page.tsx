import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdsTracker, type AdsView, type CampaignLogRow, type ScanRow } from "@/components/ads/ads-tracker";
import { daysActive } from "@/lib/ads-report";
import { canManage, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { AdCampaignRecord, AdScanRecord, AdScanRowRecord } from "@/lib/types";

export const metadata: Metadata = { title: "Ads tracker" };

// The tables are newer than the generated types.
type Loose = { from: (table: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
type DbErr = { code?: string; message?: string } | null;

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

  const [skuRes, campRes, scanRes] = await Promise.all([
    db.from("ad_tracked_skus").select("sku").order("sku"),
    db.from("ad_campaigns").select("*").order("updated_at", { ascending: false }).limit(2000),
    db.from("ad_scans").select("id, period_start, period_end, days, filename, uploaded_by, created_at").order("period_end", { ascending: false }).limit(200),
  ]);
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
      days: daysActive(s.period_start, s.period_end, c?.start_date),
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
  const trend = recent
    .map((s) => {
      const mine = trendRows.filter((r) => r.scan_id === s.id);
      const spend = mine.reduce((n, r) => n + Number(r.spend), 0);
      const avg = mine.reduce((n, r) => n + Number(r.spend) / daysActive(s.period_start, s.period_end, byId.get(r.campaign_id)?.start_date), 0);
      return { id: s.id, from: s.period_start, to: s.period_end, days: s.days, spend, avg };
    })
    .reverse();

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
    log,
  };
  return <AdsTracker view={view} />;
}
