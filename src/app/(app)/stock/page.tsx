import type { Metadata } from "next";
import { StockDesk } from "@/components/stock/stock-desk";
import { SyncBar } from "@/components/stock/sync-bar";
import { EmptyState, PageTitle } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { isViewKey } from "@/lib/stock-views";
import { loadStockPage } from "@/server/stock-data";

export const metadata: Metadata = { title: "Stock" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const canSync = user.role === "owner" || user.role === "manager";
  const page = await loadStockPage(user, canSync);

  const sub =
    user.role === "warehouse" ? "Flipkart stock at your warehouses" : "Flipkart stock across the warehouses";

  if (page.kind === "empty") {
    return (
      <>
        <PageTitle title="Stock" sub={sub} />
        <SyncBar latest={page.latest} lastDone={null} snapshotDate={null} previousDate={null} canSync={canSync} />
        <EmptyState
          title="No stock numbers yet"
          body={
            canSync
              ? "Press Sync now to read stock from Flipkart. This needs FLIPKART_APP_ID and FLIPKART_APP_SECRET to be set in Supabase (Edge Functions > Secrets). After that it syncs by itself every day at 8:00 AM."
              : "Stock has not been synced from Flipkart yet. The owner or a manager needs to run the first sync."
          }
        />
      </>
    );
  }

  const view = one(sp.view);
  const wh = one(sp.wh);
  return (
    <>
      <PageTitle title="Stock" sub={sub} />
      <StockDesk
        data={page.data}
        latest={page.latest}
        lastDone={page.lastDone}
        canSync={canSync}
        initial={{
          view: isViewKey(view) ? view : "low",
          warehouseId: UUID.test(wh) ? wh : "",
          q: one(sp.q).slice(0, 100),
          hide: one(sp.hide) === "1",
        }}
      />
    </>
  );
}
