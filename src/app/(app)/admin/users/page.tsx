import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { UsersAdmin, type AdminUser } from "@/components/admin/users-admin";
import { EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { adminErrorMessage, createAdminClient, MISSING_SECRET_MESSAGE, secretKeyProblem } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage() {
  const me = await requireUser();
  if (me.role !== "owner") notFound();

  const keyProblem = secretKeyProblem();
  const admin = createAdminClient();
  if (keyProblem || !admin) {
    console.error("[admin/users] secret key problem:", keyProblem);
    return <EmptyState title="One setup step is missing" body={keyProblem ?? MISSING_SECRET_MESSAGE} />;
  }

  const supabase = await createClient();
  const [profiles, links, warehouses, authUsers] = await Promise.all([
    supabase.from("profiles").select("*").order("active", { ascending: false }).order("name"),
    supabase.from("user_warehouses").select("*"),
    supabase.from("warehouses").select("*").order("sort_order"),
    // Emails live in Supabase Auth, which only the service client can list.
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);
  // Log status and message only. The key itself is never logged.
  if (authUsers.error) {
    const { status, code, message } = authUsers.error;
    console.error("[admin/users] auth.admin.listUsers failed", { status, code, message });
    return <EmptyState title="Could not load users" body={adminErrorMessage({ status, code, message })} />;
  }
  for (const [name, result] of Object.entries({ profiles, links, warehouses })) {
    if (result.error) {
      const { code, message, details, hint } = result.error;
      console.error(`[admin/users] ${name} query failed`, { code, message, details, hint });
      return (
        <EmptyState
          title="Could not load users"
          body={`The database refused the ${name} list (${code || "error"}: ${message}). Try again, and tell the developer if it keeps happening.`}
        />
      );
    }
  }
  if (!profiles.data) throw new Error("Could not load users");

  const emailById = new Map(authUsers.data.users.map((u) => [u.id, u.email ?? ""]));
  const users: AdminUser[] = profiles.data.map((p) => ({
    id: p.id,
    name: p.name,
    email: emailById.get(p.id) ?? "",
    role: p.role,
    phone: p.phone,
    active: p.active,
    mustChangePassword: p.must_change_password,
    warehouseIds: (links.data ?? []).filter((l) => l.user_id === p.id).map((l) => l.warehouse_id),
  }));

  return <UsersAdmin users={users} warehouses={warehouses.data ?? []} meId={me.id} />;
}
