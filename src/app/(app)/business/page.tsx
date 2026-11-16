import type { Metadata } from "next";
import { BusinessFrame, readBusinessTab } from "@/components/business/business-board";
import { DeadTab } from "@/components/business/dead-tab";
import { TargetsTab } from "@/components/business/targets-tab";
import { WeekTab } from "@/components/business/week-tab";
import { OwnerOnly } from "@/components/owner-only";
import { requireUser } from "@/lib/auth";
import { weekDays, weekFromParam, weekSentence } from "@/lib/business";
import { formatINR, todayIST } from "@/lib/format";
import { loadBusinessWeek, loadDeadStock, loadTargets } from "@/server/business-data";

export const metadata: Metadata = { title: "Business" };

const rs = (n: number) => formatINR(Math.round(n));

/** The owner's Business page (graphite-spec 12.1): this week, targets and dead stock. Anyone else gets the owner-only notice. */
export default async function BusinessPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  if (user.role !== "owner") return <OwnerOnly />;
  const sp = await searchParams;
  const tab = readBusinessTab(sp.tab);
  const today = todayIST();

  if (tab === "targets") {
    const t = await loadTargets();
    return (
      <BusinessFrame tab={tab} sub="This month against your monthly targets, from the same figures as the Dashboard.">
        <TargetsTab months={t.pnl.months} today={today} sales={t.sales} profit={t.profit} />
      </BusinessFrame>
    );
  }
  if (tab === "dead") {
    const d = await loadDeadStock();
    return (
      <BusinessFrame tab={tab} sub="Stock that is not selling, by its value at cost.">
        <DeadTab rows={d.rows} warehouses={d.warehouses} error={d.error} />
      </BusinessFrame>
    );
  }
  const start = weekFromParam(typeof sp.start === "string" ? sp.start : null, today);
  const days = weekDays(start, today);
  const w = await loadBusinessWeek(start, days);
  return (
    <BusinessFrame tab={tab} sub={w.ready ? weekSentence(w.cur, w.prev, rs) : "The week against the week before."}>
      <WeekTab start={start} days={days} today={today} cur={w.cur} prev={w.prev} ready={w.ready} />
    </BusinessFrame>
  );
}
