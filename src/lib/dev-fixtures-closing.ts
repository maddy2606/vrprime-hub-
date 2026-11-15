// Fake closing report rows for the local preview only (/dev/preview?view=closing). Not used in production.
import { FAKE_WAREHOUSES } from "@/lib/dev-fixtures";
import type { ClosingRow } from "@/lib/closing-report";

const FIGURES = [
  [412, 380, 3, 1, 9, 6, 1, 1, 0, 0, 2],
  [268, 251, 0, 0, 4, 4, 0, 0, 1, 0, 1],
  [155, 149, 2, 0, 6, 3, 1, 0, 0, 1, 0],
  [96, 90, 1, 2, 3, 2, 0, 2, 0, 0, 0],
];

export function fakeClosingRows(): ClosingRow[] {
  return FAKE_WAREHOUSES.slice(0, FIGURES.length).map((w, i) => {
    const [dispatchedUnits, dispatchedOrders, pendingToday, lateNow, pendingTotal, present, halfDay, absent, onLeave, notMarked, returnsToCheck] = FIGURES[i];
    return { warehouseId: w.id, warehouse: w.name, sortOrder: i, dispatchedUnits, dispatchedOrders, pendingToday, lateNow, pendingTotal, present, halfDay, absent, onLeave, notMarked, returnsToCheck };
  });
}
