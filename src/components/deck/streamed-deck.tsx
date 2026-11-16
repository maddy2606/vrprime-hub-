import { Suspense, type ReactNode } from "react";
import {
  DeckHeader,
  DispatchChart,
  FlowCard,
  HeadlineLines,
  Movers,
  OrdersPulse,
  OrdersQueue,
  PulseStats,
  StockByWarehouse,
  StockHealth,
  TodayStat,
  WorkQueue,
} from "@/components/deck/sections";
import { StatStrip } from "@/components/ui";
import type { DeckParts } from "@/server/deck-data";

// The Command Centre as it streams: the title, buttons and the work queue show at once; every other part shows when the
// answers it uses are in, behind the same skeleton blocks as the page's loading screen (PageSkeleton).

function LinesSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="skeleton mt-2 h-6 w-96 max-w-full" />
      <div className="skeleton mt-2 h-4 w-80 max-w-full" />
    </div>
  );
}

function KpiSkeleton() {
  return (
    <div className="sp-card kpi-card" aria-busy="true" aria-label="Loading">
      <div className="skeleton h-[46px] w-[46px] shrink-0 rounded-[13px]" />
      <div className="min-w-0 flex-1">
        <div className="skeleton h-3 w-24" />
        <div className="skeleton mt-2 h-6 w-16" />
        <div className="skeleton mt-2 h-3 w-28" />
      </div>
    </div>
  );
}

function CardSkeleton({ className = "", height = "h-56" }: { className?: string; height?: string }) {
  return (
    <div className={`sp-card g-pad ${className}`} aria-busy="true" aria-label="Loading">
      <div className="skeleton h-5 w-40" />
      <div className={`skeleton mt-4 w-full ${height}`} />
    </div>
  );
}

/** Waits for one part, then draws it. */
async function Part<T>({ data, children }: { data: Promise<T>; children: (value: T) => ReactNode }) {
  return children(await data);
}

export function StreamedDeck({ parts, push }: { parts: DeckParts; push?: ReactNode }) {
  const { meta } = parts;
  return (
    <div className="g-grid vr-stagger items-start">
      <DeckHeader push={push}>
        <Suspense fallback={<LinesSkeleton />}>
          <Part data={parts.head}>{(d) => <HeadlineLines d={d} />}</Part>
        </Suspense>
      </DeckHeader>
      <StatStrip ariaLabel="To dispatch today and today's signals" className="span-12">
        <Suspense fallback={<KpiSkeleton />}>
          <Part data={parts.todayCard}>{(d) => <TodayStat d={d} />}</Part>
        </Suspense>
        <Suspense
          fallback={
            <>
              <KpiSkeleton />
              <KpiSkeleton />
              <KpiSkeleton />
            </>
          }
        >
          <Part data={parts.pulses}>{(d) => <PulseStats d={d} />}</Part>
        </Suspense>
      </StatStrip>
      <Suspense fallback={<CardSkeleton className="span-8" />}>
        <Part data={parts.flow}>{(d) => <FlowCard d={d} />}</Part>
      </Suspense>
      <div className="span-4 flex min-w-0 flex-col gap-[14px]">
        <Suspense fallback={<CardSkeleton height="h-40" />}>
          <Part data={parts.orderQueue}>{(d) => <OrdersQueue d={d} />}</Part>
        </Suspense>
        <Suspense fallback={<CardSkeleton height="h-40" />}>
          <Part data={parts.todayCard}>{(d) => <OrdersPulse d={d} />}</Part>
        </Suspense>
      </div>
      <Suspense fallback={<CardSkeleton className="span-4" />}>
        <Part data={parts.workQueue}>{(d) => <WorkQueue d={{ queue: d.queue, kpis: { openTickets: d.openTickets } }} />}</Part>
      </Suspense>
      <Suspense fallback={<CardSkeleton className="span-4" />}>
        <Part data={parts.whStock}>{(d) => <StockByWarehouse d={d} />}</Part>
      </Suspense>
      <Suspense fallback={<CardSkeleton className="span-4" />}>
        <Part data={parts.stockHealth}>{(d) => <StockHealth d={{ ...d, today: meta.today }} />}</Part>
      </Suspense>
      <Suspense fallback={<CardSkeleton className="span-5" />}>
        <Part data={parts.dispatch}>{(d) => <DispatchChart d={d} />}</Part>
      </Suspense>
      <Suspense fallback={<CardSkeleton className="span-7" />}>
        <Part data={parts.movers}>{(d) => <Movers d={d} />}</Part>
      </Suspense>
    </div>
  );
}
