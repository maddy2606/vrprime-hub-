import Link from "next/link";
import { buttonClass, EmptyState } from "@/components/ui";

export default function NotFound() {
  return (
    <EmptyState
      title="Not found"
      body="This post does not exist, or it belongs to a warehouse you are not assigned to. Ask the person who shared it."
      action={
        <Link href="/" className={buttonClass("primary")}>
          Go to My work
        </Link>
      }
    />
  );
}
