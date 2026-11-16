import type { Metadata } from "next";
import { Suspense } from "react";
import { BusinessFrame, readBusinessTab } from "@/components/business/business-board";
import { DeadTab } from "@/components/business/dead-tab";
import { TargetsTab } from "@/components/business/targets-tab";
import { DeadWaiting, TargetsWaiting, WeekWaiting } from "@/components/business/waiting";
import { WeekTab } from "@/components/business/week-tab";
import { OwnerOnly } from "@/components/owner-only";
import { Part } from "@/components/part";
import { requireUser } from "@/lib/auth";
import { weekDays, weekFromParam, weekSentence } from "@/lib/business";
import { formatINR, todayIST } from "@/lib/format";
import { loadBusinessWeek, loadDeadStock, loadTargets } from "@/server/business-data";

export const metadata: Metadata = { title: "Business" };

const rs = (n: number) => formatINR(Math.round(n));

/**
 * The owner's Business page (graphite-spec 12.1): this week, targets and dead stock. Anyone else gets the owner-only
 * notice. Only the open tab's figures are asked for. The title and tabs show at once; the tab's cards fill in when its
 * figures arrive.
 */
export default async function BusinessPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  if (user.role !== "owner") return <OwnerOnly />;
  const sp = await searchParams;
  const tab = readBusinessTab(sp.tab);
  const today = todayIST();

  if (tab === "targets") {
    const targets = loadTargets();
    return (
      <BusinessFrame tab={tab} sub="This month against your monthly targets, from the same figures as the Dashboard.">
        <Suspense fallback={<TargetsWaiting />}>
          <Part data={targets}>{(t) => <TargetsTab months={t.pnl.months} today={today} sales={t.sales} profit={t.profit} />}</Part>
        </Suspense>
      </BusinessFrame>
    );
  }
  if (tab === "dead") {
    const dead = loadDeadStock();
    return (
      <BusinessFrame tab={tab} sub="Stock that is not selling, by its value at cost.">
        <Suspense fallback={<DeadWaiting />}>
          <Part data={dead}>{(d) => <DeadTab rows={d.rows} warehouses={d.warehouses} error={d.error} />}</Part>
        </Suspense>
      </BusinessFrame>
    );
  }
  const start = weekFromParam(typeof sp.start === "string" ? sp.start : null, today);
  const days = weekDays(start, today);
  const week = loadBusinessWeek(start, days);
  // The sentence under the title is worked out from the week's figures; until then the line is kept, blank.
  const sub = (
    <Suspense fallback={<span aria-hidden="true">&nbsp;</span>}>
      <Part data={week}>{(w) => (w.ready ? weekSentence(w.cur, w.prev, rs) : "The week against the week before.")}</Part>
    </Suspense>
  );
  return (
    <BusinessFrame tab={tab} sub={sub}>
      <Suspense fallback={<WeekWaiting />}>
        <Part data={week}>{(w) => <WeekTab start={start} days={days} today={today} cur={w.cur} prev={w.prev} ready={w.ready} />}</Part>
      </Suspense>
    </BusinessFrame>
  );
}
