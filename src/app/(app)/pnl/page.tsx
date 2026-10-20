import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PnlBoard, type AdsUpload, type CostingRow, type MonthPnl, type UnlinkedSku } from "@/components/pnl/pnl-board";
import { requireUser } from "@/lib/auth";
import { applyAds, findSku, masterUnitCost, monthlyPnl, skuCost, type KitPart, type MasterInfo, type MonthAds, type MonthUnits, type ReportUnits, type SkuFacts } from "@/lib/costing";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "P&L" };

// The tables are newer than the generated types.
type Loose = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

// Orders have been synced from early September 2026.
const FROM = "2026-09-01";
const ADS_GST = 0.18;
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

/** Profit and loss by month from the synced Flipkart orders, and the cost of every master SKU. Owner only. */
export default async function PnlPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  if (user.role !== "owner") notFound();
  const db = (await createClient()) as unknown as Loose;
  const sp = await searchParams;

  const [mpRes, linkRes, costRes, priceRes, unitsRes, feeRes, adRes, adUpRes, rateRes] = await Promise.all([
    db.from("master_products").select("id, name, kit_parts").order("name"),
    db.from("sku_master").select("channel_sku, master_id, units_per_order"),
    db.from("master_costs").select("master_id, cost"),
    db.from("stock_listings").select("sku, selling_price, title").eq("platform", "flipkart"),
    db.rpc("pnl_month_units", { p_from: FROM }),
    db.from("app_settings").select("value").eq("key", "money_default_fee_percent").maybeSingle(),
    db.from("pnl_ad_spend").select("month, sku, spend").limit(20000),
    db.from("pnl_ad_uploads").select("month, period_from, period_to, filename, skus, spend, uploaded_at").order("month", { ascending: false }),
    db.rpc("pnl_report_units", { p_from: FROM }),
  ]);

  const masters = new Map<string, MasterInfo>(
    ((mpRes.data ?? []) as { id: string; name: string; kit_parts: KitPart[] | null }[]).map((m) => [m.id, { id: m.id, name: m.name, kitParts: Array.isArray(m.kit_parts) ? m.kit_parts : [] }]),
  );
  const costs: Record<string, number> = {};
  for (const c of (costRes.data ?? []) as { master_id: string; cost: number }[]) costs[c.master_id] = Number(c.cost);
  const links = (linkRes.data ?? []) as { channel_sku: string; master_id: string; units_per_order: number | null }[];
  const prices = new Map<string, number>();
  const titles = new Map<string, string>();
  for (const p of (priceRes.data ?? []) as { sku: string; selling_price: number | null; title: string | null }[]) {
    if (p.selling_price !== null) prices.set(p.sku, Number(p.selling_price));
    if (p.title) titles.set(p.sku, p.title);
  }
  const pricesLower = new Map([...prices].map(([k, v]) => [k.toLowerCase(), v]));
  const feePct = Number((feeRes.data as { value: unknown } | null)?.value ?? 12) || 12;

  // Each Flipkart SKU: its master, its cost (unit cost x units in an order) and its selling price now.
  const linkBy = new Map(links.map((l) => [l.channel_sku, l]));
  const linkLower = new Map(links.map((l) => [l.channel_sku.toLowerCase(), l]));
  type Raw = { month: string; sku: string; in_report: boolean; ordered: number; cancelled: number; cust_returned: number; rto: number; sold_value: number; sold_priced_units: number; first_day: string | null; last_day: string | null };
  const unitRows = ((Array.isArray(unitsRes.data) ? unitsRes.data : []) as Raw[]).map((r) => ({
    month: r.month,
    sku: r.sku,
    inReport: r.in_report === true,
    ordered: Number(r.ordered),
    cancelled: Number(r.cancelled),
    custReturned: Number(r.cust_returned),
    rto: Number(r.rto),
    soldValue: Number(r.sold_value),
    soldPricedUnits: Number(r.sold_priced_units),
    first_day: r.first_day,
    last_day: r.last_day,
  }));
  // Flipkart's own P&L report figures per month and SKU, and each SKU's per-unit seller price and net earnings from it
  // (from at least 3 units sold), which price the orders after the report ends.
  type RawReport = { month: string; sku: string; gross: number; ret_canc: number; net: number; item_value: number; fsp_value: number; sales: number; earnings: number; first_day: string | null; last_day: string | null };
  const rawReport = (Array.isArray(rateRes.data) ? rateRes.data : []) as RawReport[];
  const reportRows: ReportUnits[] = rawReport.map((r) => ({
    month: r.month,
    sku: r.sku,
    gross: Number(r.gross),
    retCanc: Number(r.ret_canc),
    net: Number(r.net),
    itemValue: Number(r.item_value),
    sales: Number(r.sales),
    earnings: Number(r.earnings),
    firstDay: r.first_day,
    lastDay: r.last_day,
  }));
  const perSku = new Map<string, { net: number; sales: number; earnings: number }>();
  let fspAll = 0;
  let salesAll = 0;
  for (const r of rawReport) {
    const t = perSku.get(r.sku) ?? { net: 0, sales: 0, earnings: 0 };
    t.net += Number(r.net);
    t.sales += Number(r.sales);
    t.earnings += Number(r.earnings);
    perSku.set(r.sku, t);
    fspAll += Number(r.fsp_value);
    salesAll += Number(r.sales);
  }
  const rates = new Map<string, { salesPerUnit: number; earnPerUnit: number }>();
  for (const [sku, t] of perSku) if (t.net >= 3) rates.set(sku, { salesPerUnit: t.sales / t.net, earnPerUnit: t.earnings / t.net });
  const ratesLower = new Map([...rates].map(([k, v]) => [k.toLowerCase(), v]));
  // Seller price against selling price across the report: prices a SKU the report never had. 1 with no report yet.
  const fspToSales = fspAll > 0 ? salesAll / fspAll : 1;
  const facts = new Map<string, SkuFacts>();
  for (const sku of new Set([...unitRows.map((r) => r.sku), ...reportRows.map((r) => r.sku)])) {
    const link = findSku(sku, linkBy, linkLower);
    const unit = link ? masterUnitCost(link.master_id, masters, costs) : null;
    facts.set(sku, {
      masterId: link?.master_id ?? null,
      cost: link ? skuCost(link.units_per_order ?? 1, unit) : null,
      price: findSku(sku, prices, pricesLower) ?? null,
      salesPerUnit: findSku(sku, rates, ratesLower)?.salesPerUnit ?? null,
      earnPerUnit: findSku(sku, rates, ratesLower)?.earnPerUnit ?? null,
    });
  }
  const pnl = monthlyPnl(unitRows as MonthUnits[], reportRows, facts, { feePct, fspToSales });
  // Ad spend from the uploaded Flipkart Ads reports: off each month, and off the master SKU each advertised SKU belongs to.
  const adRows: MonthAds[] = ((adRes.data ?? []) as { month: string; sku: string; spend: number }[]).map((a) => ({
    month: a.month,
    masterKey: findSku(a.sku, linkBy, linkLower)?.master_id ?? "unlinked",
    // Ad spend in the report is before GST; Flipkart adds 18% GST to it.
    spend: Math.round(Number(a.spend) * (1 + ADS_GST) * 100) / 100,
  }));
  applyAds(pnl, adRows);
  const uploads: AdsUpload[] = ((adUpRes.data ?? []) as { month: string; period_from: string; period_to: string; filename: string | null; skus: number; spend: number; uploaded_at: string }[]).map((u) => ({
    month: u.month,
    label: monthLabel(u.month),
    from: u.period_from,
    to: u.period_to,
    filename: u.filename,
    skus: u.skus,
    spend: Number(u.spend),
    uploadedAt: u.uploaded_at,
  }));
  // Flipkart SKUs sold in each month that are not linked to a master SKU, so they have no cost.
  const unlinked = new Map<string, UnlinkedSku[]>();
  for (const r of unitRows) {
    const f = facts.get(r.sku);
    const sold = Math.max(0, r.ordered - r.custReturned - r.rto);
    if (!f || f.masterId !== null || sold === 0) continue;
    const sales = r.soldValue + Math.max(0, sold - r.soldPricedUnits) * (f.price ?? 0);
    unlinked.set(r.month, [...(unlinked.get(r.month) ?? []), { sku: r.sku, title: titles.get(r.sku) ?? null, units: sold, sales }]);
  }
  const span = new Map<string, { from: string; to: string }>();
  for (const r of unitRows) {
    if (!r.first_day || !r.last_day) continue;
    const s = span.get(r.month);
    span.set(r.month, { from: !s || r.first_day < s.from ? r.first_day : s.from, to: !s || r.last_day > s.to ? r.last_day : s.to });
  }
  const months: MonthPnl[] = [...pnl.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, p]) => ({
      month,
      label: monthLabel(month),
      from: span.get(month)?.from ?? null,
      to: span.get(month)?.to ?? null,
      total: p.total,
      counts: p.counts,
      report: p.report,
      adsUpload: uploads.find((u) => u.month === month) ?? null,
      unlinked: (unlinked.get(month) ?? []).sort((a, b) => b.sales - a.sales || b.units - a.units),
      byMaster: [...p.byMaster.entries()].map(([id, line]) => ({ id, name: id === "unlinked" ? "SKUs not linked to a master" : (masters.get(id)?.name ?? "Unknown"), ...line })).sort((a, b) => b.sales - a.sales),
    }));

  // The costing list: every master SKU, its cost, and what its Flipkart SKUs cost.
  const skusOf = new Map<string, { sku: string; units: number }[]>();
  for (const l of links) skusOf.set(l.master_id, [...(skusOf.get(l.master_id) ?? []), { sku: l.channel_sku, units: l.units_per_order ?? 1 }]);
  const costing: CostingRow[] = [...masters.values()].map((m) => ({
    id: m.id,
    name: m.name,
    cost: costs[m.id] ?? null,
    kitParts: m.kitParts.map((p) => ({ name: masters.get(p.part)?.name ?? "Unknown", id: p.part, qty: p.qty })),
    skus: (skusOf.get(m.id) ?? []).sort((a, b) => a.units - b.units || a.sku.localeCompare(b.sku)),
  }));

  const asked = typeof sp.month === "string" ? sp.month : null;
  return <PnlBoard months={months} month={asked && months.some((m) => m.month === asked) ? asked : (months[0]?.month ?? null)} costing={costing} uploads={uploads} feePct={feePct} reportSkus={rates.size} error={unitsRes.error?.message ?? null} />;
}
