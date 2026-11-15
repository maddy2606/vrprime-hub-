// Obviously fake Ads tracker and Review tracker data for the local-only /dev/preview screen. Never used in production.
import type { AdsView } from "@/components/ads/ads-tracker";
import type { ReviewsView } from "@/components/reviews/review-tracker";
import { reviewLines, type ReviewLink } from "@/lib/reviews";

export function fakeAdsTracker(): AdsView {
  const camp = (i: number, spend: number, revenue: number, units: number, status: "Live" | "Paused") => ({
    sku: `FAKE-AD-SKU-${i}`,
    campaignId: `FAKECAMP${i}`,
    campaignName: `FAKE campaign ${i}`,
    spend,
    views: spend * 40,
    clicks: Math.round(spend / 7),
    units,
    revenue,
    days: 7,
    budget: i % 2 ? 1500 : null,
    shared: i === 3,
    status,
  });
  const rows = [camp(1, 21000, 168000, 410, "Live"), camp(2, 14500, 61000, 150, "Live"), camp(3, 9800, 21000, 52, "Live"), camp(4, 4200, 0, 0, "Paused")];
  return {
    scans: [
      { id: "fake-scan-2", from: "2026-11-03", to: "2026-11-09", days: 7, filename: "fake-fsn-report.csv", createdAt: "2026-11-10T09:00:00+05:30" },
      { id: "fake-scan-1", from: "2026-10-27", to: "2026-11-02", days: 7, filename: "fake-fsn-report-old.csv", createdAt: "2026-11-03T09:00:00+05:30" },
    ],
    scanId: "fake-scan-2",
    skus: rows.map((r) => r.sku),
    rows,
    trend: [
      { id: "w1", from: "2026-10-13", to: "2026-10-19", days: 7, spend: 38000, avg: 5429 },
      { id: "w2", from: "2026-10-20", to: "2026-10-26", days: 7, spend: 44000, avg: 6286 },
      { id: "w3", from: "2026-10-27", to: "2026-11-02", days: 7, spend: 47500, avg: 6786 },
      { id: "w4", from: "2026-11-03", to: "2026-11-09", days: 7, spend: 49500, avg: 7071 },
    ],
    trendBy: "week",
    log: rows.map((r, i) => ({
      campaignId: r.campaignId,
      name: r.campaignName,
      skus: [r.sku],
      type: "PLA",
      budget: r.budget,
      shared: r.shared,
      startDate: "2026-10-01",
      status: r.status,
      notes: i === 0 ? "Fake note: raised the budget on 1 Nov" : null,
      source: i % 2 ? ("report" as const) : ("manual" as const),
      createdAt: "2026-10-01T10:00:00+05:30",
      inScan: { spend: r.spend, revenue: r.revenue, units: r.units },
    })),
    daily: {
      to: "2026-11-09",
      staleDays: 1,
      scan: { spend: 52000, revenue: 262000, units: 640 },
      fsnTotal: 49500,
      coverage: { pct: 95, complete: true },
      lastWeek: { from: "2026-11-03", to: "2026-11-09", spend: 52000, revenue: 262000, units: 640 },
    },
  };
}

export function fakeReviews(): ReviewsView {
  const links: ReviewLink[] = Array.from({ length: 10 }, (_, i) => ({
    rowNo: i + 1,
    platform: i % 3 === 2 ? ("Shopsy" as const) : ("Flipkart" as const),
    product: `Fake Product ${i + 1}`,
    sku: `FAKE-RV-SKU-${i + 1}`,
    url: "https://example.test/fake-listing",
    priority: i < 8 ? i + 1 : null,
    target: i % 4 === 3 ? null : 100 + i * 40,
    sharesWith: i === 6 ? 1 : null,
  }));
  const now = new Map<number, number | null>(links.map((l, i) => [l.rowNo, i === 4 ? null : 40 + i * 37]));
  const before = new Map<number, number | null>(links.map((l, i) => [l.rowNo, i === 5 ? null : 40 + i * 37 + (i % 3 === 0 ? 3 : i % 3 === 1 ? -4 : 0)]));
  return {
    checks: [
      { day: "2026-11-14", note: "Fake check" },
      { day: "2026-11-07", note: null },
      { day: "2026-10-31", note: null },
    ],
    day: "2026-11-14",
    prevDay: "2026-11-07",
    lines: reviewLines(links, now, before),
    trend: [
      { day: "2026-10-31", reviews: 1180, missing: 0 },
      { day: "2026-11-07", reviews: 1215, missing: 1 },
      { day: "2026-11-14", reviews: 1242, missing: 1 },
    ],
  };
}
