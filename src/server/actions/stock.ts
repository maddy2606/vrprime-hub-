"use server";

import { revalidatePath } from "next/cache";
import { getActiveUser } from "@/lib/auth";
import { SYNC_COLUMNS, toSummary, type SyncSummary } from "@/lib/stock-sync";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";
import { dbError, NOT_SIGNED_IN } from "@/server/action-helpers";

const CAN_SYNC = ["owner", "manager"];

/** The "Sync now" button. Owner and manager only (the database checks this too). */
export async function startStockSync(): Promise<ActionResult<{ run: SyncSummary }>> {
  const user = await getActiveUser();
  if (!user) return NOT_SIGNED_IN;
  if (!CAN_SYNC.includes(user.role)) return { ok: false, message: "Only the owner or a manager can sync stock." };

  const supabase = await createClient();
  const { data: runId, error } = await supabase.rpc("request_stock_sync");
  if (error) return dbError(error, "start the sync");

  const { data: row, error: readError } = await supabase.from("stock_runs").select(SYNC_COLUMNS).eq("id", runId).maybeSingle();
  if (readError || !row) return dbError(readError ?? { message: "run not found" }, "start the sync");

  revalidatePath("/flipkart");
  return { ok: true, message: "Sync started", data: { run: toSummary(row, true) } };
}

/** Progress of the latest sync, polled while one is running. */
export async function getStockSyncStatus(): Promise<{ latest: SyncSummary | null; lastDone: SyncSummary | null } | null> {
  const user = await getActiveUser();
  if (!user) return null;
  const canSeeError = CAN_SYNC.includes(user.role);

  const supabase = await createClient();
  const [latest, done] = await Promise.all([
    supabase.from("stock_runs").select(SYNC_COLUMNS).order("created_at", { ascending: false }).limit(1),
    supabase.from("stock_runs").select(SYNC_COLUMNS).eq("status", "done").order("finished_at", { ascending: false }).limit(1),
  ]);
  if (latest.error || done.error) return null;
  return {
    latest: latest.data[0] ? toSummary(latest.data[0], canSeeError) : null,
    lastDone: done.data[0] ? toSummary(done.data[0], canSeeError) : null,
  };
}
