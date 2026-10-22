// The Stock-outs tab: what changed at each warehouse between the last two good stock reads, and nothing else.
// Pure functions: no database, no React.
//
//  - "Stocked out" = had units at that warehouse in the read before, 0 in the latest read.
//  - "Back in stock" = 0 at that warehouse in the read before, units in the latest read.
// A warehouse where the SKU was not listed in one of the two reads (a dash on the Stock tab) is neither: that is a
// listing added or removed there, not stock running out or coming back.

import type { DeskData } from "./stock-analysis.ts";

export type StockChangeKind = "out" | "in";

export type StockChange = {
  sku: string;
  title: string | null;
  /** The listing's status in the latest read: ACTIVE or INACTIVE. */
  status: string;
  warehouseId: string;
  kind: StockChangeKind;
  /** Units at this warehouse in the read before. */
  before: number;
  /** Units at this warehouse in the latest read. */
  after: number;
};

/**
 * Every SKU and warehouse that ran out or came back in stock between `data.previousDate` and `data.snapshotDate`,
 * in warehouse order, then stocked out before back in stock, then by SKU. Empty when there is no read before.
 */
export function stockChanges(data: Pick<DeskData, "warehouses" | "listings" | "previousDate">): StockChange[] {
  if (!data.previousDate) return [];
  const changes: StockChange[] = [];
  for (const listing of data.listings) {
    data.warehouses.forEach((w, i) => {
      const before = listing.prev[i];
      const after = listing.now[i];
      if (before === null || before === undefined || after === null || after === undefined) return;
      const kind: StockChangeKind | null = before > 0 && after === 0 ? "out" : before === 0 && after > 0 ? "in" : null;
      if (kind) changes.push({ sku: listing.sku, title: listing.title, status: listing.status, warehouseId: w.id, kind, before, after });
    });
  }
  const order = new Map(data.warehouses.map((w, i) => [w.id, i]));
  return changes.sort(
    (a, b) =>
      (order.get(a.warehouseId) ?? 0) - (order.get(b.warehouseId) ?? 0) ||
      (a.kind === b.kind ? 0 : a.kind === "out" ? -1 : 1) ||
      a.sku.localeCompare(b.sku, "en", { numeric: true, sensitivity: "base" }),
  );
}
