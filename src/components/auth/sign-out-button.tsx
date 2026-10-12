"use client";

import { useTransition } from "react";
import { currentEndpoint } from "@/lib/push-client";
import { signOut } from "@/server/actions/auth";
import { removePushSubscription } from "@/server/actions/notifications";

/**
 * Signs out. First this device stops receiving the person's alerts, so on a shared
 * phone the next person does not see them. The next sign-in on this phone registers
 * the device again (see usePush).
 */
export function SignOutButton({ className }: { className: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          try {
            const endpoint = await currentEndpoint();
            if (endpoint) await removePushSubscription(endpoint);
          } catch {
            // Never let this stop someone from signing out.
          }
          await signOut();
        });
      }}
    >
      <button type="submit" disabled={pending} className={className}>
        {pending ? "Signing out…" : "Sign out"}
      </button>
    </form>
  );
}
