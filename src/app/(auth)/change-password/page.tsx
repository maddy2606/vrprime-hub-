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
      <h1 className="t-card-title">
        {user.must_change_password ? "Set your own password" : "Change password"}
      </h1>
      <p className="t-caption mb-4 mt-1">
        {user.must_change_password
          ? `Welcome, ${user.name}. You signed in with a temporary password. Choose your own to continue.`
          : "Choose a new password for your account."}
      </p>
      <ChangePasswordForm />
    </>
  );
}
