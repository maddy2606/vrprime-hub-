import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass, EmptyState, PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Stock" };

export default function StockPage() {
  return (
    <>
      <PageTitle title="Stock" sub="Flipkart stock across the 5 warehouses" />
      <EmptyState
        title="The stock desk arrives in Phase 3"
        body="It will sync from Flipkart every morning at 8:00 and show low stock, out of stock and weight alerts. Until then, ask for stock with a restock post."
        action={
          <Link prefetch={false} href="/posts/new?type=restock" className={buttonClass("secondary")}>
            Create restock post
          </Link>
        }
      />
    </>
  );
}
