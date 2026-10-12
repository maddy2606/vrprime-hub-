import Link from "next/link";
import { buttonClass, EmptyState } from "@/components/ui";

export default function NotFound() {
  return (
    <EmptyState
      title="Not found"
      body="This page does not exist, or it is not available to you. If someone sent you the link, ask them to check it."
      action={
        <Link prefetch={false} href="/" className={buttonClass("primary")}>
          Go to My work
        </Link>
      }
    />
  );
}
