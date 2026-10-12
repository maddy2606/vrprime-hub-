"use client";

import { useCallback, useEffect, useState } from "react";
import { disablePush, enablePush, readPushStatus, type PushState, type PushStatus } from "@/lib/push-client";
import type { ActionResult } from "@/lib/types";
import { removePushSubscription, savePushSubscription } from "@/server/actions/notifications";

const LOADING: PushStatus = { state: "loading", subscription: null };

/**
 * Push state for this device, plus turning it on and off.
 * Whenever this device is already subscribed it is also (re)registered for the
 * signed-in person once per browser session: on a shared phone the device moves
 * to whoever signed in last.
 */
export function usePush(userId: string) {
  const [status, setStatus] = useState<PushStatus>(LOADING);

  const refresh = useCallback(async () => {
    const next = await readPushStatus();
    setStatus(next);
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await readPushStatus();
      if (cancelled) return;
      setStatus(next);
      if (next.state !== "on" || !next.subscription) return;
      const key = `vr-push-synced:${userId}:${next.subscription.endpoint}`;
      try {
        if (sessionStorage.getItem(key)) return;
        const result = await savePushSubscription(next.subscription);
        if (result.ok) sessionStorage.setItem(key, "1");
      } catch {
        // Storage can be unavailable (private window). The next visit tries again.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const enable = useCallback(async (): Promise<ActionResult> => {
    const result = await enablePush();
    if (!result.ok) {
      await refresh();
      return {
        ok: false,
        message:
          result.reason === "denied"
            ? "Notifications are blocked. Allow them for this site in your browser settings, then try again."
            : "Could not turn on notifications on this device. Try again.",
      };
    }
    const saved = await savePushSubscription(result.subscription);
    await refresh();
    return saved;
  }, [refresh]);

  const disable = useCallback(async (): Promise<ActionResult> => {
    const endpoint = await disablePush();
    const result: ActionResult = endpoint
      ? await removePushSubscription(endpoint)
      : { ok: true, message: "Notifications are off for this device" };
    await refresh();
    return result;
  }, [refresh]);

  return { state: status.state as PushState, enable, disable };
}
