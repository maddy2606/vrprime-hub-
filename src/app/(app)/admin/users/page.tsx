import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { UsersAdmin, type AdminUser } from "@/components/admin/users-admin";
import { EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { createAdminClient, MISSING_SECRET_MESSAGE } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage() {
  const me = await requireUser();
  if (me.role !== "owner") notFound();

  const admin = createAdminClient();
  if (!admin) return <EmptyState title="One setup step is missing" body={MISSING_SECRET_MESSAGE} />;

  const supabase = await createClient();
  const [profiles, links, warehouses, authUsers] = await Promise.all([
    supabase.from("profiles").select("*").order("active", { ascending: false }).order("name"),
    supabase.from("user_warehouses").select("*"),
    supabase.from("warehouses").select("*").order("sort_order"),
    // Emails live in Supabase Auth, which only the service client can list.
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);
  if (profiles.error || authUsers.error) throw new Error("Could not load users");

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
