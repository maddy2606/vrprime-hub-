"use server";

import { revalidatePath } from "next/cache";
import { getActiveUser } from "@/lib/auth";
import { MAX_MASTER_ROWS, type MasterRow } from "@/lib/master-csv";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";
import { dbError, NOT_SIGNED_IN } from "@/server/action-helpers";

// The Master SKUs tab. Owner and admin only; the database checks that again in every function.

const EDITORS = ["owner", "admin"];

async function editor(): Promise<ActionResult<never> | null> {
  const user = await getActiveUser();
  if (!user) return NOT_SIGNED_IN;
  if (!EDITORS.includes(user.role)) return { ok: false, message: "Only the owner or an admin can change master SKUs." };
  return null;
}

const skuOk = (v: unknown): v is string => typeof v === "string" && v.trim() !== "" && v.length <= 200;
const unitsOk = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A database error as a message; the functions not being installed yet gets its own plain sentence. */
function failed(error: { message: string; code?: string }, what: string): ActionResult<never> {
  if (error.code === "PGRST202") return { ok: false, message: "This is not switched on in the database yet. Ask the developer." };
  return dbError(error, what);
}

function done(message: string): ActionResult {
  revalidatePath("/flipkart");
  revalidatePath("/pnl");
  return { ok: true, message };
}

/** Links a Flipkart SKU to a master SKU (or moves it, or changes its units per order). */
export async function linkSku(sku: unknown, masterId: unknown, units: unknown): Promise<ActionResult> {
  const denied = await editor();
  if (denied) return denied;
  if (!skuOk(sku)) return { ok: false, message: "Type the Flipkart SKU." };
  if (typeof masterId !== "string" || !UUID.test(masterId)) return { ok: false, message: "Pick a master SKU from the list." };
  if (!unitsOk(units)) return { ok: false, message: "Units per order must be a whole number from 1 to 1000." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("master_link_sku", { p_sku: sku, p_master: masterId, p_units: units });
  if (error) return failed(error, "link the SKU");
  return done(`${sku} linked${units > 1 ? ` (×${units})` : ""}`);
}

/** Unlinks a SKU: it goes back to "Not linked yet". */
export async function unlinkSku(sku: unknown): Promise<ActionResult> {
  const denied = await editor();
  if (denied) return denied;
  if (!skuOk(sku)) return { ok: false, message: "That SKU was not understood." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("master_unlink_sku", { p_sku: sku });
  if (error) return failed(error, "unlink the SKU");
  return done(`${sku} unlinked`);
}

/** "Remove": takes a SKU out of the checks and lists. */
export async function excludeSku(sku: unknown): Promise<ActionResult> {
  const denied = await editor();
  if (denied) return denied;
  if (!skuOk(sku)) return { ok: false, message: "That SKU was not understood." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("master_exclude_sku", { p_sku: sku });
  if (error) return failed(error, "remove the SKU");
  return done(`${sku} removed from the checks`);
}

/** Puts a removed SKU back. */
export async function restoreSku(sku: unknown): Promise<ActionResult> {
  const denied = await editor();
  if (denied) return denied;
  if (!skuOk(sku)) return { ok: false, message: "That SKU was not understood." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("master_restore_sku", { p_sku: sku });
  if (error) return failed(error, "put the SKU back");
  return done(`${sku} is back under Not linked yet`);
}

export type ImportResult = { productsAdded: number; productsUpdated: number; linksAdded: number; linksChanged: number };

/** Merges master SKUs (code, name) and optional links from an Excel or CSV file. Nothing is removed. */
export async function importMasters(rows: unknown): Promise<ActionResult<ImportResult>> {
  const denied = await editor();
  if (denied) return denied;
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, message: "The file has no lines under the header." };
  if (rows.length > MAX_MASTER_ROWS) return { ok: false, message: `The file has more than ${MAX_MASTER_ROWS} lines.` };
  const clean: { code?: string; name?: string; sku?: string; units?: number }[] = [];
  for (const r of rows as Partial<MasterRow>[]) {
    const name = typeof r?.master === "string" ? r.master.trim() : "";
    const code = typeof r?.code === "string" ? r.code.trim() : "";
    const sku = typeof r?.sku === "string" ? r.sku : "";
    if ((!name && !code) || name.length > 200 || code.length > 60 || sku.length > 200) return { ok: false, message: "Nothing was changed: a line has no master SKU, or a value is too long." };
    if (r?.units !== undefined && !unitsOk(r.units)) return { ok: false, message: "Nothing was changed: units per order must be 1 to 1000." };
    clean.push({ ...(code ? { code } : {}), ...(name ? { name } : {}), ...(sku.trim() ? { sku } : {}), ...(r?.units ? { units: r.units } : {}) });
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("master_import", { p_rows: clean });
  if (error) {
    if (error.code === "22023") return { ok: false, message: `Nothing was changed: ${error.message}.` };
    return failed(error, "import the master SKUs");
  }
  const d = (data ?? {}) as Record<string, unknown>;
  const n = (k: string) => (typeof d[k] === "number" ? (d[k] as number) : 0);
  const result: ImportResult = { productsAdded: n("products_added"), productsUpdated: n("products_updated"), linksAdded: n("links_added"), linksChanged: n("links_changed") };
  revalidatePath("/flipkart");
  return {
    ok: true,
    message: `Imported: ${result.productsAdded} master SKUs added, ${result.productsUpdated} updated, ${result.linksAdded} SKUs linked, ${result.linksChanged} links changed.`,
    data: result,
  };
}

/** A new master SKU (code optional, name required). */
export async function createMaster(code: unknown, name: unknown): Promise<ActionResult> {
  const denied = await editor();
  if (denied) return denied;
  const c = typeof code === "string" ? code.trim() : "";
  const n = typeof name === "string" ? name.trim() : "";
  if (!n || n.length > 200 || c.length > 60) return { ok: false, message: "Give the master SKU a name (and, if you like, a code)." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("master_import", { p_rows: [{ ...(c ? { code: c } : {}), name: n }] });
  if (error) {
    if (error.code === "23505") return { ok: false, message: "That code or name is already used by another master SKU." };
    return failed(error, "add the master SKU");
  }
  return done(`Master SKU ${c || n} saved`);
}

/** Makes a master SKU a kit (combo) of other master SKUs, or changes its parts; no parts turns the kit off. */
export async function setKit(masterId: unknown, parts: unknown): Promise<ActionResult> {
  const denied = await editor();
  if (denied) return denied;
  if (typeof masterId !== "string" || !UUID.test(masterId)) return { ok: false, message: "That master SKU was not understood." };
  if (!Array.isArray(parts) || parts.length > 20) return { ok: false, message: "A kit has at most 20 parts." };
  const clean: { part: string; qty: number }[] = [];
  for (const p of parts as { partId?: unknown; qty?: unknown }[]) {
    if (typeof p?.partId !== "string" || !UUID.test(p.partId)) return { ok: false, message: "Pick each part from the list of master SKUs." };
    if (!unitsOk(p.qty)) return { ok: false, message: "Each part's quantity must be a whole number from 1 to 1000." };
    clean.push({ part: p.partId, qty: p.qty });
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("master_set_kit", { p_master: masterId, p_parts: clean });
  if (error) {
    if (error.code === "22023") return { ok: false, message: `Not saved: ${error.message}.` };
    return failed(error, "save the kit");
  }
  return done(clean.length ? "Kit saved" : "No longer a kit");
}
