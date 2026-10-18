"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { NotificationCard } from "@/components/alerts/alert-card";
import { useToast } from "@/components/toast";
import { buttonClass } from "@/components/ui";
import { isAlertKind } from "@/lib/alerts";
import { formatDateTime } from "@/lib/format";
import { notificationUrl } from "@/lib/notifications";
import type { NotificationRow } from "@/lib/types";
import { markAllNotificationsRead, markNotificationRead } from "@/server/actions/notifications";

type Filter = "all" | "alerts" | "updates";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "alerts", label: "Alerts" },
  { key: "updates", label: "Updates" },
];

export function NotificationList({ items }: { items: NotificationRow[] }) {
  const router = useRouter();
  // Marked read in this browser a moment ago, before the page has reloaded.
  const [readHere, setReadHere] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>("all");

  const open = (n: NotificationRow) => {
    if (!n.read_at && !readHere.has(n.id)) {
      setReadHere((set) => new Set(set).add(n.id));
      void markNotificationRead(n.id);
    }
    router.push(notificationUrl(n));
  };

  const counts: Record<Filter, number> = {
    all: items.length,
    alerts: items.filter((n) => isAlertKind(n.kind)).length,
    updates: items.filter((n) => !isAlertKind(n.kind)).length,
  };
  const shown = items.filter((n) => filter === "all" || (filter === "alerts") === isAlertKind(n.kind));

  return (
    <>
      <div role="tablist" aria-label="Show" className="mb-3 flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FILTERS.map((f) => {
          const on = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setFilter(f.key)}
              className={`focus-ring flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-bold transition ${
                on ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-muted hover:text-ink"
              }`}
            >
              {f.label}
              <span className={`font-mono text-xs ${on ? "text-accent-ink/80" : "text-faint"}`}>{counts[f.key]}</span>
            </button>
          );
        })}
      </div>
      {shown.length ? (
        <ul className="flex flex-col gap-2.5">
          {shown.map((n) => {
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
                  className="focus-ring block rounded-2xl transition hover:-translate-y-px"
                >
                  <NotificationCard n={n} unread={unread} when={formatDateTime(n.created_at)} />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-2xl border border-dashed border-line px-5 py-8 text-center text-sm text-muted">
          {filter === "alerts" ? "No alerts in your latest notifications." : "No updates in your latest notifications."}
        </p>
      )}
    </>
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
