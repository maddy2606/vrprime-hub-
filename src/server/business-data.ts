import "server-only";
import { readTargetValue, readWeekFigures, type WeekFigures } from "@/lib/business";
import { classifyDeadStock, type DeadInput, type DeadRow } from "@/lib/dead-stock";
import { buildMasterGroups, readForecast } from "@/lib/forecast";
import { inventoryByProduct } from "@/lib/inventory-report";
import { masterLookup } from "@/lib/master-csv";
import { logError } from "@/lib/redact";
import { createClient } from "@/lib/supabase/server";
import { loadInventory, loadMasterData, masterRows } from "@/server/flipkart-data";
import { loadPnl, type PnlData } from "@/server/pnl-data";
import { forUser } from "@/server/short-cache-user";
import type { Loose } from "@/server/team-data";

// The owner's Business page (graphite-spec 12.1). The page checks the role; business_week() checks it again.
// Every loader here goes through the 30-second short cache (graphite-spec 10.2). Only answers are kept: a load that
// fails throws inside the cache, so the cache drops it and the next open asks the database again.

export type BusinessWeek = { cur: WeekFigures; prev: WeekFigures; ready: boolean };

export async function loadBusinessWeek(start: string, days: number): Promise<BusinessWeek> {
  try {
    return await forUser("loadBusinessWeek", [start, days], async () => {
      const db = (await createClient()) as unknown as Loose;
      const { data, error } = await db.rpc("business_week", { p_start: start, p_days: days });
      if (error) throw error;
      const o = (data ?? {}) as Record<string, unknown>;
      return { cur: readWeekFigures(o.cur), prev: readWeekFigures(o.prev), ready: true };
    });
  } catch (error) {
    logError("business week", error);
    return { cur: readWeekFigures(null), prev: readWeekFigures(null), ready: false };
  }
}

export type BusinessTargets = { sales: number | null; profit: number | null; pnl: PnlData };

/** The two monthly targets and the Dashboard's own P&L loader, so the figures match the Dashboard exactly. */
export async function loadTargets(): Promise<BusinessTargets> {
  // Both asked at once; the P&L has its own short cache.
  const [rows, pnl] = await Promise.all([loadTargetRows(), loadPnl()]);
  const read = (key: string) => readTargetValue(rows.find((r) => r.key === key)?.value);
  return { sales: read("target_sales_month"), profit: read("target_profit_month"), pnl };
}

type TargetRow = { key: string; value: unknown };

/** The two target settings. If they cannot be read the targets show as not set, as before. */
async function loadTargetRows(): Promise<TargetRow[]> {
  try {
    return await forUser("loadTargetRows", [], async () => {
      const db = (await createClient()) as unknown as Loose;
      const { data, error } = await db.from("app_settings").select("key, value").in("key", ["target_sales_month", "target_profit_month"]);
      if (error) throw error;
      return (data ?? []) as TargetRow[];
    });
  } catch {
    return [];
  }
}

export type DeadStockData = { rows: DeadRow[]; warehouses: { id: string; name: string }[]; error: boolean };

/**
 * Dead and slow stock from the Forecasting tab's "By product" figures with the 30-day window (same rpc, same stock from
 * the inventory report, same grouping), kits by their own stock, plus master_costs.cost.
 */
export async function loadDeadStock(): Promise<DeadStockData> {
  try {
    return await forUser("loadDeadStock", [], loadDeadStockFresh);
  } catch (error) {
    if (!(error instanceof NoForecast)) logError("dead stock", error);
    return { rows: [], warehouses: [], error: true };
  }
}

/** The forecast could not be read (it was never logged). */
class NoForecast extends Error {}

async function loadDeadStockFresh(): Promise<DeadStockData> {
  const supabase = await createClient();
  const db = supabase as unknown as Loose;
  const [forecast, masters, inventory, costs, wh] = await Promise.all([
    supabase.rpc("flipkart_forecast", { p_days: 30 }),
    loadMasterData(supabase),
    loadInventory(supabase),
    db.from("master_costs").select("master_id, cost"),
    supabase.from("warehouses").select("id, name, sort_order").order("sort_order"),
  ]);
  const parsed = forecast.error ? null : readForecast(forecast.data);
  if (!parsed) throw new NoForecast();
  const { byProduct } = inventoryByProduct(inventory.stock, masters.products);
  const masterOf = masterLookup(masterRows(masters));
  // No kits passed: a kit keeps its own stock, not what its parts can make.
  const { groups } = buildMasterGroups(parsed.raw, parsed.meta.days, masterOf, null, new Set(masters.removed), [], byProduct);
  const costById = new Map(((costs.data ?? []) as { master_id: string; cost: number | string }[]).map((c) => [c.master_id, Number(c.cost)]));
  const productByName = new Map(masters.products.map((p) => [p.name, p]));
  const inputs: DeadInput[] = groups.map((g) => {
    const p = productByName.get(g.name);
    const cost = p ? costById.get(p.id) : undefined;
    return {
      name: g.name,
      code: p?.code ?? null,
      stock: g.total.stock,
      dispatched: g.total.dispatched,
      cover: g.total.cover,
      byWarehouse: [...(byProduct.get(g.name) ?? [])].filter(([, n]) => n > 0).map(([wid, pieces]) => ({ wid, pieces })),
      cost: cost !== undefined && Number.isFinite(cost) ? cost : null,
    };
  });
  return { rows: classifyDeadStock(inputs), warehouses: (wh.data ?? []).map((w) => ({ id: w.id, name: w.name })), error: false };
}
