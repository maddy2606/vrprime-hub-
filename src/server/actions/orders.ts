"use server";

import { revalidatePath } from "next/cache";
import { getActiveUser } from "@/lib/auth";
import { RUN_COLUMNS, toRun, type OrderSyncState, type RunSummary } from "@/lib/orders-sync";
import { logError } from "@/lib/redact";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";
import { dbError, NOT_SIGNED_IN } from "@/server/action-helpers";
import { readOrderSyncState } from "@/server/flipkart-data";

const CAN_SYNC = ["owner", "manager"];

/** The "Sync now" buttons on the Orders and Returns tabs. Owner and manager only (the database checks this too). */
export async function startOrdersSync(kind: "pending" | "daily" | "upcoming"): Promise<ActionResult<{ run: RunSummary }>> {
  const user = await getActiveUser();
  if (!user) return NOT_SIGNED_IN;
  if (!CAN_SYNC.includes(user.role)) return { ok: false, message: "Only the owner or a manager can sync orders." };
  if (kind !== "pending" && kind !== "daily" && kind !== "upcoming") return { ok: false, message: "Unknown kind of sync." };

  const supabase = await createClient();
  const { data: runId, error } = await supabase.rpc("request_orders_sync", { p_kind: kind });
  if (error) return dbError(error, "start the sync");

  const { data: row, error: readError } = await supabase.from("order_runs").select(RUN_COLUMNS).eq("id", runId).maybeSingle();
  if (readError || !row) return dbError(readError ?? { message: "run not found" }, "start the sync");

  revalidatePath("/flipkart");
  return { ok: true, message: "Sync started", data: { run: toRun(row, true) } };
}

/** Progress of the latest order sync, polled while one is running. */
export async function getOrdersSyncStatus(): Promise<OrderSyncState | null> {
  const user = await getActiveUser();
  if (!user) return null;
  const canSeeError = CAN_SYNC.includes(user.role);

  const supabase = await createClient();
  try {
    return await readOrderSyncState(supabase, canSeeError);
  } catch (error) {
    logError("order sync status", error);
    return null;
  }
}
