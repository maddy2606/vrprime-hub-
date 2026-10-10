import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass, EmptyState, PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Tickets" };

export default function TicketsPage() {
  return (
    <>
      <PageTitle title="Tickets" sub="Flipkart and Amazon support tickets" />
      <EmptyState
        title="Tickets arrive in Phase 2"
        body="For now, when you mark a problem done, enter the marketplace ticket ID. You can find it later by searching for it in All posts."
        action={
          <Link href="/all?type=problem" className={buttonClass("secondary")}>
            See problems
          </Link>
        }
      />
    </>
  );
}
