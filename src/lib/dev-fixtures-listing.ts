// Fake Listing check rows for the local preview only (/dev/preview?view=flistcheck). Not used in production.
import type { CheckRow } from "@/lib/listing-view";

export function fakeCheckRows(): CheckRow[] {
  const row = (rowNo: number, product: string, platform: string, priority: number | null, status: CheckRow["status"], price: number | null, expectedPrice: number | null): CheckRow => ({
    rowNo,
    product,
    platform,
    priority,
    url: "https://www.flipkart.com/",
    status,
    price,
    expectedPrice,
  });
  return [
    row(1, "Fake Lizard Repellent", "Flipkart", 1, "buyable", 185, 185),
    row(2, "Fake Pest Spray", "Flipkart", 1, "buyable", 183, 199),
    row(3, "Fake Car Rat Spray", "Flipkart", 2, "out_of_stock", null, 186),
    row(4, "Fake Rat Spray 2pc", "Flipkart", 3, "buyable", 171, 171),
    row(5, "Fake Bed Bug Spray", "Flipkart", 4, "unavailable", null, 197),
    row(6, "Fake Lizard Repellent", "Shopsy", 5, "not_read", null, null),
    row(7, "Fake Mosquito Spray", "Flipkart", 8, "buyable", 149, 149.5),
  ];
}
