import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PanelSkeleton } from "@/components/flipkart/panel-skeleton";
import { isTabKey, TabBar, tabsFor, type TabKey } from "@/components/flipkart/tab-bar";
import { PageTitle } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { HealthPanel, NeedsPanel, OrdersPanel, PricesPanel, ReturnsPanel, StockPanel } from "./panels";

export const metadata: Metadata = { title: "Flipkart" };

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

const SUB: Record<TabKey, string> = {
  needs: "What to look at today",
  orders: "Orders waiting to be dispatched, and cancellations",
  stock: "Flipkart stock across the warehouses",
  returns: "Returns and return rates",
  prices: "Selling prices, MRP and price changes",
  health: "Listings with problems to fix",
};

export default async function FlipkartPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const tabs = tabsFor(user.role);
  const requested = one(sp.tab);
  // A warehouse user asking for Prices or Listing health lands on the first tab.
  if (requested && (!isTabKey(requested) || !tabs.includes(requested))) redirect("/flipkart");
  const tab: TabKey = isTabKey(requested) ? requested : "needs";

  return (
    <>
      <PageTitle title="Flipkart" sub={user.role === "warehouse" ? `${SUB[tab]} at your warehouses` : SUB[tab]} />
      <TabBar tabs={tabs} active={tab} />
      {/* The title and tabs above are sent at once; each tab's numbers stream in behind a skeleton. */}
      <Suspense key={`${tab}|${JSON.stringify(sp)}`} fallback={<PanelSkeleton tab={tab} />}>
        {tab === "needs" ? <NeedsPanel user={user} /> : null}
        {tab === "orders" ? <OrdersPanel user={user} sp={sp} /> : null}
        {tab === "stock" ? <StockPanel user={user} sp={sp} /> : null}
        {tab === "returns" ? <ReturnsPanel user={user} /> : null}
        {tab === "prices" ? <PricesPanel /> : null}
        {tab === "health" ? <HealthPanel /> : null}
      </Suspense>
    </>
  );
}
