"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useToast } from "@/components/toast";
import { buttonClass, Chip } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { NOTIFICATION_ICON_LABEL, type Tone } from "@/lib/labels";
import { notificationUrl } from "@/lib/notifications";
import type { NotificationRow } from "@/lib/types";
import { markAllNotificationsRead, markNotificationRead } from "@/server/actions/notifications";

const KIND_TONE: Record<string, Tone> = {
  assigned: "accent",
  comment: "info",
  done: "ok",
  overdue: "bad",
  follow_up: "warn",
  test: "neutral",
  dispatch_risk: "bad",
  listing_live: "ok",
  listing_not_found: "bad",
};

export function NotificationList({ items }: { items: NotificationRow[] }) {
  const router = useRouter();
  // Marked read in this browser a moment ago, before the page has reloaded.
  const [readHere, setReadHere] = useState<Set<string>>(new Set());

  const open = (n: NotificationRow) => {
    if (!n.read_at && !readHere.has(n.id)) {
      setReadHere((set) => new Set(set).add(n.id));
      void markNotificationRead(n.id);
    }
    router.push(notificationUrl(n));
  };

  return (
    <ul className="flex flex-col gap-2">
      {items.map((n) => {
        const unread = !n.read_at && !readHere.has(n.id);
        return (
          <li key={n.id}>
            <Link
              prefetch={false}
              href={notificationUrl(n)}
              onClick={(e) => {
                // Let ctrl/cmd/middle clicks open a new tab as usual.
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                open(n);
              }}
              className={`focus-ring block rounded-xl border p-3 transition hover:border-accent ${
                unread ? "border-accent/50 bg-accent-soft" : "border-line bg-surface"
              }`}
            >
              <span className="flex flex-wrap items-center gap-1.5">
                {unread ? <span aria-label="Unread" className="h-2.5 w-2.5 rounded-full bg-accent" /> : null}
                <Chip tone={KIND_TONE[n.kind] ?? "neutral"}>{NOTIFICATION_ICON_LABEL[n.kind] ?? "Update"}</Chip>
                <span className="ml-auto text-xs text-muted">{formatDateTime(n.created_at)}</span>
              </span>
              <span className={`mt-1.5 block break-words text-[15px] leading-snug ${unread ? "font-extrabold" : "font-bold"}`}>
                {n.title}
              </span>
              {n.body ? <span className="mt-0.5 block break-words text-sm text-muted">{n.body}</span> : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function MarkAllReadButton() {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          if (toast.result(await markAllNotificationsRead())) router.refresh();
        })
      }
      className={buttonClass("secondary", "shrink-0")}
    >
      {pending ? "Marking…" : "Mark all read"}
    </button>
  );
}
