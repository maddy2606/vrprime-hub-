// Obviously fake P&L and Dashboard data for the local-only /dev/preview screen (?view=pnl, ?view=dashboard).
// Never used in production. Every name is fake and every figure is made up.
import type { AdsUpload, CostingRow, MonthPnl } from "@/components/pnl/pnl-board";
import { fakeDeck } from "@/lib/dev-fixtures-deck";
import type { PnlLine } from "@/lib/costing";
import type { DashboardData } from "@/server/dashboard-data";
import type { PnlData } from "@/server/pnl-data";

function line(units: number, sales: number, costShare: number, adsShare: number): PnlLine {
  const fees = Math.round(sales * 0.12);
  const cost = Math.round(sales * costShare);
  const ads = Math.round(sales * adsShare);
  const profit = sales - fees - cost;
  return { units, sales, fees, cost, profit, ads, net: profit - ads, itemValue: sales, estSales: 0, uncostedSales: 0, unpricedUnits: 0, listPricedUnits: 0 };
}

const PRODUCTS = [
  { id: "m1", name: "Fake Lint Remover", units: 1800, sales: 540_000, cost: 0.34, ads: 0.08 },
  { id: "m2", name: "Fake Vacuum Mop", units: 620, sales: 372_000, cost: 0.41, ads: 0.11 },
  { id: "m3", name: "Fake Car Perfume", units: 900, sales: 180_000, cost: 0.3, ads: 0.06 },
  { id: "m4", name: "Fake Shoe Rack", units: 210, sales: 147_000, cost: 0.62, ads: 0.24 },
  { id: "m5", name: "Fake Cleaning Kit", units: 340, sales: 102_000, cost: 0.38, ads: 0.09 },
];

function month(m: string, label: string, scale: number, to: string | null): MonthPnl {
  const byMaster = PRODUCTS.map((p) => ({ id: p.id, name: p.name, ...line(Math.round(p.units * scale), Math.round(p.sales * scale), p.cost, p.ads) }));
  const total = byMaster.reduce<PnlLine>(
    (t, r) => ({
      ...t,
      units: t.units + r.units,
      sales: t.sales + r.sales,
      fees: t.fees + r.fees,
      cost: t.cost + r.cost,
      profit: t.profit + r.profit,
      ads: t.ads + r.ads,
      net: t.net + r.net,
      itemValue: t.itemValue + r.itemValue,
    }),
    line(0, 0, 0, 0),
  );
  const adsUpload: AdsUpload = { month: m, label, from: `${m}-01`, to: to ?? `${m}-30`, filename: "fake-ads-report.csv", skus: 14, spend: total.ads, uploadedAt: `${m}-10T10:00:00+05:30` };
  return {
    month: m,
    label,
    from: `${m}-01`,
    to,
    total,
    counts: { ordered: Math.round(4200 * scale), cancelled: Math.round(160 * scale), custReturned: Math.round(90 * scale), rto: Math.round(70 * scale) },
    report: { gross: Math.round(4100 * scale), retCanc: Math.round(300 * scale), net: Math.round(3800 * scale), from: `${m}-01`, to },
    byMaster,
    unlinked: [
      { sku: "FAKE-UNLINKED-1", title: "Fake unlinked product one", units: 40, sales: 12_000 },
      { sku: "FAKE-UNLINKED-2", title: null, units: 12, sales: 3_600 },
    ],
    adsUpload,
  };
}

export function fakePnl(): PnlData {
  const costing: CostingRow[] = PRODUCTS.map((p, i) => ({
    id: p.id,
    name: p.name,
    cost: i === 4 ? null : Math.round((p.sales / p.units) * p.cost),
    kitParts: i === 4 ? [{ id: "m1", name: "Fake Lint Remover", qty: 1 }, { id: "m3", name: "Fake Car Perfume", qty: 2 }] : [],
    skus: [{ sku: `FAKE-${p.id.toUpperCase()}-A`, units: Math.round(p.units * 0.7) }, { sku: `FAKE-${p.id.toUpperCase()}-B`, units: Math.round(p.units * 0.3) }],
  }));
  const months = [month("2026-11", "November 2026", 0.5, "2026-11-14"), month("2026-10", "October 2026", 1, "2026-10-31"), month("2026-09", "September 2026", 0.9, "2026-09-30"), month("2026-08", "August 2026", 0.8, "2026-08-31")];
  return { months, costing, uploads: months.map((m) => m.adsUpload).filter((u): u is AdsUpload => u !== null), feePct: 12, reportSkus: 42, cutoff: null, error: null };
}

export function fakeDashboard(): DashboardData {
  const deck = fakeDeck(false);
  const now = Date.now();
  return {
    deck,
    pnl: fakePnl(),
    today: deck.today,
    alerts: [
      { id: "a1", kind: "dispatch_risk", title: "12 orders may miss their dispatch deadline", body: null, createdAt: new Date(now - 25 * 60_000).toISOString(), href: "/flipkart?tab=orders" },
      { id: "a2", kind: "stock_alert", title: "Stock running low: 4 fake products", body: null, createdAt: new Date(now - 3 * 3600_000).toISOString(), href: "/flipkart?tab=stock" },
      { id: "a3", kind: "sync_alert", title: "Flipkart orders have not been read for 3 hours", body: null, createdAt: new Date(now - 5 * 3600_000).toISOString(), href: "/flipkart?tab=orders" },
    ],
  };
}
