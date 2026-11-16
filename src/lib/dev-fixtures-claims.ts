// Fake Returns to claim rows for the local preview only (/dev/preview?view=fclaim). Not used in production.
import { addDays } from "@/lib/format";
import { FAKE_WAREHOUSES } from "@/lib/dev-fixtures";
import type { ClaimGroup, ClaimRow } from "@/lib/return-claims";

type Fake = [ClaimGroup, "customer_return" | "courier_return", string, string, boolean];
const KINDS: Fake[] = [
  ["wrong_item", "customer_return", "MISSHIPMENT", "DIFFERENT_PRODUCT_RECEIVED", false],
  ["damaged", "customer_return", "DAMAGED_PRODUCT", "DAMAGED_PRODUCT_RECEIVED", false],
  ["quality", "customer_return", "QUALITY_ISSUE", "QUALITY_NOT_AS_EXPECTED", false],
  ["wrong_item", "customer_return", "MISSHIPMENT", "DIFFERENT_BRAND_RECEIVED", false],
  ["missing", "customer_return", "MISSING_ITEM", "MISSING_ACCESSORY", false],
  ["rto_damaged", "courier_return", "Damaged_shipment", "Damaged_shipment", false],
  ["quality", "customer_return", "QUALITY_ISSUE", "QUALITY_NOT_AS_EXPECTED", false],
  ["empty_box", "customer_return", "CUSTOMER_REMORSE", "CUSTOMER_DOES_NOT_WANT", true],
  ["used", "customer_return", "QUALITY_ISSUE", "USED_PRODUCT", false],
  ["damaged", "courier_return", "Attempts_Exhausted", "Attempts_Exhausted", true],
];
const TITLES = ["Steel water bottle 1L", "Lint remover", "Kitchen spray bottle", "Lizard repellent spray", "Shoe rack 4 tier", "Car seat organiser"];

/** Twenty-four completed returns across the reason groups: days left from −3 to 7 with the claim window at 7 days. */
export function fakeClaimRows(today: string): ClaimRow[] {
  const days = [0, 1, 1, 2, 3, 3, 5, 6, 7, -1, -2, -3, 4, 2, 6, 5, 1, 0, 3, 7, 4, 2, 6, 5];
  return days.map((left, i) => {
    const [group, source, reason, subReason, flagged] = KINDS[i % KINDS.length];
    const sku = Math.floor(i / 4) % 6;
    return {
      returnId: `FAKE-RET-${1000 + i}`,
      orderItemId: `FAKE-ITEM-${5000 + i}`,
      orderId: `OD33${4567800 + i}`,
      sku: `FAKE-SKU-${String(sku + 1).padStart(4, "0")}`,
      title: TITLES[sku],
      source,
      reason,
      subReason,
      group,
      flagged,
      quantity: i % 4 === 0 ? 2 : 1,
      warehouseId: FAKE_WAREHOUSES[i % FAKE_WAREHOUSES.length].id,
      returnedOn: addDays(today, left - 7),
      daysLeft: left,
    };
  });
}
