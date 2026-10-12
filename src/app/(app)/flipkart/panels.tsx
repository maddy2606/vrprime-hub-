import { HealthTab } from "@/components/flipkart/health-tab";
import { NeedsAction } from "@/components/flipkart/needs-action";
import { OrdersTab } from "@/components/flipkart/orders-tab";
import { PricesTab } from "@/components/flipkart/prices-tab";
import { ReturnsTab } from "@/components/flipkart/returns-tab";
import { StockDesk } from "@/components/stock/stock-desk";
import { SyncBar } from "@/components/stock/sync-bar";
import { EmptyState } from "@/components/ui";
import { buildNeedsAction, ORDER_VIEWS, STATUS_FILTERS, type OrderView, type StatusFilter } from "@/lib/flipkart-analysis";
import { formatDate, todayIST } from "@/lib/format";
import { SELLER_HUB } from "@/lib/seller-hub";
import { analyze } from "@/lib/stock-analysis";
import { isViewKey } from "@/lib/stock-views";
import { createClient } from "@/lib/supabase/server";
import type { SessionUser } from "@/lib/types";
import {
  canSeePrices,
  canSyncOrders,
  latestSnapshotDate,
  loadCancellations,
  loadCover,
  loadFlipkartSettings,
  loadHealthRows,
  loadInTransit,
  loadOrderSyncState,
  loadPendingOrders,
  loadPriceRows,
  loadReturnRates,
  loadReturns,
  stockBySku,
  warehousesFor,
} from "@/server/flipkart-data";
import { loadStockPage } from "@/server/stock-data";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Search = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

// --- Needs action --------------------------------------------------------------------------------------------

export async function NeedsPanel({ user }: { user: SessionUser }) {
  const supabase = await createClient();
  const canSync = canSyncOrders(user);
  const staff = canSeePrices(user);
  const now = new Date();
  const today = todayIST(now);

  const [settings, stock, orders, warehouses] = await Promise.all([
    loadFlipkartSettings(supabase),
    loadStockPage(user, canSync),
    loadPendingOrders(supabase),
    warehousesFor(user),
  ]);
  const data = stock.kind === "ready" ? stock.data : null;
  const snapshotDate = data?.snapshotDate ?? null;

  const [priceRows, returns, cover] = await Promise.all([
    staff && snapshotDate ? loadPriceRows(supabase, snapshotDate, settings, false) : Promise.resolve([]),
    loadReturnRates(supabase, settings, today),
    data ? loadCover(supabase, data) : Promise.resolve(null),
  ]);

  const analysis = data ? analyze(data, data.warehouses.map((_, i) => i), false) : null;
  const sections = buildNeedsAction(
    {
      now,
      staff,
      warehouses: data?.warehouses ?? warehouses,
      orders,
      listings: data?.listings ?? [],
      settings: { ...settings, newInactiveDays: data?.settings.newInactiveDays ?? 2 },
      priceRows,
      returnRates: returns.rates,
      covers: cover?.covers ?? [],
      newInactive: analysis?.newInactive ?? [],
    },
    { sellerHubOrders: SELLER_HUB.orders, sellerHubListings: SELLER_HUB.listings },
  );

  const notes: string[] = [];
  if (!data) notes.push("Stock has not been read from Flipkart yet, so stock warnings are not shown. Run a sync on the Stock tab.");
  if (cover?.state.state === "collecting") {
    notes.push(`Running out soon: collecting data${cover.state.readyOn ? `, ready on ${formatDate(cover.state.readyOn, today)}` : ""}. It needs 7 days of stock history or of shipped orders.`);
  }
  if (!returns.historyReady) notes.push("High return rate: needs 30 days of shipped orders. They are being loaded at night; the rate appears once they are in.");
  if (orders.length === 0) notes.push("No pending orders are saved yet. Orders are read from Flipkart every 30 minutes from 7 AM to 10 PM.");

  return <NeedsAction sections={sections} notes={notes} asOf={{ stock: snapshotDate, today }} />;
}

// --- Orders ----------------------------------------------------------------------------------------------------

export async function OrdersPanel({ user, sp }: { user: SessionUser; sp: Search }) {
  const supabase = await createClient();
  const canSync = canSyncOrders(user);
  const now = new Date();
  const today = todayIST(now);
  const [orders, cancellations, state, warehouses, inTransit, stock] = await Promise.all([
    loadPendingOrders(supabase),
    loadCancellations(supabase, today),
    loadOrderSyncState(supabase, canSync),
    warehousesFor(user),
    loadInTransit(supabase),
    loadStockPage(user, canSync),
  ]);
  const wh = one(sp.wh);
  const view = one(sp.view);
  const status = one(sp.status);
  return (
    <OrdersTab
      orders={orders}
      cancellations={cancellations}
      warehouses={warehouses}
      state={state}
      canSync={canSync}
      today={today}
      nowIso={now.toISOString()}
      stock={stockBySku(stock.kind === "ready" ? stock.data : null)}
      inTransit={inTransit}
      initial={{
        warehouseId: UUID.test(wh) && warehouses.some((w) => w.id === wh) ? wh : "",
        view: (ORDER_VIEWS as readonly string[]).includes(view) ? (view as OrderView) : "sku",
        status: (STATUS_FILTERS as string[]).includes(status) ? (status as StatusFilter) : "active",
      }}
    />
  );
}

// --- Stock -----------------------------------------------------------------------------------------------------

export async function StockPanel({ user, sp }: { user: SessionUser; sp: Search }) {
  const canSync = canSyncOrders(user);
  const supabase = await createClient();
  const page = await loadStockPage(user, canSync);

  if (page.kind === "empty") {
    return (
      <>
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

  const [settings, cover] = await Promise.all([loadFlipkartSettings(supabase), loadCover(supabase, page.data)]);
  const view = one(sp.view);
  const wh = one(sp.wh);
  return (
    <StockDesk
      data={page.data}
      latest={page.latest}
      lastDone={page.lastDone}
      canSync={canSync}
      initial={{ view: isViewKey(view) ? view : "low", warehouseId: UUID.test(wh) ? wh : "", q: one(sp.q).slice(0, 100), hide: one(sp.hide) === "1" }}
      cover={{
        soonest: cover.soonest,
        state: cover.state,
        limit: settings.runningOutDays,
        warehouseNames: Object.fromEntries(page.data.warehouses.map((w) => [w.id, w.name])),
      }}
    />
  );
}

// --- Returns ---------------------------------------------------------------------------------------------------

export async function ReturnsPanel({ user }: { user: SessionUser }) {
  const supabase = await createClient();
  const canSync = canSyncOrders(user);
  const today = todayIST();
  const settings = await loadFlipkartSettings(supabase);
  const [returns, rates, state, warehouses] = await Promise.all([
    loadReturns(supabase, today),
    loadReturnRates(supabase, settings, today),
    loadOrderSyncState(supabase, canSync),
    warehousesFor(user),
  ]);
  return <ReturnsTab returns={returns} rates={rates.rates} historyReady={rates.historyReady} rateLimit={settings.returnRatePercent} warehouses={warehouses} state={state} canSync={canSync} today={today} />;
}

// --- Prices and listing health ----------------------------------------------------------------------------------

export async function PricesPanel() {
  const supabase = await createClient();
  const [settings, snapshotDate] = await Promise.all([loadFlipkartSettings(supabase), latestSnapshotDate(supabase)]);
  if (!snapshotDate) {
    return <EmptyState title="No prices yet" body="Prices are read with the stock sync. Run a sync on the Stock tab first." />;
  }
  const rows = await loadPriceRows(supabase, snapshotDate, settings, true);
  return <PricesTab rows={rows} today={todayIST()} dropLimit={settings.priceDropPercent} snapshotDate={snapshotDate} />;
}

export async function HealthPanel() {
  const supabase = await createClient();
  const settings = await loadFlipkartSettings(supabase);
  const { rows, total, taxUnread } = await loadHealthRows(supabase, settings);
  if (total === 0) return <EmptyState title="No listings yet" body="Listings are read with the stock sync. Run a sync on the Stock tab first." />;
  return <HealthTab rows={rows} total={total} taxUnread={taxUnread} slaLimit={settings.dispatchSlaDays} />;
}
