import "server-only";
import { readCheckRows, type CheckRow } from "@/lib/listing-view";
import { logError } from "@/lib/redact";
import { createClient } from "@/lib/supabase/server";
import type { Loose } from "@/server/team-data";

export type ListingCheckData = {
  /** The day of the latest check, or null before the first. */
  checkedOn: string | null;
  rows: CheckRow[];
  /** False until the listing_check migration is applied (the tables are missing). */
  ready: boolean;
};

/** The latest Listing check (graphite-spec 12.3) with each row's Review tracker link. RLS: owner and admin only. */
export async function loadListingCheck(): Promise<ListingCheckData> {
  const db = (await createClient()) as unknown as Loose;
  const latest = await db.from("listing_checks").select("id, checked_on").order("checked_on", { ascending: false }).limit(1);
  if (latest.error) {
    logError("listing check", latest.error);
    return { checkedOn: null, rows: [], ready: false };
  }
  const check = (latest.data ?? [])[0] as { id: string; checked_on: string } | undefined;
  if (!check) return { checkedOn: null, rows: [], ready: true };
  // The links are read on their own and joined here (the rows table has no foreign key to review_links).
  const [rows, links] = await Promise.all([
    db.from("listing_check_rows").select("row_no, status, price, expected_price").eq("check_id", check.id),
    db.from("review_links").select("row_no, product, platform, priority, url"),
  ]);
  if (rows.error || links.error) {
    logError("listing check rows", rows.error ?? links.error);
    return { checkedOn: check.checked_on, rows: [], ready: true };
  }
  const byRow = new Map(((links.data ?? []) as { row_no: number }[]).map((l) => [l.row_no, l]));
  const joined = ((rows.data ?? []) as { row_no: number }[]).map((r) => ({ ...r, review_links: byRow.get(r.row_no) ?? null }));
  return { checkedOn: check.checked_on, rows: readCheckRows(joined), ready: true };
}
