"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { usePush } from "@/components/notifications/use-push";
import { useToast } from "@/components/toast";
import { buttonClass, Card, Chip } from "@/components/ui";
import { sendTestNotification } from "@/server/actions/notifications";

/** On/off for push on this device, with a test button. Lives at the top of the Notifications page. */
export function PushSettings({ userId }: { userId: string }) {
  const router = useRouter();
  const toast = useToast();
  const { state, enable, disable } = usePush(userId);
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<Parameters<typeof toast.result>[0]>) =>
    startTransition(async () => {
      toast.result(await action());
      router.refresh();
    });

  let status: { tone: "ok" | "neutral" | "warn" | "bad"; label: string; help: string };
  switch (state) {
    case "on":
      status = { tone: "ok", label: "On for this device", help: "Alerts arrive on this phone even when the app is closed." };
      break;
    case "off":
      status = {
        tone: "neutral",
        label: "Off for this device",
        help: "Turn on to get alerts on this phone. You still see everything in the list below.",
      };
      break;
    case "blocked":
      status = {
        tone: "bad",
        label: "Blocked in the browser",
        help: "Allow notifications for this site in your browser or phone settings, then come back here.",
      };
      break;
    case "needs-install":
      status = {
        tone: "warn",
        label: "Add the app to your Home Screen first",
        help: "On iPhone, tap Share, then Add to Home Screen, and open the app from there. Then turn notifications on.",
      };
      break;
    case "unavailable":
      status = {
        tone: "warn",
        label: "Not set up yet",
        help: "Push alerts are not switched on for the team yet. Ask the owner. The list below still works.",
      };
      break;
    case "unsupported":
      status = {
        tone: "neutral",
        label: "Not available on this device",
        help: "This browser cannot receive push alerts. You still see everything in the list below.",
      };
      break;
    default:
      status = { tone: "neutral", label: "Checking…", help: "" };
  }

  return (
    <Card className="mb-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-extrabold">Alerts on this phone</h2>
        <Chip tone={status.tone}>{status.label}</Chip>
      </div>
      {status.help ? <p className="mt-1.5 text-sm text-muted">{status.help}</p> : null}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        {state === "off" ? (
          <button type="button" disabled={pending} onClick={() => run(enable)} className={buttonClass("primary")}>
            {pending ? "Turning on…" : "Turn on"}
          </button>
        ) : null}
        {state === "on" ? (
          <>
            <button type="button" disabled={pending} onClick={() => run(sendTestNotification)} className={buttonClass("secondary")}>
              Send me a test
            </button>
            <button type="button" disabled={pending} onClick={() => run(disable)} className={buttonClass("secondary")}>
              Turn off
            </button>
          </>
        ) : null}
      </div>
    </Card>
  );
}
