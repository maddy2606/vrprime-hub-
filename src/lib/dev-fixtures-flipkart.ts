// Obviously fake data for the Flipkart page in the local-only /dev/preview screen. Never used in production.
import {
  buildHealthRows,
  buildNeedsAction,
  buildPriceRows,
  buildReturnRates,
  computeCover,
  DEFAULT_FLIPKART_SETTINGS,
  readSalesRates,
  readStockDrops,
  soonestBySku,
  type PriceInput,
} from "@/lib/flipkart-analysis";
import { fakeDesk, FAKE_WAREHOUSES } from "@/lib/dev-fixtures";
import type { OrderSyncState, RunSummary } from "@/lib/orders-sync";
import type { ReturnLine, ReturnsPage, ReturnsSummary } from "@/lib/returns-view";
import { type CancelLine, type OrderLine, type OrdersViewResult, type PickRow, type SkuRow, type UpcomingRow, type WarehouseOrders } from "@/lib/orders-view";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function day(offset: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(Date.now() + offset * 86_400_000);
}

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

/** The cards: counts per warehouse in Seller Hub's tabs. */
export function fakeCards(): WarehouseOrders[] {
  return FAKE_WAREHOUSES.map((w, i) => ({
    warehouseId: w.id,
    name: w.name,
    to_accept: 20 + i * 7,
    to_pack: 4 + i,
    to_dispatch: 300 + i * 40,
    upcoming: 500 + i * 310,
    processing: i * 3,
    active: 324 + i * 48,
    inTransit: 1400 + i * 120,
    held: i === 1 ? 2 : 0,
    late: i === 0 ? 5 : i === 2 ? 12 : 0,
    today: i === 0 ? 3 : 0,
    tomorrow: 40 + i * 30,
    nextDue: hoursFromNow(i === 0 ? -30 : i === 1 ? 2 : 14),
  }));
}

const fakeSku = (n: number) => `FAKE-SKU-${String(n).padStart(4, "0")}`;

/** The first page of each list, shaped like what the database sends. */
export function fakeOrdersView(view: "sku" | "list" | "pick" | "upcoming" | "cancelled"): OrdersViewResult {
  const wh = FAKE_WAREHOUSES.map((w) => w.id);
  if (view === "sku") {
    const rows: SkuRow[] = Array.from({ length: 50 }, (_, k) => ({
      sku: k === 4 ? "FAKE-SKU-WITH-A-VERY-LONG-CODE-0005-EXTRA-LONG-PART" : fakeSku(k + 1),
      title: `Fake product number ${k + 1} with a fairly long title that has to wrap`,
      orders: 3 + (k % 9),
      units: 4 + (k % 11),
      due: hoursFromNow((k % 7) - 2),
      active_due: k % 5 === 4 ? null : hoursFromNow((k % 7) - 2),
      to_accept: k % 3,
      to_pack: k % 4,
      to_dispatch: 2 + (k % 6),
      upcoming: k % 5 === 0 ? 3 : 0,
      processing: k % 8 === 0 ? 1 : 0,
      by_wh: { [wh[k % 5]]: 2 + (k % 6), [wh[(k + 2) % 5]]: 1 + (k % 3) },
    }));
    return { view: "sku", total: 143, orders: 1748, units: 1778, rows };
  }
  if (view === "list") {
    const rows: OrderLine[] = Array.from({ length: 50 }, (_, k) => ({
      order_item_id: `FAKE-OI-${1000 + k}`,
      order_id: `FAKE-OD-${5000 + k}`,
      sku: fakeSku((k % 20) + 1),
      quantity: 1 + (k % 3),
      warehouse_id: wh[k % 5],
      bucket: (["to_accept", "to_pack", "to_dispatch", "to_dispatch", "upcoming"] as const)[k % 5],
      hold: k === 13,
      dispatch_by: hoursFromNow((k % 9) - 3),
      dispatch_after: hoursFromNow((k % 9) - 27),
    }));
    return { view: "list", total: 1748, rows };
  }
  if (view === "pick") {
    const rows: PickRow[] = Array.from({ length: 50 }, (_, k) => ({
      sku: fakeSku(k + 1),
      title: `Fake product number ${k + 1}`,
      units: 2 + (k % 14),
      to_accept: k % 5,
      to_pack: 2 + (k % 9),
      orders: 1 + (k % 8),
      due: hoursFromNow((k % 6) - 2),
      stock: k % 6 === 0 ? null : (k * 3) % 17,
    }));
    return { view: "pick", warehouseId: wh[0], total: 87, units: 612, rows };
  }
  if (view === "upcoming") {
    const rows: UpcomingRow[] = Array.from({ length: 50 }, (_, k) => {
      const upcoming = 3 + (k % 12);
      const stock = k % 7 === 0 ? null : (k * 5) % 19;
      return {
        sku: fakeSku(k + 1),
        title: `Fake product number ${k + 1}`,
        warehouse_id: wh[k % 5],
        upcoming,
        orders: 1 + (k % 6),
        first_active: hoursFromNow(6 + k * 3),
        active: k % 9,
        stock,
        short: stock === null ? 0 : Math.max(0, upcoming - stock),
      };
    });
    return { view: "upcoming", total: 385, shortCount: 23, rows };
  }
  const rows: CancelLine[] = Array.from({ length: 50 }, (_, k) => ({
    order_item_id: `FAKE-CX-${k}`,
    order_id: `FAKE-OD-${4000 + k}`,
    sku: fakeSku((k % 9) + 1),
    quantity: 1,
    warehouse_id: wh[k % 5],
    cancel_type: k % 4 === 0 ? "seller" : "buyer",
    cancelled_at: hoursFromNow(-(k * 9 + 3)),
    cancel_reason: k % 4 === 0 ? "seller_cancellation" : "buyer_cancellation",
    cancel_sub_reason: k % 4 === 0 ? "order_over_sla" : null,
  }));
  return {
    view: "cancelled",
    total: 2693,
    rows,
    summary: { seller_total: 23, buyer_total: 2670, days: Array.from({ length: 14 }, (_, d) => ({ day: day(-d), seller: d % 4 === 0 ? 3 : 0, buyer: 150 + d * 7 })) },
  };
}


export function fakeReturnsPage(): { page: ReturnsPage; summary: ReturnsSummary } {
  const rows: ReturnLine[] = Array.from({ length: 30 }, (_, k) => ({
    return_id: `FAKE-R-${k}`,
    order_item_id: `FAKE-OI-R${k}`,
    order_id: `FAKE-OD-${3000 + k}`,
    sku: k % 8 === 0 ? null : `FAKE-SKU-${String((k % 6) + 1).padStart(4, "0")}`,
    quantity: 1 + (k % 2),
    warehouse_id: FAKE_WAREHOUSES[k % 5].id,
    source: k % 3 === 0 ? "courier_return" : "customer_return",
    return_status: k % 2 ? "created" : "completed",
    reason: ["WRONG_ITEM_RECEIVED", "DAMAGED", "NOT_AS_DESCRIBED", "NO_LONGER_NEEDED"][k % 4],
    sub_reason: k % 4 === 0 ? "DIFFERENT_PRODUCT" : null,
    created_date: day(-(k % 28)),
  }));
  return { page: { total: 5831, rows }, summary: { courier_units: 3967, customer_units: 1972, courier_lines: 3859, customer_lines: 1972 } };
}

export function fakeReturnRates(ready: boolean) {
  const rows = Array.from({ length: 12 }, (_, k) => ({ sku: `FAKE-SKU-${String(k + 1).padStart(4, "0")}`, sold: 20 + k * 11, returned: (k * 7) % 13 }));
  return buildReturnRates(rows, DEFAULT_FLIPKART_SETTINGS, ready);
}

export function fakePriceRows() {
  const inputs: PriceInput[] = Array.from({ length: 30 }, (_, k) => {
    const mrp = 400 + k * 25;
    const selling = k === 3 ? mrp + 10 : k === 7 ? null : k === 9 ? mrp : Math.round(mrp * 0.7);
    const dropped = k === 5;
    return {
      sku: `FAKE-SKU-${String(k + 1).padStart(4, "0")}`,
      title: `Fake Test Product ${k + 1}`,
      status: k % 11 === 10 ? "INACTIVE" : "ACTIVE",
      mrp,
      sellingPrice: dropped ? Math.round(mrp * 0.4) : selling,
      changes: dropped
        ? [{ date: day(0), oldMrp: mrp, newMrp: mrp, oldSelling: Math.round(mrp * 0.7), newSelling: Math.round(mrp * 0.4) }]
        : k % 4 === 0
          ? [
              { date: day(-3), oldMrp: mrp, newMrp: mrp, oldSelling: Math.round(mrp * 0.75), newSelling: Math.round(mrp * 0.7) },
              { date: day(-20), oldMrp: mrp - 20, newMrp: mrp, oldSelling: Math.round(mrp * 0.7), newSelling: Math.round(mrp * 0.75) },
            ]
          : [],
    };
  });
  return buildPriceRows(inputs, DEFAULT_FLIPKART_SETTINGS, day(0));
}

export function fakeHealthRows() {
  const box = { dimensions: { length: 10, breadth: 5, height: 2 }, weight: 0.4 };
  const listings = Array.from({ length: 30 }, (_, k) => ({
    sku: k === 4 ? " FAKE-SPACE-SKU" : k === 6 ? "FAKE-TRAILING " : `FAKE-SKU-${String(k + 1).padStart(4, "0")}`,
    title: `Fake Test Product ${k + 1}`,
    status: k % 13 === 12 ? "INACTIVE" : "ACTIVE",
    packages: k % 5 === 0 ? [] : k % 7 === 0 ? [{ dimensions: { length: 10, breadth: 5, height: 2 }, weight: 0 }] : [box],
    fulfillment: { dispatch_sla: k % 6 === 0 ? 4 : 1 },
    hsn: k % 9 === 0 ? null : "33012400",
    taxCode: k % 9 === 0 ? null : "GST_5",
    taxRead: true,
  }));
  return { rows: buildHealthRows(listings, DEFAULT_FLIPKART_SETTINGS), total: listings.length };
}

const fakeRun = (kind: RunSummary["kind"], over: Partial<RunSummary> = {}): RunSummary => ({
  id: id(6000),
  kind,
  status: "done",
  trigger: "cron",
  step: 25,
  parts: 25,
  pages: 40,
  coverageFrom: null,
  createdAt: hoursFromNow(-1),
  finishedAt: hoursFromNow(-0.9),
  error: null,
  ...over,
});

export function fakeOrderSync(stage: "ok" | "running" | "failed" | "nobackfill" = "ok"): OrderSyncState {
  const pending = fakeRun("pending");
  return {
    latest:
      stage === "running"
        ? fakeRun("pending", { status: "running", step: 8, finishedAt: null })
        : stage === "failed"
          ? fakeRun("pending", { status: "failed", error: "Flipkart kept failing after 6 tries (HTTP 500)", finishedAt: hoursFromNow(-0.1), createdAt: hoursFromNow(-0.2) })
          : pending,
    lastPending: pending,
    lastDaily: fakeRun("daily", { createdAt: hoursFromNow(-5), finishedAt: hoursFromNow(-4.9) }),
    lastUpcoming: fakeRun("upcoming", { parts: 74, step: 74, createdAt: hoursFromNow(-14), finishedAt: hoursFromNow(-13.5) }),
    backfill: stage === "nobackfill" ? null : fakeRun("backfill", { status: "paused", coverageFrom: day(-11), finishedAt: null }),
  };
}

/** Everything the "Needs action" tab shows, built from the fake stock and orders. */
export function fakeNeedsAction() {
  const desk = fakeDesk();
  const warehouses = desk.warehouses;
  const sales = readSalesRates({
    coverage_from: day(-20),
    rows: desk.listings.slice(0, 25).flatMap((l, k) => warehouses.map((w) => ({ sku: l.sku, wid: w.id, u7: 7 + ((k * 13) % 90), u14: 14 + ((k * 17) % 120) }))),
  });
  const units = desk.listings.flatMap((l) => (l.status === "ACTIVE" ? warehouses.flatMap((w, i) => ((l.now[i] ?? 0) > 0 ? [{ sku: l.sku, warehouseId: w.id, units: l.now[i] as number }] : [])) : []));
  const { covers, state } = computeCover({ units, sales, drops: readStockDrops(null), today: desk.today });
  const sections = buildNeedsAction(
    {
      now: new Date(),
      staff: true,
      warehouses,
      cards: fakeCards(),
      settings: { ...DEFAULT_FLIPKART_SETTINGS, newInactiveDays: 2 },
      priceRows: fakePriceRows(),
      returnRates: fakeReturnRates(true),
      covers,
      newInactive: desk.listings.filter((l) => l.status === "INACTIVE" && !l.beforeTracking).slice(0, 3),
    },
    { sellerHubOrders: "https://seller.flipkart.com/", sellerHubListings: "https://seller.flipkart.com/" },
  );
  return { sections, covers, state, soonest: soonestBySku(covers), desk };
}
