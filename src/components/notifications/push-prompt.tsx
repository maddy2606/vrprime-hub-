"use client";
import { usePathname } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { BellIcon } from "@/components/icons";
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
 * The one-time offer to turn on notifications: a single line on the Command Deck only, so it never covers another
 * page. "Not now" hides it for a week. It also keeps this device registered (see usePush). The full explanation and
 * the on/off switch live on the Notifications page.
 */
export function PushPrompt({ userId }: { userId: string }) {
  const pathname = usePathname();
  const { state, enable } = usePush(userId);
  const toast = useToast();
  const [hidden, setHidden] = useState(true);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    // Read after mount: the server cannot know what this browser has stored.
    void Promise.resolve().then(() => setHidden(recentlyDismissed()));
  }, []);
  if (pathname !== "/" || hidden || (state !== "off" && state !== "needs-install")) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    } catch {
      // Without storage it simply shows again next visit.
    }
    setHidden(true);
  };
  return (
    <section aria-label="Turn on notifications" className="sp-card mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <BellIcon className="h-5 w-5 shrink-0 text-accent-text" />
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-semibold">Get alerts on this phone?</span>{" "}
        <span className="t-caption">
          {state === "needs-install"
            ? "On iPhone, add the app to your Home Screen first (Share, then Add to Home Screen), then turn alerts on from Notifications."
            : "Stock running out, orders at risk, sync problems and work assigned to you, even when the app is closed."}
        </span>
      </p>
      <span className="flex shrink-0 gap-2">
        {state === "off" ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                if (toast.result(await enable())) setHidden(true);
              })
            }
            className={buttonClass("secondary")}
          >
            {pending ? "Turning on…" : "Turn on notifications"}
          </button>
        ) : null}
        <button type="button" onClick={dismiss} className={buttonClass("ghost")}>
          Not now
        </button>
      </span>
    </section>
  );
}
