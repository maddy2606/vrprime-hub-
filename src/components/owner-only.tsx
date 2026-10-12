import Link from "next/link";
import { buttonClass, EmptyState } from "@/components/ui";

/** Shown instead of an owner-only page (Users, Settings) to anyone else. */
export function OwnerOnly() {
  return (
    <EmptyState
      title="This page is for the owner only"
      body="Only the owner can manage users and settings. If something needs changing, ask the owner."
      action={
        <Link prefetch={false} href="/" className={buttonClass("primary")}>
          Go to My work
        </Link>
      }
    />
  );
}
