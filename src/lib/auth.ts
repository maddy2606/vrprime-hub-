import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { SessionUser } from "@/lib/types";

/** The signed-in user with their profile, or null. Read once per request. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return null;

  const [{ data: profile }, { data: links }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase.from("user_warehouses").select("warehouse_id").eq("user_id", userId),
  ]);
  if (!profile) return null;

  const email = typeof data.claims.email === "string" ? data.claims.email : null;
  return { ...profile, email, warehouseIds: (links ?? []).map((l) => l.warehouse_id) };
});

/** For pages inside the app: signed in, active, and past the first-login password change. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!user.active) redirect("/login?reason=inactive");
  if (user.must_change_password) redirect("/change-password");
  return user;
}

/** For server actions: returns null instead of redirecting. */
export async function getActiveUser(): Promise<SessionUser | null> {
  const user = await getSessionUser();
  if (!user || !user.active) return null;
  return user;
}

export function canManage(user: Pick<SessionUser, "role">): boolean {
  return user.role === "owner" || user.role === "manager";
}
