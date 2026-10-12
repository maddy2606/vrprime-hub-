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
  type PendingOrder,
  type PriceInput,
  type StockBySku,
} from "@/lib/flipkart-analysis";
import { fakeDesk, FAKE_WAREHOUSES } from "@/lib/dev-fixtures";
import type { OrderSyncState, RunSummary } from "@/lib/orders-sync";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function day(offset: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(Date.now() + offset * 86_400_000);
}

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

export function fakeOrders(): PendingOrder[] {
  const statuses = ["APPROVED", "APPROVED", "PACKING_IN_PROGRESS", "PACKED", "READY_TO_DISPATCH"];
  const due = [-5, -1, 1, 2, 3, 9, 14, 30, 50, 120, 200];
  return Array.from({ length: 60 }, (_, k) => ({
    orderItemId: `FAKE-OI-${1000 + k}`,
    orderId: `FAKE-OD-${5000 + Math.floor(k / 1.3)}`,
    shipmentId: `FAKE-SH-${5000 + Math.floor(k / 1.3)}`,
    sku: k % 7 === 0 ? "FAKE-SKU-0011" : `FAKE-SKU-${String((k % 20) + 1).padStart(4, "0")}`,
    quantity: 1 + (k % 3),
    warehouseId: FAKE_WAREHOUSES[k % 5].id,
    status: statuses[k % 5],
    hold: k === 13,
    dispatchBy: hoursFromNow(due[k % due.length]),
    // The far-off ones are Upcoming: dispatch-after still in the future.
    dispatchAfter: hoursFromNow(due[k % due.length] - 24),
  }));
}

/** Fake stock per SKU: some warehouses short of what is ordered there. */
export function fakeStockBySku(): StockBySku {
  const out: StockBySku = {};
  for (let n = 1; n <= 20; n++) {
    const sku = `FAKE-SKU-${String(n).padStart(4, "0")}`;
    out[sku] = { title: `Fake product number ${n}`, units: Object.fromEntries(FAKE_WAREHOUSES.map((w, i) => [w.id, (n * 7 + i * 3) % 9 === 0 ? 0 : ((n * 13 + i * 5) % 40)])) };
  }
  return out;
}

export function fakeInTransit(): Record<string, number> {
  return Object.fromEntries(FAKE_WAREHOUSES.map((w, i) => [w.id, 40 + i * 17]));
}

export function fakeCancellations() {
  return Array.from({ length: 16 }, (_, k) => ({
    orderItemId: `FAKE-CX-${k}`,
    orderId: `FAKE-OD-${4000 + k}`,
    sku: `FAKE-SKU-${String((k % 9) + 1).padStart(4, "0")}`,
    quantity: 1,
    warehouseId: FAKE_WAREHOUSES[k % 5].id,
    type: (k % 4 === 0 ? "seller" : "buyer") as "seller" | "buyer",
    cancelledAt: hoursFromNow(-(k * 9 + 3)),
    reason: k % 4 === 0 ? "seller_cancellation" : "buyer_cancellation",
    subReason: k % 4 === 0 ? "order_over_sla" : null,
  }));
}

export function fakeReturns() {
  return Array.from({ length: 25 }, (_, k) => ({
    returnId: `FAKE-R-${k}`,
    orderItemId: `FAKE-OI-R${k}`,
    orderId: `FAKE-OD-${3000 + k}`,
    sku: k % 8 === 0 ? null : `FAKE-SKU-${String((k % 6) + 1).padStart(4, "0")}`,
    quantity: 1 + (k % 2),
    warehouseId: FAKE_WAREHOUSES[k % 5].id,
    source: (k % 3 === 0 ? "courier_return" : "customer_return") as "courier_return" | "customer_return",
    status: k % 2 ? "created" : "completed",
    reason: ["WRONG_ITEM_RECEIVED", "DAMAGED", "NOT_AS_DESCRIBED", "NO_LONGER_NEEDED"][k % 4],
    subReason: k % 4 === 0 ? "DIFFERENT_PRODUCT" : null,
    createdDate: day(-(k % 28)),
  }));
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
  const { covers, state } = computeCover({ listings: desk.listings, warehouses, sales, drops: readStockDrops(null), today: desk.today });
  const sections = buildNeedsAction(
    {
      now: new Date(),
      staff: true,
      warehouses,
      orders: fakeOrders(),
      listings: desk.listings,
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
