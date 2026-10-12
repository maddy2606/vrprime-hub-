"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActiveUser } from "@/lib/auth";
import { ticketNumber } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult, Platform } from "@/lib/types";
import { ticketSchema } from "@/lib/validation";
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
    })
    .select("id, number")
    .single();
  if (error) return dbError(error, "save the ticket");

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
