"use server";

import { revalidatePath } from "next/cache";
import { canManage, getActiveUser } from "@/lib/auth";
import { logError } from "@/lib/redact";
import { dbError, invalid, NOT_SIGNED_IN } from "@/server/action-helpers";
import { postNumber } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/labels";
import { cleanSku } from "@/lib/new-listing";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult, Post, PostComment } from "@/lib/types";
import {
  attachmentSchema,
  commentSchema,
  doneSchema,
  postSchema,
  statusSchema,
} from "@/lib/validation";
import { z } from "zod";

async function restockTitle(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sku: string,
  qty: number,
  warehouseId: string,
): Promise<string> {
  const { data } = await supabase.from("warehouses").select("name").eq("id", warehouseId).maybeSingle();
  return `Restock ${sku} × ${qty} to ${data?.name ?? "warehouse"}`;
}

type PostValues = z.output<typeof postSchema>;

/** The optional request details of a new listing. */
function listingDetails(v: PostValues) {
  return {
    product_name: v.product_name,
    reference_url: v.reference_url,
    target_price: v.target_price,
    mrp: v.mrp,
    dim_l: v.dim_l,
    dim_b: v.dim_b,
    dim_h: v.dim_h,
    weight_kg: v.weight_kg,
  };
}

export async function createPost(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await getActiveUser();
  if (!user) return NOT_SIGNED_IN;
  const parsed = postSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  const listing = v.type === "new_listing";
  if (listing && !canManage(user)) {
    return { ok: false, message: "Only an owner or an admin can post a new-listing request." };
  }

  const supabase = await createClient();
  const title =
    v.title ?? (await restockTitle(supabase, v.sku ?? "", v.qty_needed ?? 0, v.warehouse_id ?? ""));

  const { data, error } = await supabase
    .from("posts")
    .insert({
      type: v.type,
      title,
      details: v.details,
      priority: v.priority,
      // The SKU of a new listing is entered when it is marked done.
      sku: listing ? null : v.sku,
      warehouse_id: listing ? null : v.warehouse_id,
      platform: listing ? (v.platform ?? "flipkart") : v.platform,
      qty_needed: v.type === "restock" ? v.qty_needed : null,
      assignee_id: v.assignee_id,
      due_date: v.due_date,
      created_by: user.id,
      ...(listing ? listingDetails(v) : {}),
    })
    .select("id, number")
    .single();
  if (error) return dbError(error, "create the post");

  revalidatePath("/", "layout");
  return { ok: true, message: `Post ${postNumber(data.number)} created`, data: { id: data.id } };
}

export async function updatePost(postId: unknown, input: unknown): Promise<ActionResult> {
  const user = await getActiveUser();
  if (!user) return NOT_SIGNED_IN;
  const id = z.uuid().safeParse(postId);
  const parsed = postSchema.safeParse(input);
  if (!id.success) return { ok: false, message: "Post not found." };
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;

  const supabase = await createClient();
  const title =
    v.title ?? (await restockTitle(supabase, v.sku ?? "", v.qty_needed ?? 0, v.warehouse_id ?? ""));

  // The type of a post is fixed once created, so it is not updated here.
  const listing = v.type === "new_listing";
  if (listing && !v.sku) {
    // A done new listing needs its SKU (or the listing ID it was completed with before SKUs were asked for).
    const { data: current } = await supabase.from("posts").select("status, done_listing_id").eq("id", id.data).maybeSingle();
    if (current?.status === "done" && !current.done_listing_id) {
      return { ok: false, message: "A done new listing needs its SKU.", fieldErrors: { sku: "Enter the SKU" } };
    }
  }
  const { data, error } = await supabase
    .from("posts")
    .update({
      title,
      details: v.details,
      priority: v.priority,
      // A new listing's SKU is set by marking it done; here it can only be corrected (the form shows it once set).
      ...(listing ? (v.sku ? { sku: v.sku } : {}) : { sku: v.sku, warehouse_id: v.warehouse_id }),
      platform: v.platform,
      qty_needed: v.type === "restock" ? v.qty_needed : null,
      assignee_id: v.assignee_id,
      due_date: v.due_date,
      ...(listing ? listingDetails(v) : {}),
    })
    .eq("id", id.data)
    .select("number");
  if (error) return dbError(error, "save the changes");
  if (!data.length) return { ok: false, message: "Post not found, or you do not have access to it." };

  revalidatePath("/", "layout");
  return { ok: true, message: `${postNumber(data[0].number)} saved` };
}

export async function setStatus(input: unknown): Promise<ActionResult> {
  const user = await getActiveUser();
  if (!user) return NOT_SIGNED_IN;
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That status is not valid." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("posts")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.postId)
    .select("number");
  if (error) return dbError(error, "change the status");
  if (!data.length) return { ok: false, message: "Post not found, or you do not have access to it." };

  revalidatePath("/", "layout");
  return { ok: true, message: `Marked ${STATUS_LABEL[parsed.data.status].toLowerCase()}` };
}

export async function markDone(input: unknown): Promise<ActionResult> {
  const user = await getActiveUser();
  if (!user) return NOT_SIGNED_IN;
  const parsed = doneSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;

  const supabase = await createClient();
  const { data: post } = await supabase.from("posts").select("id, type, number").eq("id", v.postId).maybeSingle();
  if (!post) return { ok: false, message: "Post not found, or you do not have access to it." };

  // Proof needed depends on the type. The database enforces the same rule.
  const errors: Record<string, string> = {};
  const proof: Partial<Post> = { done_note: v.note };
  if (post.type === "problem") {
    if (v.no_ticket) {
      if (!v.no_ticket_reason) errors.no_ticket_reason = "Say why no ticket was needed";
      proof.done_ticket_id = null;
      proof.done_no_ticket_reason = v.no_ticket_reason;
    } else {
      if (!v.ticket_id) errors.ticket_id = "Enter the ticket ID, or tick \"No ticket needed\"";
      proof.done_ticket_id = v.ticket_id;
      proof.done_no_ticket_reason = null;
    }
  } else if (post.type === "new_listing") {
    // The SKU is the proof: it is looked up in the Flipkart listings at the next daily sync. The FSN is optional.
    const sku = cleanSku(v.sku);
    if (!sku.ok) errors.sku = sku.message;
    else proof.sku = sku.sku;
    proof.done_listing_id = v.listing_id;
  } else if (post.type === "restock") {
    if (v.qty === null) errors.qty = "Enter the quantity sent";
    if (!v.reference) errors.reference = "Enter the invoice or challan number";
    proof.done_qty = v.qty;
    proof.done_reference = v.reference;
  }
  if (Object.keys(errors).length) {
    return { ok: false, message: "Add the proof needed to mark this done.", fieldErrors: errors };
  }

  const { error } = await supabase.from("posts").update({ ...proof, status: "done" }).eq("id", post.id);
  if (error) return dbError(error, "mark this done");

  revalidatePath("/", "layout");
  return { ok: true, message: `${postNumber(post.number)} marked done` };
}

export async function addComment(input: unknown): Promise<ActionResult<PostComment>> {
  const user = await getActiveUser();
  if (!user) return NOT_SIGNED_IN;
  const parsed = commentSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("post_comments")
    .insert({ post_id: parsed.data.postId, author_id: user.id, body: parsed.data.body })
    .select("*")
    .single();
  if (error) return dbError(error, "post the comment");

  revalidatePath("/", "layout");
  // The new comment goes back to the browser so it can be shown at once.
  return { ok: true, message: "Comment posted", data };
}

/** Called after the browser has uploaded a compressed photo to Storage. */
export async function addAttachment(input: unknown): Promise<ActionResult> {
  const user = await getActiveUser();
  if (!user) return NOT_SIGNED_IN;
  const parsed = attachmentSchema.safeParse(input);
  if (!parsed.success || !parsed.data.path.startsWith(`${parsed.data.postId}/`)) {
    return { ok: false, message: "That photo could not be attached." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("post_attachments")
    .insert({ post_id: parsed.data.postId, path: parsed.data.path, uploaded_by: user.id });
  if (error) return dbError(error, "attach the photo");

  revalidatePath("/", "layout");
  return { ok: true, message: "Photo added" };
}

export async function removeAttachment(attachmentId: unknown): Promise<ActionResult> {
  const user = await getActiveUser();
  if (!user) return NOT_SIGNED_IN;
  const id = z.uuid().safeParse(attachmentId);
  if (!id.success) return { ok: false, message: "Photo not found." };

  const supabase = await createClient();
  const { data: removed, error } = await supabase
    .from("post_attachments")
    .delete()
    .eq("id", id.data)
    .select("path, post_id");
  if (error) return dbError(error, "remove the photo");
  if (!removed.length) return { ok: false, message: "Only the person who added a photo, or an owner or admin, can remove it." };

  // Best effort: the record is already gone, so a leftover file is only wasted space.
  const { error: storageError } = await supabase.storage.from("post-attachments").remove([removed[0].path]);
  if (storageError) logError("posts delete stored photo", storageError);

  revalidatePath("/", "layout");
  return { ok: true, message: "Photo removed" };
}
