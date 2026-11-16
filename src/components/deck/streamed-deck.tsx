import { Suspense, type ReactNode } from "react";
import { Part } from "@/components/part";
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
import { CardLoader, StatStrip } from "@/components/ui";
import type { DeckParts } from "@/server/deck-data";

// The Command Centre as it streams: the title, buttons and the work queue show at once; every other part shows when the
// answers it uses are in. Until then each card shows the small gradient ring, centred, with no logo and no caption.

function LinesWaiting() {
  return <CardLoader label="Loading the headline…" className="mt-1 h-12 justify-start" />;
}

function KpiWaiting({ label }: { label: string }) {
  return (
    <div className="sp-card kpi-card justify-center">
      <CardLoader label={label} className="h-[46px]" />
    </div>
  );
}

function CardWaiting({ label, className = "", height = "h-64" }: { label: string; className?: string; height?: string }) {
  return (
    <div className={`sp-card g-pad ${className}`}>
      <CardLoader label={label} className={height} />
    </div>
  );
}

export function StreamedDeck({ parts, push }: { parts: DeckParts; push?: ReactNode }) {
  const { meta } = parts;
  return (
    <div className="g-grid vr-stagger items-start">
      <DeckHeader push={push}>
        <Suspense fallback={<LinesWaiting />}>
          <Part data={parts.head}>{(d) => <HeadlineLines d={d} />}</Part>
        </Suspense>
      </DeckHeader>
      <StatStrip ariaLabel="To dispatch today and today's signals" className="span-12">
        <Suspense fallback={<KpiWaiting label="Loading to dispatch today…" />}>
          <Part data={parts.todayCard}>{(d) => <TodayStat d={d} />}</Part>
        </Suspense>
        <Suspense
          fallback={
            <>
              <KpiWaiting label="Loading late dispatch…" />
              <KpiWaiting label="Loading out of stock…" />
              <KpiWaiting label="Loading due tomorrow…" />
            </>
          }
        >
          <Part data={parts.pulses}>{(d) => <PulseStats d={d} />}</Part>
        </Suspense>
      </StatStrip>
      <Suspense fallback={<CardWaiting label="Loading the order flow map…" className="span-8" />}>
        <Part data={parts.flow}>{(d) => <FlowCard d={d} />}</Part>
      </Suspense>
      <div className="span-4 flex min-w-0 flex-col gap-[14px]">
        <Suspense fallback={<CardWaiting label="Loading orders and stock…" height="h-40" />}>
          <Part data={parts.orderQueue}>{(d) => <OrdersQueue d={d} />}</Part>
        </Suspense>
        <Suspense fallback={<CardWaiting label="Loading the orders pulse…" height="h-40" />}>
          <Part data={parts.todayCard}>{(d) => <OrdersPulse d={d} />}</Part>
        </Suspense>
      </div>
      <Suspense fallback={<CardWaiting label="Loading work and tickets…" className="span-4" />}>
        <Part data={parts.workQueue}>{(d) => <WorkQueue d={{ queue: d.queue, kpis: { openTickets: d.openTickets } }} />}</Part>
      </Suspense>
      <Suspense fallback={<CardWaiting label="Loading stock by warehouse…" className="span-4" />}>
        <Part data={parts.whStock}>{(d) => <StockByWarehouse d={d} />}</Part>
      </Suspense>
      <Suspense fallback={<CardWaiting label="Loading stock health…" className="span-4" />}>
        <Part data={parts.stockHealth}>{(d) => <StockHealth d={{ ...d, today: meta.today }} />}</Part>
      </Suspense>
      <Suspense fallback={<CardWaiting label="Loading dispatches…" className="span-5" />}>
        <Part data={parts.dispatch}>{(d) => <DispatchChart d={d} />}</Part>
      </Suspense>
      <Suspense fallback={<CardWaiting label="Loading top movers…" className="span-7" />}>
        <Part data={parts.movers}>{(d) => <Movers d={d} />}</Part>
      </Suspense>
    </div>
  );
}
