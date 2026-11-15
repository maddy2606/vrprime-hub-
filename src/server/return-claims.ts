import "server-only";
import { readClaimRows, weekStart, type ClaimRow } from "@/lib/return-claims";
import { logError } from "@/lib/redact";
import { createClient } from "@/lib/supabase/server";
import type { Loose } from "@/server/team-data";

export type ClaimsData = {
  rows: ClaimRow[];
  checkedThisWeek: number;
  /** False until the return_checks migration is applied (the function or table is missing). */
  ready: boolean;
};

/**
 * Returns to claim (graphite-spec 12.2): returns_to_claim() runs as the signed-in user, so a warehouse user gets only
 * their warehouses' returns; "Checked this week" counts the visible checks since Monday, India time.
 */
export async function loadReturnsToClaim(today: string): Promise<ClaimsData> {
  const db = (await createClient()) as unknown as Loose;
  const [list, checked] = await Promise.all([
    db.rpc("returns_to_claim"),
    db.from("return_checks").select("return_id", { count: "exact", head: true }).gte("checked_at", `${weekStart(today)}T00:00:00+05:30`),
  ]);
  if (list.error) {
    logError("returns to claim", list.error);
    return { rows: [], checkedThisWeek: 0, ready: false };
  }
  return { rows: readClaimRows(list.data), checkedThisWeek: checked.error ? 0 : (checked.count ?? 0), ready: true };
}

/** The To check count for the tab label (0 or more days left), or null when it cannot be read. */
export async function loadToCheckCount(): Promise<number | null> {
  const db = (await createClient()) as unknown as Loose;
  const { data, error } = await db.rpc("returns_to_claim");
  if (error) return null;
  return readClaimRows(data).filter((r) => r.daysLeft >= 0).length;
}
