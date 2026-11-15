"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActiveUser } from "@/lib/auth";
import { ticketNumber } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult, Platform } from "@/lib/types";
import { ticketSchema } from "@/lib/validation";
import { logError } from "@/lib/redact";
import { dbError, invalid, NOT_SIGNED_IN } from "@/server/action-helpers";

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

/** The same marketplace ticket should not be saved twice. Returns the existing VR-T number, if any. */
async function findDuplicate(
  supabase: SupabaseServer,
  platform: Platform,
  marketplaceId: string,
  ignoreId?: string,
): Promise<number | null> {
  let query = supabase.from("tickets").select("number").eq("platform", platform).eq("ticket_id", marketplaceId).limit(1);
  if (ignoreId) query = query.neq("id", ignoreId);
  const { data } = await query;
  return data?.length ? data[0].number : null;
}

export async function createTicket(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await getActiveUser();
  if (!user) return NOT_SIGNED_IN;
  const parsed = ticketSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;

  const supabase = await createClient();
  const existing = await findDuplicate(supabase, v.platform, v.ticket_id);
  if (existing !== null) {
    return {
      ok: false,
      message: `That ticket is already saved as ${ticketNumber(existing)}.`,
      fieldErrors: { ticket_id: `Already saved as ${ticketNumber(existing)}` },
    };
  }

  // A ticket raised from Returns to claim also saves the return (tickets.return_id, graphite-spec 12.2). The column is
  // only sent when there is a return, so ordinary tickets work before that migration is applied.
  const fromReturn = v.return_id && v.order_item_id ? { return_id: v.return_id, order_item_id: v.order_item_id } : null;
  const { data, error } = await supabase
    .from("tickets")
    .insert({
      ticket_id: v.ticket_id,
      platform: v.platform,
      issue_type: v.issue_type,
      post_id: v.post_id,
      sku: v.sku,
      raised_on: v.raised_on,
      next_follow_up: v.next_follow_up,
      status: v.status,
      resolution_notes: v.resolution_notes,
      created_by: user.id,
      ...(fromReturn ? { return_id: fromReturn.return_id } : {}),
    })
    .select("id, number")
    .single();
  if (error) return dbError(error, "save the ticket");
  if (fromReturn) {
    const { error: checkError } = await (supabase as unknown as LooseRpc).rpc("return_check_ticket", {
      p_return_id: fromReturn.return_id,
      p_order_item_id: fromReturn.order_item_id,
      p_ticket: data.id,
    });
    // The ticket is saved either way; the return stays on the list if its check could not be written.
    if (checkError) logError("return check ticket", checkError);
  }

  revalidatePath("/", "layout");
  return { ok: true, message: `Ticket ${ticketNumber(data.number)} saved`, data: { id: data.id } };
}

export async function updateTicket(ticketId: unknown, input: unknown): Promise<ActionResult> {
  const user = await getActiveUser();
  if (!user) return NOT_SIGNED_IN;
  const id = z.uuid().safeParse(ticketId);
  if (!id.success) return { ok: false, message: "Ticket not found." };
  const parsed = ticketSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;

  const supabase = await createClient();
  const existing = await findDuplicate(supabase, v.platform, v.ticket_id, id.data);
  if (existing !== null) {
    return {
      ok: false,
      message: `Another ticket already uses that ID (${ticketNumber(existing)}).`,
      fieldErrors: { ticket_id: `Already saved as ${ticketNumber(existing)}` },
    };
  }

  // The link to a post is set when the ticket is raised and not changed here.
  const { data, error } = await supabase
    .from("tickets")
    .update({
      ticket_id: v.ticket_id,
      platform: v.platform,
      issue_type: v.issue_type,
      sku: v.sku,
      raised_on: v.raised_on,
      next_follow_up: v.next_follow_up,
      status: v.status,
      resolution_notes: v.resolution_notes,
    })
    .eq("id", id.data)
    .select("number");
  if (error) return dbError(error, "save the ticket");
  if (!data.length) return { ok: false, message: "Ticket not found, or you do not have access to it." };

  revalidatePath("/", "layout");
  return { ok: true, message: `Ticket ${ticketNumber(data[0].number)} saved` };
}

const returnKey = z.string().trim().min(1).max(120);

/** "Looks fine" on Returns to claim (graphite-spec 12.2): records an 'ok' check, so the return leaves the list. */
export async function markReturnChecked(returnId: unknown, orderItemId: unknown): Promise<ActionResult> {
  const user = await getActiveUser();
  if (!user) return NOT_SIGNED_IN;
  const r = returnKey.safeParse(returnId);
  const i = returnKey.safeParse(orderItemId);
  if (!r.success || !i.success) return { ok: false, message: "That return was not found." };
  const supabase = (await createClient()) as unknown as LooseRpc;
  const { error } = await supabase.rpc("return_check_ok", { p_return_id: r.data, p_order_item_id: i.data });
  if (error) return dbError(error, "mark the return as checked");
  revalidatePath("/flipkart");
  return { ok: true, message: "Marked as checked" };
}

type LooseRpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: { message: string; code?: string } | null }> };
