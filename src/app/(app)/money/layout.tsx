import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth";
import { isMoneyEnabled } from "@/server/money-flag";

// Money is owner only and switched off until an owner turns it on in Settings. Checked here, before any of the page is
// sent, so every /money address answers "not found" (a real 404) while it is off.
export default async function MoneyLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  if (user.role !== "owner" || !(await isMoneyEnabled())) notFound();
  return children;
}
