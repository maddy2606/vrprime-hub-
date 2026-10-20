import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardBoard } from "@/components/dashboard/board";
import { requireUser } from "@/lib/auth";
import { loadDashboard } from "@/server/dashboard-data";

export const metadata: Metadata = { title: "Dashboard" };

/** The owner's dashboard: money, orders, expenses and alerts together. Owner only (it shows profit). */
export default async function DashboardPage() {
  const user = await requireUser();
  if (user.role !== "owner") notFound();
  return <DashboardBoard d={await loadDashboard(user)} />;
}
