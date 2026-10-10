import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ChangePasswordForm } from "@/components/auth/auth-forms";
import { getSessionUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Set your password" };

export default async function ChangePasswordPage() {
  const user = await getSessionUser();
  if (!user || !user.active) redirect("/login");

  return (
    <>
      <h1 className="text-xl font-extrabold tracking-tight">
        {user.must_change_password ? "Set your own password" : "Change password"}
      </h1>
      <p className="mb-4 mt-1 text-sm text-muted">
        {user.must_change_password
          ? `Welcome, ${user.name}. You signed in with a temporary password. Choose your own to continue.`
          : "Choose a new password for your account."}
      </p>
      <ChangePasswordForm />
    </>
  );
}
