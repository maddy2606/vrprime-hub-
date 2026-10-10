"use client";

import { useEffect } from "react";
import { buttonClass, EmptyState } from "@/components/ui";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <EmptyState
      title="Could not load this screen"
      body="Check your internet connection and try again. If it keeps happening, tell the owner what you were doing."
      action={
        <button type="button" onClick={reset} className={buttonClass("primary")}>
          Try again
        </button>
      }
    />
  );
}
