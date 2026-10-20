import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PnlBoard, type CostingRow, type MonthPnl, type UnlinkedSku } from "@/components/pnl/pnl-board";
import { requireUser } from "@/lib/auth";
import { findSku, masterUnitCost, monthlyPnl, skuCost, type KitPart, type MasterInfo, type MonthUnits, type SkuFacts } from "@/lib/costing";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "P&L" };

// The tables are newer than the generated types.
type Loose = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

// Orders have been synced from early September 2026.
const FROM = "2026-09-01";
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

/** Profit and loss by month from the synced Flipkart orders, and the cost of every master SKU. Owner only. */
export default async function PnlPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  if (user.role !== "owner") notFound();
  const db = (await createClient()) as unknown as Loose;
  const sp = await searchParams;

  const [mpRes, linkRes, costRes, priceRes, unitsRes, feeRes] = await Promise.all([
    db.from("master_products").select("id, name, kit_parts").order("name"),
    db.from("sku_master").select("channel_sku, master_id, units_per_order"),
    db.from("master_costs").select("master_id, cost"),
    db.from("stock_listings").select("sku, selling_price, title").eq("platform", "flipkart"),
    db.rpc("pnl_month_units", { p_from: FROM }),
    db.from("app_settings").select("value").eq("key", "money_default_fee_percent").maybeSingle(),
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
  const unitRows = ((Array.isArray(unitsRes.data) ? unitsRes.data : []) as { month: string; sku: string; dispatched: number; returned: number; first_day: string | null; last_day: string | null }[]).map((r) => ({
    ...r,
    dispatched: Number(r.dispatched),
    returned: Number(r.returned),
  }));
  const facts = new Map<string, SkuFacts>();
  for (const sku of new Set(unitRows.map((r) => r.sku))) {
    const link = findSku(sku, linkBy, linkLower);
    const unit = link ? masterUnitCost(link.master_id, masters, costs) : null;
    facts.set(sku, { masterId: link?.master_id ?? null, cost: link ? skuCost(link.units_per_order ?? 1, unit) : null, price: findSku(sku, prices, pricesLower) ?? null });
  }
  const pnl = monthlyPnl(unitRows as MonthUnits[], facts, feePct);
  // Flipkart SKUs sold in each month that are not linked to a master SKU, so they have no cost.
  const unlinked = new Map<string, UnlinkedSku[]>();
  for (const r of unitRows) {
    const f = facts.get(r.sku);
    const sold = Math.max(0, r.dispatched - r.returned);
    if (!f || f.masterId !== null || sold === 0) continue;
    unlinked.set(r.month, [...(unlinked.get(r.month) ?? []), { sku: r.sku, title: titles.get(r.sku) ?? null, units: sold, sales: f.price === null ? 0 : sold * f.price }]);
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
  return <PnlBoard months={months} month={asked && months.some((m) => m.month === asked) ? asked : (months[0]?.month ?? null)} costing={costing} feePct={feePct} error={unitsRes.error?.message ?? null} />;
}
