"use server";

import { getActiveUser } from "@/lib/auth";
import { returnsQuerySchema, type ReturnsPage, type ReturnsSummary } from "@/lib/returns-view";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";
import { NOT_SIGNED_IN } from "@/server/action-helpers";
import { loadReturnsPage, loadReturnsSummary } from "@/server/returns-view";

/** The next page, a search, a sort or a filter on the Returns tab. The database decides which warehouses this person sees. */
export async function loadReturnsAction(input: unknown): Promise<ActionResult<ReturnsPage & { summary: ReturnsSummary | null }>> {
  const user = await getActiveUser();
  if (!user) return NOT_SIGNED_IN;
  const parsed = returnsQuerySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That request was not understood." };
  try {
    const supabase = await createClient();
    const q = parsed.data;
    // The totals follow the warehouse choice, so they are read again with the first page.
    const [page, summary] = await Promise.all([loadReturnsPage(supabase, q), q.offset === 0 ? loadReturnsSummary(supabase, q.wh) : Promise.resolve(null)]);
    return { ok: true, message: "", data: { ...page, summary } };
  } catch {
    return { ok: false, message: "Could not load the returns. Try again." };
  }
}
