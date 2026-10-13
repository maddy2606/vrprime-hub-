import "server-only";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { readEstimateRows, readProfitRows, withProfit, type EstimateRow, type ProfitRow } from "@/lib/money/profit";
import { logError } from "@/lib/redact";
import { createClient } from "@/lib/supabase/server";
import type { SessionUser } from "@/lib/types";

// Everything here is owner only. The database enforces it (row level security on every money table, and every
// money function refuses anyone else); this layer also sends non-owners to "not found", so the page, its nav link
// and its numbers are invisible to them.

type Loose = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

export type MoneyDb = Loose;

export async function requireOwnerPage(): Promise<{ user: SessionUser; db: MoneyDb }> {
  const user = await requireUser();
  if (user.role !== "owner") notFound();
  return { user, db: (await createClient()) as unknown as MoneyDb };
}

function fail(where: string, error: unknown): never {
  logError(`money ${where}`, error);
  throw new Error("Could not load Money");
}

async function rpc(db: MoneyDb, fn: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const { data, error } = await db.rpc(fn, args);
  if (error) return fail(fn, error);
  return data;
}

export async function latestSettledDay(db: MoneyDb): Promise<string | null> {
  const { data, error } = await db.from("money_settled_lines").select("payment_date").order("payment_date", { ascending: false }).limit(1);
  if (error) return fail("latest day", error);
  return (data as { payment_date: string }[])[0]?.payment_date ?? null;
}

export async function loadProfit(db: MoneyDb, from: string, to: string): Promise<ProfitRow[]> {
  return readProfitRows(await rpc(db, "money_profit", { p_from: from, p_to: to })).map(withProfit);
}

export type AccountLine = { kind: string; expense: number; amount: number; lines: number };

export async function loadAccountLines(db: MoneyDb, from: string, to: string): Promise<AccountLine[]> {
  const data = await rpc(db, "money_account_lines", { p_from: from, p_to: to });
  return (Array.isArray(data) ? data : []).map((r: Record<string, unknown>) => ({
    kind: String(r.kind),
    expense: Number(r.expense ?? 0),
    amount: Number(r.amount ?? 0),
    lines: Number(r.lines ?? 0),
  }));
}

export async function loadEstimate(db: MoneyDb, from: string, to: string): Promise<EstimateRow[]> {
  return readEstimateRows(await rpc(db, "money_estimate", { p_from: from, p_to: to }));
}

export type Crosscheck = {
  compared: number;
  differ: number;
  tolerance: number;
  rows: { order_item_id: string; sku: string | null; neft_id: string; flipkart_amount: number; our_amount: number; diff: number }[];
};

export async function loadCrosscheck(db: MoneyDb): Promise<Crosscheck> {
  return (await rpc(db, "money_crosscheck", { p_tolerance: 5, p_limit: 100 })) as Crosscheck;
}

export type SkuLine = {
  order_item_id: string;
  order_id: string | null;
  payment_date: string;
  order_date: string | null;
  qty: number | null;
  sale_amount: number;
  refund: number;
  commission: number;
  fixed_fee: number;
  collection_fee: number;
  shipping_fee: number;
  reverse_shipping_fee: number;
  other_fees: number;
  gst_on_fees: number;
  tcs: number;
  tds: number;
  net: number;
  itc: number;
  return_type: string | null;
  unit_cost: number | null;
};

export async function loadSkuLines(db: MoneyDb, sku: string, from: string, to: string, limit: number, offset: number): Promise<{ total: number; rows: SkuLine[] }> {
  const data = (await rpc(db, "money_sku_lines", { p_sku: sku, p_from: from, p_to: to, p_limit: limit, p_offset: offset })) as { total: number; rows: SkuLine[] };
  return { total: Number(data.total ?? 0), rows: data.rows ?? [] };
}

export type Cost = { sku: string; effective_from: string; purchase_cost: number; packaging_cost: number; freight: number };

export async function loadCosts(db: MoneyDb): Promise<Cost[]> {
  const { data, error } = await db.from("sku_costs").select("sku, effective_from, purchase_cost, packaging_cost, freight").order("sku").order("effective_from", { ascending: false }).limit(5000);
  if (error) return fail("costs", error);
  return (data as Cost[]).map((c) => ({ ...c, purchase_cost: Number(c.purchase_cost), packaging_cost: Number(c.packaging_cost), freight: Number(c.freight) }));
}

export type WeightRow = {
  order_item_id: string;
  order_id: string | null;
  sku: string | null;
  payment_date: string;
  zone: string | null;
  weight_type: string | null;
  charged_slab: string;
  charged_kg: number;
  our_kg: number;
  our_slab_kg: number;
  fee_paid: number;
  usual_fee: number | null;
  extra_fee: number | null;
};

export async function loadWeight(db: MoneyDb, from: string, to: string): Promise<WeightRow[]> {
  const data = await rpc(db, "money_weight", { p_from: from, p_to: to });
  return (Array.isArray(data) ? data : []).map((r: Record<string, unknown>) => ({
    order_item_id: String(r.order_item_id),
    order_id: (r.order_id as string | null) ?? null,
    sku: (r.sku as string | null) ?? null,
    payment_date: String(r.payment_date),
    zone: (r.zone as string | null) ?? null,
    weight_type: (r.weight_type as string | null) ?? null,
    charged_slab: String(r.charged_slab),
    charged_kg: Number(r.charged_kg),
    our_kg: Number(r.our_kg),
    our_slab_kg: Number(r.our_slab_kg),
    fee_paid: Number(r.fee_paid ?? 0),
    usual_fee: r.usual_fee === null || r.usual_fee === undefined ? null : Number(r.usual_fee),
    extra_fee: r.extra_fee === null || r.extra_fee === undefined ? null : Number(r.extra_fee),
  }));
}

export type UnpaidRow = { order_item_id: string; order_id: string; sku: string | null; qty: number; order_day: string; days_ago: number };

export async function loadUnpaid(db: MoneyDb): Promise<UnpaidRow[]> {
  const data = await rpc(db, "money_unpaid");
  return (Array.isArray(data) ? data : []) as UnpaidRow[];
}

export type WrongFeeRow = {
  order_item_id: string;
  order_id: string | null;
  sku: string | null;
  payment_date: string;
  problem: string;
  sale: number;
  fee_points: number | null;
  usual_points: number | null;
  extra_fee: number | null;
};

export async function loadWrongFees(db: MoneyDb): Promise<WrongFeeRow[]> {
  const data = await rpc(db, "money_wrong_fees");
  return (Array.isArray(data) ? data : []).map((r: Record<string, unknown>) => ({
    order_item_id: String(r.order_item_id),
    order_id: (r.order_id as string | null) ?? null,
    sku: (r.sku as string | null) ?? null,
    payment_date: String(r.payment_date),
    problem: String(r.problem),
    sale: Number(r.sale ?? 0),
    fee_points: r.fee_points === null || r.fee_points === undefined ? null : Number(r.fee_points),
    usual_points: r.usual_points === null || r.usual_points === undefined ? null : Number(r.usual_points),
    extra_fee: r.extra_fee === null || r.extra_fee === undefined ? null : Number(r.extra_fee),
  }));
}

export type MoneyFlags = {
  latest: string | null;
  negative: { sku: string; margin: number; profit: number }[];
  low: { sku: string; margin: number; profit: number }[];
  unpaid: number;
  cost_missing: number;
  last_upload: string | null;
  low_margin_percent: number;
};

export async function loadFlags(db: MoneyDb): Promise<MoneyFlags | null> {
  const { data, error } = await db.rpc("money_flags");
  if (error) {
    logError("money flags", error);
    return null;
  }
  return data as MoneyFlags;
}

export type UploadRow = {
  id: string;
  kind: "settled" | "pnl";
  filename: string;
  period_from: string | null;
  period_to: string | null;
  rows_seen: number;
  rows_added: number;
  rows_dup: number;
  rows_updated: number;
  other_added: number;
  total_net: number | null;
  summary: { flipkart?: Record<string, number | string | null> } | null;
  status: "running" | "done" | "failed";
  error: string | null;
  created_at: string;
};

export async function loadUploads(db: MoneyDb): Promise<UploadRow[]> {
  const { data, error } = await db.from("money_uploads").select("*").order("created_at", { ascending: false }).limit(30);
  if (error) return fail("uploads", error);
  return data as UploadRow[];
}

export async function databaseSizeMb(db: MoneyDb): Promise<number | null> {
  const { data, error } = await db.rpc("money_db_size_mb");
  if (error) return null;
  return Number(data);
}
