import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/auth-forms";
import { getSessionUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, sp] = await Promise.all([getSessionUser(), searchParams]);
  if (user?.active) redirect("/");

  const inactive = sp.reason === "inactive" || (user !== null && !user.active);
  return (
    <>
      <h1 className="mb-4 text-xl font-extrabold tracking-tight">Sign in</h1>
      <LoginForm notice={inactive ? "This account is not active. Ask the owner to enable it." : undefined} />
    </>
  );
}
