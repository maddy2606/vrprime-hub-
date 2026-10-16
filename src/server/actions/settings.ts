"use server";

import { revalidatePath } from "next/cache";
import { getActiveUser } from "@/lib/auth";
import { parseMasterCsv } from "@/lib/master-csv";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";
import { fieldErrors, settingsSchema } from "@/lib/validation";
import { dbError, NOT_SIGNED_IN } from "@/server/action-helpers";

/** The thresholds on the Stock page. Owner only; the database checks that too. */
export async function saveSettings(input: unknown): Promise<ActionResult> {
  const user = await getActiveUser();
  if (!user) return NOT_SIGNED_IN;
  if (user.role !== "owner") return { ok: false, message: "Only the owner can change settings." };

  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  for (const [key, value] of Object.entries(parsed.data)) {
    const { data, error } = await supabase
      .from("app_settings")
      .update({ value, updated_at: new Date().toISOString(), updated_by: user.id })
      .eq("key", key)
      .select("key");
    if (error) return dbError(error, "save the settings");
    if (!data.length) return { ok: false, message: "That setting does not exist. Ask the developer." };
  }

  revalidatePath("/", "layout");
  return { ok: true, message: "Settings saved" };
}

/** Switches Money (Phase 6) on or off. Owner only; the database checks that too. */
export async function setMoneyEnabled(enabled: unknown): Promise<ActionResult> {
  const user = await getActiveUser();
  if (!user) return NOT_SIGNED_IN;
  if (user.role !== "owner") return { ok: false, message: "Only the owner can change settings." };
  if (typeof enabled !== "boolean") return { ok: false, message: "That was not understood." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_settings")
    .update({ value: enabled, updated_at: new Date().toISOString(), updated_by: user.id })
    .eq("key", "money_enabled")
    .select("key");
  if (error) return dbError(error, "change Money");
  if (!data.length) return { ok: false, message: "The Money switch is missing. Ask the developer." };
  revalidatePath("/", "layout");
  return { ok: true, message: enabled ? "Money is on" : "Money is off" };
}

export type MasterUploadResult = { rows: number; added: number; changed: number; removed: number; unchanged: number; products: number };

/**
 * "Upload master SKU list": the CSV (master_name, channel_sku) REPLACES the product mapping. Owner only; the
 * database checks that too and does the whole replacement in one transaction.
 */
export async function uploadMasterSkus(csv: unknown): Promise<ActionResult<MasterUploadResult>> {
  const user = await getActiveUser();
  if (!user) return NOT_SIGNED_IN;
  if (user.role !== "owner") return { ok: false, message: "Only the owner can upload the master SKU list." };
  if (typeof csv !== "string" || csv.length === 0) return { ok: false, message: "Choose a CSV file first." };
  if (csv.length > 1_000_000) return { ok: false, message: "That file is too big (over 1 MB). The list should be a few hundred lines." };

  const { rows, errors } = parseMasterCsv(csv);
  if (errors.length) return { ok: false, message: `Nothing was changed. ${errors.slice(0, 3).join(" ")}${errors.length > 3 ? ` (and ${errors.length - 3} more)` : ""}` };
  if (!rows.length) return { ok: false, message: "Nothing was changed: the file has no lines under the header." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("replace_master_skus", { p_rows: rows });
  if (error) {
    if (error.code === "PGRST202") return { ok: false, message: "The upload is not switched on in the database yet. Ask the developer." };
    return dbError(error, "replace the master SKU list");
  }
  const r = (data ?? {}) as Record<string, unknown>;
  const n = (k: string) => (typeof r[k] === "number" ? (r[k] as number) : 0);
  const result: MasterUploadResult = { rows: n("rows"), added: n("added"), changed: n("changed"), removed: n("removed"), unchanged: n("unchanged"), products: n("products") };
  revalidatePath("/flipkart");
  revalidatePath("/admin/settings");
  return {
    ok: true,
    message: `Master SKU list replaced: ${result.added} added, ${result.changed} changed, ${result.removed} removed, ${result.unchanged} unchanged (${result.products} products).`,
    data: result,
  };
}
