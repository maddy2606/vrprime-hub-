import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PnlBoard } from "@/components/pnl/pnl-board";
import { requireUser } from "@/lib/auth";
import { loadPnl } from "@/server/pnl-data";

export const metadata: Metadata = { title: "P&L" };

/** Profit and loss by month from Flipkart's reports and the synced orders, and the cost of every master SKU. Owner only. */
export default async function PnlPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  if (user.role !== "owner") notFound();
  const [d, sp] = await Promise.all([loadPnl(), searchParams]);
  const asked = typeof sp.month === "string" ? sp.month : null;
  return (
    <PnlBoard
      months={d.months}
      month={asked && d.months.some((m) => m.month === asked) ? asked : (d.months[0]?.month ?? null)}
      costing={d.costing}
      uploads={d.uploads}
      feePct={d.feePct}
      reportSkus={d.reportSkus}
      error={d.error}
    />
  );
}
