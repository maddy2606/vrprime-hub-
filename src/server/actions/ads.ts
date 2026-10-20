"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { readAdsCampaignReport } from "@/lib/ads-report";
import { canManage, getActiveUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";
import { dbError, NOT_SIGNED_IN } from "@/server/action-helpers";

// The Ads tracker's actions. Owner and admin only: checked here, and by row level security on the ad_* tables.

type Loose = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
};

const NOT_ALLOWED: ActionResult<never> = { ok: false, message: "Only the owner or an admin can change the Ads tracker." };
const day = (d: string) => new Date(`${d}T12:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
const skuSchema = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .pipe(z.string().min(1, "Type a SKU.").max(60, "A SKU is at most 60 characters.").regex(/^[A-Z0-9 _./+-]+$/, "A SKU has letters, numbers and - _ . / + only."));

type Staff = { ok: false; error: ActionResult<never> } | { ok: true; user: NonNullable<Awaited<ReturnType<typeof getActiveUser>>>; db: Loose };

async function staff(): Promise<Staff> {
  const user = await getActiveUser();
  if (!user) return { ok: false, error: NOT_SIGNED_IN };
  if (!canManage(user)) return { ok: false, error: NOT_ALLOWED };
  return { ok: true, user, db: (await createClient()) as unknown as Loose };
}

/**
 * Sync: reads a PLA Consolidated FSN Report (CSV text) and saves it as one scan. A second sync of the same period replaces
 * the first. Campaigns found on tracked SKUs are added to the campaign log.
 */
export async function syncAdsReport(text: unknown, filename: unknown): Promise<ActionResult> {
  const s = await staff();
  if (!s.ok) return s.error;
  if (typeof text !== "string" || text.length === 0 || text.length > 8_000_000) return { ok: false, message: "That file is empty or too large. Upload the report as downloaded (CSV)." };
  const read = readAdsCampaignReport(text);
  if (!read.ok) return { ok: false, message: read.error };
  const { from, to, rows, spend } = read.report;

  const { data: trackedRows, error: tErr } = await s.db.from("ad_tracked_skus").select("sku");
  if (tErr) return dbError(tErr, "read the tracked SKUs");
  const tracked = new Set(((trackedRows ?? []) as { sku: string }[]).map((r) => r.sku));
  const campaigns = new Map<string, { campaign_id: string; name: string; skus: Set<string> }>();
  for (const r of rows) {
    if (!tracked.has(r.sku) || !/^[A-Z0-9]{4,30}$/.test(r.campaign_id)) continue;
    const c = campaigns.get(r.campaign_id) ?? { campaign_id: r.campaign_id, name: r.campaign_name, skus: new Set<string>() };
    c.skus.add(r.sku);
    campaigns.set(r.campaign_id, c);
  }
  const ids = [...campaigns.keys()].slice(0, 500);
  const { data: known } = ids.length ? await s.db.from("ad_campaigns").select("campaign_id").in("campaign_id", ids) : { data: [] };
  const knownIds = new Set(((known ?? []) as { campaign_id: string }[]).map((r) => r.campaign_id));
  const fresh = [...campaigns.keys()].filter((id) => !knownIds.has(id)).length;

  const { error } = await s.db.rpc("ads_tracker_save_scan", {
    p_from: from,
    p_to: to,
    p_filename: typeof filename === "string" ? filename.slice(0, 200) : null,
    p_rows: rows,
    p_campaigns: [...campaigns.values()].map((c) => ({ campaign_id: c.campaign_id, name: c.name, skus: [...c.skus] })),
  });
  if (error) return dbError(error, "save the ads report");
  revalidatePath("/ads");
  const trackedSpend = rows.filter((r) => tracked.has(r.sku)).reduce((n, r) => n + r.spend, 0);
  return {
    ok: true,
    message: `Synced ${day(from)} to ${day(to)}: ₹${Math.round(trackedSpend).toLocaleString("en-IN")} on tracked SKUs (₹${Math.round(spend).toLocaleString("en-IN")} in the whole report)${fresh ? `, ${fresh} new ${fresh === 1 ? "campaign" : "campaigns"} added to the log` : ""}`,
  };
}

const campaignSchema = z.object({
  campaignId: z
    .string()
    .transform((s) => s.trim().toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9]{4,30}$/, "Campaign ID is letters and numbers only, like 7SCQQ9CHX7RP.")),
  name: z.string().trim().min(1, "Add the campaign name.").max(200),
  skus: z.array(skuSchema).min(1, "Add at least one SKU.").max(200),
  type: z.string().trim().max(40).nullable(),
  dailyBudget: z.number().min(0).max(10_000_000).nullable(),
  sharedBudget: z.boolean(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  status: z.enum(["Live", "Paused", "Ended", "Draft"]),
  notes: z.string().trim().max(500).nullable(),
});

/** Adds a campaign to the log, or changes one already there. Its SKUs are tracked from then on. */
export async function saveAdCampaign(input: unknown): Promise<ActionResult> {
  const s = await staff();
  if (!s.ok) return s.error;
  const parsed = campaignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the campaign details." };
  const c = parsed.data;
  const skus = [...new Set(c.skus)];
  const fields = {
    name: c.name,
    skus,
    campaign_type: c.type || null,
    daily_budget: c.dailyBudget === null ? null : Math.round(c.dailyBudget * 100) / 100,
    shared_budget: c.sharedBudget,
    start_date: c.startDate,
    status: c.status,
    notes: c.notes || null,
    updated_at: new Date().toISOString(),
  };
  const { data: existing, error: readErr } = await s.db.from("ad_campaigns").select("campaign_id").eq("campaign_id", c.campaignId).maybeSingle();
  if (readErr) return dbError(readErr, "read the campaign");
  const { error } = existing
    ? await s.db.from("ad_campaigns").update(fields).eq("campaign_id", c.campaignId)
    : await s.db.from("ad_campaigns").insert({ campaign_id: c.campaignId, ...fields, source: "manual", created_by: s.user.id });
  if (error) return dbError(error, "save the campaign");
  const { error: skuErr } = await s.db.from("ad_tracked_skus").upsert(
    skus.map((sku) => ({ sku, added_by: s.user.id })),
    { onConflict: "sku", ignoreDuplicates: true },
  );
  if (skuErr) return dbError(skuErr, "track the campaign's SKUs");
  revalidatePath("/ads");
  return { ok: true, message: existing ? `${c.name} saved` : `${c.name} added to the log` };
}

/** Removes a campaign from the log. Its numbers in past scans stay. */
export async function deleteAdCampaign(campaignId: unknown): Promise<ActionResult> {
  const s = await staff();
  if (!s.ok) return s.error;
  if (typeof campaignId !== "string" || !/^[A-Z0-9]{4,30}$/.test(campaignId)) return { ok: false, message: "That campaign was not found." };
  const { error } = await s.db.from("ad_campaigns").delete().eq("campaign_id", campaignId);
  if (error) return dbError(error, "remove the campaign");
  revalidatePath("/ads");
  return { ok: true, message: "Campaign removed from the log" };
}

/** Starts tracking a SKU. */
export async function addTrackedSku(sku: unknown): Promise<ActionResult> {
  const s = await staff();
  if (!s.ok) return s.error;
  const parsed = skuSchema.safeParse(typeof sku === "string" ? sku : "");
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Type a SKU." };
  const { error } = await s.db.from("ad_tracked_skus").upsert({ sku: parsed.data, added_by: s.user.id }, { onConflict: "sku", ignoreDuplicates: true });
  if (error) return dbError(error, "track the SKU");
  revalidatePath("/ads");
  return { ok: true, message: `Tracking ${parsed.data}` };
}

/** Stops tracking a SKU. Its numbers in past scans stay, and come back if it is tracked again. */
export async function removeTrackedSku(sku: unknown): Promise<ActionResult> {
  const s = await staff();
  if (!s.ok) return s.error;
  if (typeof sku !== "string" || !sku) return { ok: false, message: "That SKU was not found." };
  const { error } = await s.db.from("ad_tracked_skus").delete().eq("sku", sku);
  if (error) return dbError(error, "stop tracking the SKU");
  revalidatePath("/ads");
  return { ok: true, message: `Stopped tracking ${sku}` };
}
