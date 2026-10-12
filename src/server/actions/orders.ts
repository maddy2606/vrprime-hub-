"use server";

import { revalidatePath } from "next/cache";
import { getActiveUser } from "@/lib/auth";
import { RUN_COLUMNS, toRun, type OrderSyncState, type RunSummary } from "@/lib/orders-sync";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";
import { dbError, NOT_SIGNED_IN } from "@/server/action-helpers";

const CAN_SYNC = ["owner", "manager"];

/** The "Sync now" buttons on the Orders and Returns tabs. Owner and manager only (the database checks this too). */
export async function startOrdersSync(kind: "pending" | "daily"): Promise<ActionResult<{ run: RunSummary }>> {
  const user = await getActiveUser();
  if (!user) return NOT_SIGNED_IN;
  if (!CAN_SYNC.includes(user.role)) return { ok: false, message: "Only the owner or a manager can sync orders." };
  if (kind !== "pending" && kind !== "daily") return { ok: false, message: "Unknown kind of sync." };

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
  const [latest, pending, daily, backfill] = await Promise.all([
    supabase.from("order_runs").select(RUN_COLUMNS).neq("kind", "backfill").order("created_at", { ascending: false }).limit(1),
    supabase.from("order_runs").select(RUN_COLUMNS).eq("kind", "pending").eq("status", "done").order("finished_at", { ascending: false }).limit(1),
    supabase.from("order_runs").select(RUN_COLUMNS).eq("kind", "daily").eq("status", "done").order("finished_at", { ascending: false }).limit(1),
    supabase.from("order_runs").select(RUN_COLUMNS).eq("kind", "backfill").order("created_at", { ascending: false }).limit(1),
  ]);
  if (latest.error || pending.error || daily.error || backfill.error) return null;
  const one = (r: { data: Parameters<typeof toRun>[0][] | null }) => (r.data?.[0] ? toRun(r.data[0], canSeeError) : null);
  return { latest: one(latest), lastPending: one(pending), lastDaily: one(daily), backfill: one(backfill) };
}
