"use server";

import { revalidatePath } from "next/cache";
import { getActiveUser } from "@/lib/auth";
import { logError } from "@/lib/redact";
import { adminErrorMessage, getAdmin } from "@/lib/supabase/admin";
import type { ActionResult } from "@/lib/types";
import { createUserSchema, fieldErrors, updateUserSchema } from "@/lib/validation";

// Every action here re-checks that the caller is an active owner before using
// the service client, which bypasses RLS.
async function ownerAdmin() {
  const fail = (message: string) => ({ error: { ok: false as const, message }, user: null, admin: null });
  const user = await getActiveUser();
  if (!user || user.role !== "owner") return fail("Only the owner can manage users.");
  const { admin, problem } = getAdmin();
  if (problem !== null) return fail(problem);
  return { error: null, user, admin };
}

export async function createUser(input: unknown): Promise<ActionResult> {
  const ctx = await ownerAdmin();
  if (ctx.error) return ctx.error;
  const { admin } = ctx;

  const parsed = createUserSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  }
  const v = parsed.data;

  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email: v.email,
    password: v.password,
    email_confirm: true,
  });
  if (authError || !created.user) {
    logError("admin createUser", authError);
    const exists = authError?.code === "email_exists";
    return {
      ok: false,
      message: exists
        ? "A user with this email already exists."
        : adminErrorMessage("create the user", authError ?? { message: "no details" }),
      fieldErrors: exists ? { email: "Already in use" } : undefined,
    };
  }
  const id = created.user.id;

  const { error: profileError } = await admin.from("profiles").upsert({
    id,
    name: v.name,
    role: v.role,
    phone: v.phone,
    active: true,
    must_change_password: true,
  });
  if (profileError) {
    logError("admin profile insert", profileError);
    // Do not leave a login behind that has no profile.
    await admin.auth.admin.deleteUser(id);
    return { ok: false, message: "Could not create the user. Try again." };
  }

  if (v.warehouseIds.length) {
    const { error } = await admin
      .from("user_warehouses")
      .insert(v.warehouseIds.map((warehouse_id) => ({ user_id: id, warehouse_id })));
    if (error) {
      logError("admin warehouse links", error);
      return { ok: false, message: `${v.name} was created, but warehouses were not saved. Edit the user to fix.` };
    }
  }

  revalidatePath("/admin/users");
  return { ok: true, message: `${v.name} added. Share the temporary password with them.` };
}

export async function updateUser(input: unknown): Promise<ActionResult> {
  const ctx = await ownerAdmin();
  if (ctx.error) return ctx.error;
  const { admin, user: me } = ctx;

  const parsed = updateUserSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  }
  const v = parsed.data;

  if (v.id === me.id && (v.role !== "owner" || !v.active)) {
    return { ok: false, message: "You cannot remove your own owner access or deactivate yourself." };
  }

  const { data: before } = await admin.from("profiles").select("active").eq("id", v.id).maybeSingle();
  if (!before) return { ok: false, message: "User not found." };

  if (v.newPassword) {
    const { error } = await admin.auth.admin.updateUserById(v.id, { password: v.newPassword });
    if (error) {
      logError("admin password reset", error);
      return { ok: false, message: "Could not set the new password." };
    }
  }

  // Deactivated users are also blocked at sign-in, so an old session cannot be refreshed.
  if (before.active !== v.active) {
    const { error } = await admin.auth.admin.updateUserById(v.id, {
      ban_duration: v.active ? "none" : "876000h",
    });
    if (error) logError("admin ban toggle", error);
  }

  const { error: profileError } = await admin
    .from("profiles")
    .update({
      name: v.name,
      role: v.role,
      phone: v.phone,
      active: v.active,
      ...(v.newPassword ? { must_change_password: true } : {}),
    })
    .eq("id", v.id);
  if (profileError) {
    logError("admin profile update", profileError);
    return { ok: false, message: "Could not save the user. Try again." };
  }

  const { error: clearError } = await admin.from("user_warehouses").delete().eq("user_id", v.id);
  const { error: linkError } = v.warehouseIds.length
    ? await admin
        .from("user_warehouses")
        .insert(v.warehouseIds.map((warehouse_id) => ({ user_id: v.id, warehouse_id })))
    : { error: null };
  if (clearError || linkError) {
    logError("admin warehouse links", clearError ?? linkError);
    return { ok: false, message: "Saved the user, but not their warehouses. Try again." };
  }

  revalidatePath("/admin/users");
  const note = !v.active && before.active ? " and deactivated" : v.active && !before.active ? " and reactivated" : "";
  return { ok: true, message: `${v.name} saved${note}` };
}
