"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActiveUser } from "@/lib/auth";
import { todayIST } from "@/lib/format";
import { parseCostCsv } from "@/lib/money/costs";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";
import { dbError, invalid, NOT_SIGNED_IN } from "@/server/action-helpers";
import { isMoneyEnabled } from "@/server/money-flag";

// SKU costs. Owner only: checked here, and by row level security on the table.

const amount = z.coerce.number().min(0, "Enter 0 or more").max(10_000_000, "That is too large");
const costSchema = z.object({
  sku: z.string().min(1, "Enter the SKU").max(120),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  purchase_cost: amount,
  packaging_cost: amount.default(0),
  freight: amount.default(0),
});

async function owner() {
  const user = await getActiveUser();
  if (!user) return { error: NOT_SIGNED_IN, user: null };
  if (user.role !== "owner") return { error: { ok: false as const, message: "Only the owner can change costs." }, user: null };
  if (!(await isMoneyEnabled())) return { error: { ok: false as const, message: "Money is switched off." }, user: null };
  return { error: null, user };
}

export async function saveCost(input: unknown): Promise<ActionResult> {
  const ctx = await owner();
  if (ctx.error) return ctx.error;
  const parsed = costSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase
    .from("sku_costs" as never)
    .upsert({ ...parsed.data, updated_at: new Date().toISOString(), updated_by: ctx.user.id } as never, { onConflict: "sku,effective_from" });
  if (error) return dbError(error, "save the cost");
  revalidatePath("/money");
  return { ok: true, message: `Cost saved for ${parsed.data.sku}` };
}

export async function deleteCost(sku: unknown, effectiveFrom: unknown): Promise<ActionResult> {
  const ctx = await owner();
  if (ctx.error) return ctx.error;
  const parsed = z.object({ sku: z.string().min(1).max(120), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).safeParse({ sku, from: effectiveFrom });
  if (!parsed.success) return { ok: false, message: "That cost was not understood." };
  const supabase = await createClient();
  const { error } = await supabase.from("sku_costs" as never).delete().eq("sku", parsed.data.sku).eq("effective_from", parsed.data.from);
  if (error) return dbError(error, "delete the cost");
  revalidatePath("/money");
  return { ok: true, message: "Cost removed" };
}

/** The text of a CSV file with sku, purchase_cost, packaging_cost, freight, effective_from. All or nothing. */
export async function importCosts(text: unknown): Promise<ActionResult<{ count: number }>> {
  const ctx = await owner();
  if (ctx.error) return ctx.error;
  if (typeof text !== "string" || text.length > 2_000_000) return { ok: false, message: "That file is too large for a cost list." };
  let rows;
  try {
    rows = parseCostCsv(text, todayIST());
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "The file could not be read." };
  }
  const supabase = await createClient();
  const stamp = new Date().toISOString();
  const { error } = await supabase
    .from("sku_costs" as never)
    .upsert(rows.map((r) => ({ ...r, updated_at: stamp, updated_by: ctx.user.id })) as never, { onConflict: "sku,effective_from" });
  if (error) return dbError(error, "import the costs");
  revalidatePath("/money");
  return { ok: true, message: `${rows.length} ${rows.length === 1 ? "cost" : "costs"} imported`, data: { count: rows.length } };
}
