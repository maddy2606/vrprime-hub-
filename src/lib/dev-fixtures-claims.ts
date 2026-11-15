// Fake Returns to claim rows for the local preview only (/dev/preview?view=fclaim). Not used in production.
import { addDays } from "@/lib/format";
import { FAKE_WAREHOUSES } from "@/lib/dev-fixtures";
import type { ClaimRow } from "@/lib/return-claims";

const REASONS: [string, string | null][] = [
  ["DAMAGED_PRODUCT", "Broken bottle"],
  ["WRONG_PRODUCT", "Different product"],
  ["MISSING_ITEM", null],
  ["QUALITY_ISSUE", "Leaking spray"],
  ["NOT_REQUIRED", null],
];

/** Twelve completed returns: days left from −3 to 7 with the claim window at 7 days. */
export function fakeClaimRows(today: string): ClaimRow[] {
  const days = [0, 1, 1, 2, 3, 3, 5, 6, 7, -1, -2, -3];
  return days.map((left, i) => {
    const [reason, subReason] = REASONS[i % REASONS.length];
    return {
      returnId: `FAKE-RET-${1000 + i}`,
      orderItemId: `FAKE-ITEM-${5000 + i}`,
      orderId: `OD33${4567800 + i}`,
      sku: `FAKE-SKU-${String((i % 6) + 1).padStart(4, "0")}`,
      source: i % 3 === 0 ? "courier_return" : "customer_return",
      reason,
      subReason,
      quantity: i % 4 === 0 ? 2 : 1,
      warehouseId: FAKE_WAREHOUSES[i % FAKE_WAREHOUSES.length].id,
      returnedOn: addDays(today, left - 7),
      daysLeft: left,
    };
  });
}
