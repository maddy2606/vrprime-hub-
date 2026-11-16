import type { Metadata } from "next";
import { ClosingReport } from "@/components/reports/closing-report";
import { requireUser } from "@/lib/auth";
import { closingDay } from "@/lib/closing-report";
import { todayIST } from "@/lib/format";
import { loadClosingReport } from "@/server/closing-report";

export const metadata: Metadata = { title: "Closing report" };

/** The day's closing report, every role; a warehouse user sees only their warehouses (RLS). */
export default async function ClosingReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const today = todayIST();
  const day = closingDay(typeof sp.day === "string" ? sp.day : null, today);
  const d = await loadClosingReport(day);
  return <ClosingReport day={day} today={today} rows={d.rows} ready={d.ready} />;
}
