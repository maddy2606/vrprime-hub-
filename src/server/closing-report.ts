import "server-only";
import { readClosingRows, type ClosingRow } from "@/lib/closing-report";
import { logError } from "@/lib/redact";
import { createClient } from "@/lib/supabase/server";
import type { Loose } from "@/server/team-data";

export type ClosingData = {
  rows: ClosingRow[];
  /** False until the closing_report migration is applied (the table is missing). */
  ready: boolean;
};

/** The closing report for a day. RLS limits a warehouse user to their own warehouses. */
export async function loadClosingReport(day: string): Promise<ClosingData> {
  const db = (await createClient()) as unknown as Loose;
  const { data, error } = await db.from("closing_reports").select("*, warehouses(name, sort_order)").eq("day", day);
  if (error) {
    logError("closing report", error);
    return { rows: [], ready: false };
  }
  return { rows: readClosingRows(data), ready: true };
}
