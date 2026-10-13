"use server";

import { getActiveUser } from "@/lib/auth";
import { stockQuerySchema, type StockViewData } from "@/lib/stock-view";
import type { ActionResult } from "@/lib/types";
import { NOT_SIGNED_IN } from "@/server/action-helpers";
import { loadStockDesk } from "@/server/stock-view";

/** The next page, a search, a sort or another list on the Stock tab. The database decides which warehouses this person sees. */
export async function loadStockViewAction(input: unknown): Promise<ActionResult<StockViewData>> {
  const user = await getActiveUser();
  if (!user) return NOT_SIGNED_IN;
  const parsed = stockQuerySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That request was not understood." };
  try {
    const desk = await loadStockDesk(user, parsed.data);
    if (desk.kind !== "ready") return { ok: false, message: "There is no stock yet." };
    return { ok: true, message: "", data: desk.view };
  } catch {
    return { ok: false, message: "Could not load the stock. Try again." };
  }
}
