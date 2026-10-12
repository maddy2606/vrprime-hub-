"use client";

import { useEffect, useState, useTransition } from "react";
import { usePush } from "@/components/notifications/use-push";
import { useToast } from "@/components/toast";
import { buttonClass } from "@/components/ui";

const DISMISSED_KEY = "vr-push-prompt-dismissed";
const HIDE_DAYS = 7;

function recentlyDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISSED_KEY));
    return Boolean(at) && Date.now() - at < HIDE_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

/**
 * The one-time offer to turn on notifications, shown on the first visits after sign-in.
 * "Not now" hides it for a week. It also keeps this device registered (see usePush).
 */
export function PushPrompt({ userId }: { userId: string }) {
  const { state, enable } = usePush(userId);
  const toast = useToast();
  const [hidden, setHidden] = useState(true);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    // Read after mount: the server cannot know what this browser has stored.
    void Promise.resolve().then(() => setHidden(recentlyDismissed()));
  }, []);

  if (hidden || (state !== "off" && state !== "needs-install")) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    } catch {
      // Without storage it simply shows again next visit.
    }
    setHidden(true);
  };

  return (
    <section aria-label="Turn on notifications" className="mb-4 rounded-xl border border-accent bg-accent-soft p-4">
      <p className="text-base font-extrabold text-accent-text">Get alerts on this phone?</p>
      <p className="mt-1 text-sm">
        We will tell you when work is assigned to you, when someone comments on your post, and when your post is marked
        done. Each morning at 9:30 we also remind you about overdue work and ticket follow-ups. You can turn this off at
        any time.
      </p>
      {state === "needs-install" ? (
        <p className="mt-2 text-sm font-semibold">
          On iPhone this only works after you add the app to your Home Screen: tap Share, then Add to Home Screen, and open
          it from there.
        </p>
      ) : null}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        {state === "off" ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                if (toast.result(await enable())) setHidden(true);
              })
            }
            className={buttonClass("primary")}
          >
            {pending ? "Turning on…" : "Turn on notifications"}
          </button>
        ) : null}
        <button type="button" onClick={dismiss} className={buttonClass("secondary")}>
          Not now
        </button>
      </div>
    </section>
  );
}
