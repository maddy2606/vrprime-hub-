"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActiveUser } from "@/lib/auth";
import { categoryFor, EXPENSE_CATEGORIES, pickAmount, readReceipt } from "@/lib/expenses";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";
import { dbError, NOT_SIGNED_IN } from "@/server/action-helpers";
import { serverDb } from "@/server/service-db";

// The Expenses page's changes. Owner only (the database checks this too).

type Loose = { from: (table: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

async function owner(): Promise<{ ok: true; db: Loose; userId: string } | { ok: false; result: ActionResult }> {
  const user = await getActiveUser();
  if (!user) return { ok: false, result: NOT_SIGNED_IN };
  if (user.role !== "owner") return { ok: false, result: { ok: false, message: "Only the owner can change expenses." } };
  return { ok: true, db: (await createClient()) as unknown as Loose, userId: user.id };
}

const done = (message: string): ActionResult => {
  revalidatePath("/expenses");
  return { ok: true, message };
};

/** What text recognition found in a screenshot (run in the owner's browser). Never overwrites a corrected expense. */
export async function saveScreenshotReading(id: unknown, text: unknown): Promise<ActionResult> {
  const me = await owner();
  if (!me.ok) return me.result;
  const parsed = z.object({ id: z.uuid(), text: z.string().max(20_000) }).safeParse({ id, text });
  if (!parsed.success) return { ok: false, message: "That reading could not be saved." };
  const { data: e, error } = await me.db.from("expenses").select("edited, text_amount, amount_from, amount, category, verdict").eq("id", parsed.data.id).maybeSingle();
  if (error || !e) return dbError(error ?? { message: "not found" }, "save the screenshot reading");
  const r = readReceipt(parsed.data.text);
  const update: Record<string, unknown> = { read_text: parsed.data.text.slice(0, 4000), read_done: true, updated_at: new Date().toISOString() };
  if (!e.edited) {
    // Only a "payment done" screenshot counts; anything else (a QR code, a bill, a photo) is kept but not counted.
    const { amount, from } = e.amount_from === "typed" ? { amount: e.amount, from: "typed" } : pickAmount({ read: r.amount, text: e.text_amount });
    const category = e.category === "Other" && r.paidTo ? categoryFor(r.paidTo) : e.category;
    Object.assign(update, { read_amount: r.amount, paid_to: r.paidTo, reference: r.reference, amount, amount_from: from, category, verdict: r.payment ? "payment" : "not_payment" });
  }
  const { error: upErr } = await me.db.from("expenses").update(update).eq("id", parsed.data.id);
  if (upErr) return dbError(upErr, "save the screenshot reading");
  return { ok: true, message: "Read" };
}

const editSchema = z.object({
  id: z.uuid(),
  amount: z.number().min(0).max(100_000_000).nullable().optional(),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  reason: z.string().max(2000).nullable().optional(),
  status: z.enum(["new", "checked", "ignored"]).optional(),
  verdict: z.enum(["payment", "not_payment"]).optional(),
});

/** A correction from the owner: the amount, the type, the note, or checked / set aside. Fetching never undoes it. */
export async function updateExpense(input: unknown): Promise<ActionResult> {
  const me = await owner();
  if (!me.ok) return me.result;
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the amount and try again." };
  const { id, amount, category, reason, status, verdict } = parsed.data;
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (amount !== undefined) Object.assign(update, { amount, amount_from: amount === null ? null : "typed", edited: true });
  if (category !== undefined) Object.assign(update, { category, edited: true });
  if (reason !== undefined) Object.assign(update, { reason: reason?.trim() || null, edited: true });
  if (status !== undefined) update.status = status;
  if (verdict !== undefined) Object.assign(update, { verdict, edited: true });
  const { error } = await me.db.from("expenses").update(update).eq("id", id);
  if (error) return dbError(error, "save the expense");
  return done(verdict === "payment" ? "Counted as an expense" : verdict === "not_payment" ? "Not counted" : status === "checked" ? "Marked checked" : status === "ignored" ? "Set aside" : "Saved");
}

const addSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().positive().max(100_000_000),
  category: z.enum(EXPENSE_CATEGORIES),
  reason: z.string().trim().min(1).max(2000),
});

/** An expense not in the WhatsApp group (cash, say), added by hand. */
export async function addExpense(input: unknown): Promise<ActionResult> {
  const me = await owner();
  if (!me.ok) return me.result;
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Fill in the date, amount, type and what it was for." };
  const { day, amount, category, reason } = parsed.data;
  const { error } = await me.db.from("expenses").insert({
    spent_at: `${day}T12:00:00+05:30`,
    amount,
    amount_from: "typed",
    category,
    reason,
    status: "checked",
    verdict: "payment",
    edited: true,
    created_by: me.userId,
  });
  if (error) return dbError(error, "add the expense");
  return done("Expense added");
}

/** Deletes an expense added by hand (ones from WhatsApp are set aside instead, so a fetch does not bring them back). */
export async function deleteExpense(id: unknown): Promise<ActionResult> {
  const me = await owner();
  if (!me.ok) return me.result;
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return { ok: false, message: "Expense not found." };
  const { error } = await me.db.from("expenses").delete().eq("id", parsed.data).is("key", null);
  if (error) return dbError(error, "delete the expense");
  return done("Deleted");
}

/** Chooses which group holds the expenses, from the groups the linked WhatsApp is in. */
export async function chooseExpenseGroup(groupId: unknown): Promise<ActionResult> {
  const me = await owner();
  if (!me.ok) return me.result;
  const parsed = z.string().regex(/@g\.us$/).max(100).safeParse(groupId);
  if (!parsed.success) return { ok: false, message: "That group was not found." };
  const db = serverDb();
  if (!db) return { ok: false, message: "The server is missing its Supabase secret key." };
  const { data } = await db.from("whatsapp_state").select("groups").eq("id", true).maybeSingle();
  const group = ((data?.groups ?? []) as { id: string; name: string }[]).find((g) => g.id === parsed.data);
  if (!group) return { ok: false, message: "That group was not found. Link WhatsApp again." };
  const { error } = await db.from("whatsapp_state").update({ group_id: group.id, group_name: group.name, updated_at: new Date().toISOString() }).eq("id", true);
  if (error) return dbError(error, "choose the group");
  return done(`Following "${group.name}". Press Fetch from WhatsApp.`);
}
