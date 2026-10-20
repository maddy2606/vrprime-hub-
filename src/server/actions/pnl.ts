"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActiveUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";
import { dbError, NOT_SIGNED_IN } from "@/server/action-helpers";

// The P&L page's costs. Owner only: checked here, and by row level security on master_costs.

type Loose = { from: (table: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

const schema = z
  .array(z.object({ masterId: z.uuid(), cost: z.number().min(0).max(1_000_000).nullable() }))
  .min(1)
  .max(1000);

/** Saves the pack-of-1 cost of master SKUs; a cost of null removes it. */
export async function saveMasterCosts(input: unknown): Promise<ActionResult> {
  const user = await getActiveUser();
  if (!user) return NOT_SIGNED_IN;
  if (user.role !== "owner") return { ok: false, message: "Only the owner can change costs." };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Each cost should be a number of rupees, 0 or more." };
  const db = (await createClient()) as unknown as Loose;
  const now = new Date().toISOString();
  const set = parsed.data.filter((c) => c.cost !== null).map((c) => ({ master_id: c.masterId, cost: Math.round(c.cost! * 100) / 100, updated_at: now, updated_by: user.id }));
  const clear = parsed.data.filter((c) => c.cost === null).map((c) => c.masterId);
  if (set.length) {
    const { error } = await db.from("master_costs").upsert(set, { onConflict: "master_id" });
    if (error) return dbError(error, "save the costs");
  }
  if (clear.length) {
    const { error } = await db.from("master_costs").delete().in("master_id", clear);
    if (error) return dbError(error, "remove the costs");
  }
  revalidatePath("/pnl");
  const n = parsed.data.length;
  return { ok: true, message: `${n} ${n === 1 ? "cost" : "costs"} saved` };
}
