// Obviously fake Review tracker data for the local-only /dev/preview screen. Never used in production.
import type { ReviewsView } from "@/components/reviews/review-tracker";
import { reviewLines, type ReviewLink } from "@/lib/reviews";

export function fakeReviews(): ReviewsView {
  const links: ReviewLink[] = Array.from({ length: 10 }, (_, i) => ({
    rowNo: i + 1,
    platform: i % 3 === 2 ? ("Shopsy" as const) : ("Flipkart" as const),
    product: `Fake Product ${i + 1}`,
    listingId: `FAKEFSN${i + 1}`,
    // One link with no match in the catalogue, to show how that reads.
    sellerSku: i === 8 ? null : `FAKE-RV-SKU-${i + 1}`,
    url: "https://example.test/fake-listing",
    priority: i < 8 ? i + 1 : null,
    target: i % 4 === 3 ? null : 100 + i * 40,
    sharesWith: i === 6 ? 1 : null,
  }));
  const now = new Map<number, number | null>(links.map((l, i) => [l.rowNo, i === 4 ? null : 40 + i * 37]));
  const before = new Map<number, number | null>(links.map((l, i) => [l.rowNo, i === 5 ? null : 40 + i * 37 + (i % 3 === 0 ? 3 : i % 3 === 1 ? -4 : 0)]));
  return {
    checks: [
      { day: "2026-11-14", note: "Fake check" },
      { day: "2026-11-07", note: null },
      { day: "2026-10-31", note: null },
    ],
    day: "2026-11-14",
    prevDay: "2026-11-07",
    lines: reviewLines(links, now, before),
    trend: [
      { day: "2026-10-31", reviews: 1180, missing: 0 },
      { day: "2026-11-07", reviews: 1215, missing: 1 },
      { day: "2026-11-14", reviews: 1242, missing: 1 },
    ],
  };
}
