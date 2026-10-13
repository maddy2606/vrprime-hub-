import { HealthTab } from "@/components/flipkart/health-tab";
import { NeedsAction } from "@/components/flipkart/needs-action";
import { OrdersTab } from "@/components/flipkart/orders-tab";
import { PricesTab } from "@/components/flipkart/prices-tab";
import { ReturnsTab } from "@/components/flipkart/returns-tab";
import { StockDesk } from "@/components/stock/stock-desk";
import { SyncBar } from "@/components/stock/sync-bar";
import { EmptyState } from "@/components/ui";
import { buildNeedsAction } from "@/lib/flipkart-analysis";
import { defaultQuery, ordersQuerySchema, readCards, type OrdersQuery } from "@/lib/orders-view";
import { defaultStockQuery, stockQuerySchema } from "@/lib/stock-view";
import { formatDate, todayIST } from "@/lib/format";
import { SELLER_HUB } from "@/lib/seller-hub";
import { isViewKey } from "@/lib/stock-views";
import { createClient } from "@/lib/supabase/server";
import type { SessionUser } from "@/lib/types";
import {
  canSeePrices,
  canSyncOrders,
  latestSnapshotDate,
  loadCover,
  loadEmpties,
  loadNewInactive,
  loadFlipkartSettings,
  loadHealthRows,
  loadInTransit,
  loadOrderSyncState,
  loadPriceRows,
  loadReturnRates,
  loadReturns,
  warehousesFor,
} from "@/server/flipkart-data";
import { loadOrderCounts, loadOrdersView, pickWarehouseOf } from "@/server/orders-view";
import { loadStockDesk } from "@/server/stock-view";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Search = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

// --- Needs action --------------------------------------------------------------------------------------------

export async function NeedsPanel({ user }: { user: SessionUser }) {
  const supabase = await createClient();
  const staff = canSeePrices(user);
  const now = new Date();
  const today = todayIST(now);

  // Everything here is a small answer from the database (counts, a short list, a few SKUs), asked together:
  // the page no longer reads the whole stock snapshot or every pending order to work this out.
  const [settings, snapshotDate, warehouses, counts, empties, cover] = await Promise.all([
    loadFlipkartSettings(supabase),
    latestSnapshotDate(supabase),
    warehousesFor(user),
    loadOrderCounts(supabase),
    loadEmpties(supabase),
    loadCover(supabase, today),
  ]);
  const [priceRows, newInactive, returns] = await Promise.all([
    staff && snapshotDate ? loadPriceRows(supabase, snapshotDate, settings, false) : Promise.resolve([]),
    staff ? loadNewInactive(supabase, today, settings.newInactiveDays) : Promise.resolve([]),
    loadReturnRates(supabase, settings, today, cover.coverageFrom),
  ]);

  const cards = readCards(counts, warehouses);
  const sections = buildNeedsAction(
    { now, staff, warehouses, cards, empties, settings, priceRows, returnRates: returns.rates, covers: cover.covers, newInactive },
    { sellerHubOrders: SELLER_HUB.orders, sellerHubListings: SELLER_HUB.listings },
  );

  const notes: string[] = [];
  if (!snapshotDate) notes.push("Stock has not been read from Flipkart yet, so stock warnings are not shown. Run a sync on the Stock tab.");
  if (cover.state.state === "collecting") {
    notes.push(`Running out soon: collecting data${cover.state.readyOn ? `, ready on ${formatDate(cover.state.readyOn, today)}` : ""}. It needs 7 days of stock history or of shipped orders.`);
  }
  if (!returns.historyReady) notes.push("High return rate: needs 30 days of shipped orders. They are being loaded at night; the rate appears once they are in.");
  if (cards.every((c) => c.active + c.upcoming + c.processing === 0)) notes.push("No pending orders are saved yet. Orders are read from Flipkart every 30 minutes from 7 AM to 10 PM.");

  return <NeedsAction sections={sections} notes={notes} asOf={{ stock: snapshotDate, today }} />;
}

// --- Orders ----------------------------------------------------------------------------------------------------

export async function OrdersPanel({ user, sp }: { user: SessionUser; sp: Search }) {
  const supabase = await createClient();
  const canSync = canSyncOrders(user);
  const now = new Date();
  const today = todayIST(now);

  const wh = one(sp.wh);
  const view = one(sp.view);
  const status = one(sp.status);
  const asked = ordersQuerySchema.safeParse({ ...defaultQuery("sku"), view: view || "sku", status: status || "active", wh: UUID.test(wh) ? wh : "" });
  const query: OrdersQuery = asked.success ? defaultQuery(asked.data.view, { status: asked.data.status, wh: asked.data.wh }) : defaultQuery("sku");

  // The cards and the first page of the list the address asks for are read together; only the pick list has to
  // wait for the cards (it opens on the first warehouse that has something to pack).
  const [counts, state, warehouses, inTransit] = await Promise.all([loadOrderCounts(supabase), loadOrderSyncState(supabase, canSync), warehousesFor(user), loadInTransit(supabase)]);
  const cards = readCards(counts, warehouses, inTransit);
  const initialData = await loadOrdersView(supabase, query, pickWarehouseOf(query.wh, cards, warehouses));
  return <OrdersTab cards={cards} warehouses={warehouses} state={state} canSync={canSync} today={today} nowIso={now.toISOString()} initialQuery={query} initialData={initialData} />;
}

// --- Stock -----------------------------------------------------------------------------------------------------

export async function StockPanel({ user, sp }: { user: SessionUser; sp: Search }) {
  const canSync = canSyncOrders(user);
  const view = one(sp.view);
  const wh = one(sp.wh);
  const asked = stockQuerySchema.safeParse({
    ...defaultStockQuery(isViewKey(view) ? view : "low"),
    wh: UUID.test(wh) ? wh : "",
    hide: one(sp.hide) === "1",
    q: one(sp.q).slice(0, 100),
  });
  const query = asked.success ? asked.data : defaultStockQuery("low");
  const desk = await loadStockDesk(user, query);

  if (desk.kind === "empty") {
    return (
      <>
        <SyncBar latest={desk.page.latest} lastDone={null} snapshotDate={null} previousDate={null} canSync={canSync} />
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

  return (
    <StockDesk
      meta={desk.meta}
      initialQuery={query}
      initialData={desk.view}
      latest={desk.page.latest}
      lastDone={desk.page.lastDone}
      canSync={canSync}
      cover={{ state: desk.cover.state, limit: desk.coverLimit, warehouseNames: Object.fromEntries(desk.meta.warehouses.map((w) => [w.id, w.name])) }}
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
