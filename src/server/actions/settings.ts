"use server";

import { revalidatePath } from "next/cache";
import { getActiveUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";
import { fieldErrors, settingsSchema } from "@/lib/validation";
import { dbError, NOT_SIGNED_IN } from "@/server/action-helpers";

/** The thresholds on the Stock page. Owner only; the database checks that too. */
export async function saveSettings(input: unknown): Promise<ActionResult> {
  const user = await getActiveUser();
  if (!user) return NOT_SIGNED_IN;
  if (user.role !== "owner") return { ok: false, message: "Only the owner can change settings." };

  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  for (const [key, value] of Object.entries(parsed.data)) {
    const { data, error } = await supabase
      .from("app_settings")
      .update({ value, updated_at: new Date().toISOString(), updated_by: user.id })
      .eq("key", key)
      .select("key");
    if (error) return dbError(error, "save the settings");
    if (!data.length) return { ok: false, message: "That setting does not exist. Ask the developer." };
  }

  revalidatePath("/", "layout");
  return { ok: true, message: "Settings saved" };
}
