"use server";

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { createAdminClient, MISSING_SECRET_MESSAGE } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";
import { changePasswordSchema, fieldErrors, loginSchema } from "@/lib/validation";

export async function signIn(input: unknown): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Check your email and password.", fieldErrors: fieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) {
    return { ok: false, message: "Wrong email or password." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("active")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!profile?.active) {
    await supabase.auth.signOut();
    return { ok: false, message: "This account is not active. Ask the owner to enable it." };
  }
  return { ok: true, message: "Signed in" };
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function changePassword(input: unknown): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user || !user.active) return { ok: false, message: "You are signed out. Sign in again." };

  const parsed = changePasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  }

  const admin = createAdminClient();
  if (!admin) return { ok: false, message: MISSING_SECRET_MESSAGE };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    const same = error.code === "same_password";
    return {
      ok: false,
      message: same
        ? "Choose a password different from the temporary one."
        : "Could not change the password. Try a longer one.",
    };
  }

  // Users cannot edit their own profile row (RLS), so the flag is cleared with the service client.
  const { error: flagError } = await admin
    .from("profiles")
    .update({ must_change_password: false })
    .eq("id", user.id);
  if (flagError) {
    console.error("[auth] could not clear must_change_password", flagError);
    return { ok: false, message: "Password changed, but the app could not finish. Try again." };
  }
  return { ok: true, message: "Password changed" };
}
