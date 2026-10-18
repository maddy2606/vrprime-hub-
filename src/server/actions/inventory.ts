"use server";

import { revalidatePath } from "next/cache";
import { getActiveUser } from "@/lib/auth";
import type { InventoryLine } from "@/lib/inventory-report";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";
import { dbError, NOT_SIGNED_IN } from "@/server/action-helpers";

// The VR Prime inventory report, uploaded on the Forecasting tab (read in the browser, checked again here and in the
// database). Owner and admin only.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function uploadInventory(fileName: unknown, month: unknown, lines: unknown): Promise<ActionResult> {
  const user = await getActiveUser();
  if (!user) return NOT_SIGNED_IN;
  if (user.role !== "owner" && user.role !== "admin") return { ok: false, message: "Only the owner or an admin can upload the inventory report." };
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > 20000) return { ok: false, message: "The report has no products, or too many lines." };
  const rows: { code: string; name: string; wid: string; pieces: number }[] = [];
  for (const l of lines as Partial<InventoryLine>[]) {
    const code = typeof l?.code === "string" ? l.code.trim() : "";
    const name = typeof l?.name === "string" ? l.name.trim() : "";
    if (!code || code.length > 100 || !name || name.length > 200) return { ok: false, message: "Nothing was changed: a product has no code or name, or one is too long." };
    if (typeof l?.wid !== "string" || !UUID.test(l.wid)) return { ok: false, message: "Nothing was changed: a warehouse was not understood." };
    if (typeof l?.pieces !== "number" || !Number.isInteger(l.pieces) || l.pieces < 0) return { ok: false, message: "Nothing was changed: a stock number was not understood." };
    rows.push({ code, name, wid: l.wid, pieces: l.pieces });
  }
  const file = typeof fileName === "string" ? fileName.slice(0, 300) : "inventory report";
  const m = typeof month === "string" ? month.slice(0, 20) : null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("inventory_upload", { p_file: file, p_month: m, p_rows: rows });
  if (error) {
    if (error.code === "PGRST202") return { ok: false, message: "This is not switched on in the database yet. Ask the developer." };
    if (error.code === "22023") return { ok: false, message: `Nothing was changed: ${error.message}.` };
    return dbError(error, "upload the inventory report");
  }
  const d = (data ?? {}) as { products?: number; pieces?: number };
  revalidatePath("/flipkart");
  return { ok: true, message: `Inventory updated: ${d.products ?? 0} products, ${new Intl.NumberFormat("en-IN").format(d.pieces ?? 0)} pieces.` };
}

/** "Sync now": asks the database to read live stock from the VR Prime API. The answer arrives a few seconds later. */
export async function syncInventoryNow(): Promise<ActionResult> {
  const user = await getActiveUser();
  if (!user) return NOT_SIGNED_IN;
  if (user.role !== "owner" && user.role !== "admin") return { ok: false, message: "Only the owner or an admin can sync the stock." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_inventory_sync" as never);
  if (error) {
    if (error.code === "PGRST202") return { ok: false, message: "The live stock sync is not switched on in the database yet. Ask the developer." };
    return dbError(error, "start the stock sync");
  }
  return { ok: true, message: "Syncing live stock from VR Prime. It takes a few seconds." };
}
