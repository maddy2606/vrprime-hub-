"use server";

import { z } from "zod";
import { getActiveUser } from "@/lib/auth";
import { ordersQuerySchema, type OrdersViewResult, type SkuDetail } from "@/lib/orders-view";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";
import { NOT_SIGNED_IN } from "@/server/action-helpers";
import { warehousesFor } from "@/server/flipkart-data";
import { loadOrderCards, loadOrdersView, loadSkuDetail, pickWarehouseOf } from "@/server/orders-view";

const FAILED = { ok: false, message: "Could not load the orders. Try again." } as const;

/** The next page (or the first page of another list) of the Orders tab. The database decides which warehouses this person sees. */
export async function loadOrdersViewAction(input: unknown): Promise<ActionResult<OrdersViewResult>> {
  const user = await getActiveUser();
  if (!user) return NOT_SIGNED_IN;
  const parsed = ordersQuerySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That request was not understood." };

  try {
    const supabase = await createClient();
    const q = parsed.data;
    let pick = q.wh;
    if (q.view === "pick" && !pick) {
      const warehouses = await warehousesFor(user);
      pick = pickWarehouseOf("", await loadOrderCards(supabase, warehouses, {}), warehouses);
    }
    return { ok: true, message: "", data: await loadOrdersView(supabase, q, pick) };
  } catch {
    return FAILED;
  }
}

const detailSchema = z.object({
  sku: z.string().min(1).max(200),
  wh: z.union([z.literal(""), z.string().uuid()]),
  status: z.enum(["active", "to_accept", "to_pack", "to_dispatch", "upcoming", "processing"]),
});

/** A SKU's orders and stock, when its row is opened. */
export async function loadSkuDetailAction(input: unknown): Promise<ActionResult<SkuDetail>> {
  const user = await getActiveUser();
  if (!user) return NOT_SIGNED_IN;
  const parsed = detailSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That request was not understood." };
  try {
    const supabase = await createClient();
    return { ok: true, message: "", data: await loadSkuDetail(supabase, parsed.data.sku, parsed.data.wh, parsed.data.status) };
  } catch {
    return FAILED;
  }
}

