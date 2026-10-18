"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { KindIcon, NotificationCard } from "@/components/alerts/alert-card";
import { ArrowRightIcon, CheckIcon } from "@/components/icons";
import { Sheet } from "@/components/shell/sheet";
import { buttonClass } from "@/components/ui";
import { groupAlerts, isAlertKind, timeAgo, type AlertGroup } from "@/lib/alerts";
import { notificationUrl } from "@/lib/notifications";
import type { NotificationRow } from "@/lib/types";
import { getUnreadNotifications, markAllNotificationsRead, markNotificationsRead } from "@/server/actions/notifications";

/** The bell opens the panel with this event; the panel tells the bell its count with the other. */
export const ALERTS_OPEN_EVENT = "vr-alerts-open";
export const ALERTS_COUNT_EVENT = "vr-alerts-count";

// The alerts already shown in this visit (sessionStorage: a visit ends when the tab or the app is closed). Closing the
// panel marks them seen, so it does not pop up again on every page; a new alert, or the next visit, opens it again.
const SEEN_KEY = "vr-alerts-seen";
const POLL_MS = 60_000;

function readSeen(): Set<string> {
  try {
    const list: unknown = JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? "[]");
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function addSeen(ids: string[]) {
  try {
    const seen = readSeen();
    for (const id of ids) seen.add(id);
    sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-400)));
  } catch {
    // Without storage the panel simply opens again on the next page.
  }
}

/**
 * The alerts panel. It opens by itself when the site opens with unread alerts (a sync is down, orders may miss dispatch,
 * stock is running out, more orders than people), and whenever a new one arrives while the site is open (checked every
 * minute and each time you come back to the tab or the app). The bell opens it too.
 */
export function AlertCenter({ initial, total }: { initial: NotificationRow[]; total: number }) {
  const router = useRouter();
  const [server, setServer] = useState({ items: initial, total });
  // A fresh list from the server (after a refresh or a navigation) replaces whatever was polled.
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setServer({ items: initial, total });
  }
  const [readHere, setReadHere] = useState<Set<string>>(() => new Set());
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(0);

  const unread = server.items.filter((n) => !readHere.has(n.id));
  const groups = groupAlerts(unread);
  const updates = unread.filter((n) => !isAlertKind(n.kind));
  const count = Math.max(0, server.total - (server.items.length - unread.length));
  const alertKey = groups.flatMap((g) => g.ids).join(",");

  // Tell the bell.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(ALERTS_COUNT_EVENT, { detail: count }));
  }, [count]);

  // Pop up for alerts not shown yet in this visit.
  useEffect(() => {
    if (!alertKey) return;
    const seen = readSeen();
    if (alertKey.split(",").some((id) => !seen.has(id))) {
      void Promise.resolve().then(() => {
        setNow(Date.now());
        setOpen(true);
      });
    }
  }, [alertKey]);

  // The bell, and checking for new alerts while the site is open.
  useEffect(() => {
    let alive = true;
    const show = () => {
      setNow(Date.now());
      setOpen(true);
    };
    const poll = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const latest = await getUnreadNotifications();
        if (alive && latest) setServer(latest);
      } catch {
        // Keep what is on screen; the next check tries again.
      }
    };
    const every = window.setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", poll);
    window.addEventListener(ALERTS_OPEN_EVENT, show);
    window.addEventListener("vr-sync-check", poll);
    return () => {
      alive = false;
      window.clearInterval(every);
      document.removeEventListener("visibilitychange", poll);
      window.removeEventListener(ALERTS_OPEN_EVENT, show);
      window.removeEventListener("vr-sync-check", poll);
    };
  }, []);

  const close = () => {
    if (alertKey) addSeen(alertKey.split(","));
    setOpen(false);
  };

  const markRead = (ids: string[]) => {
    setReadHere((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    void markNotificationsRead(ids).then((r) => {
      if (r.ok) router.refresh();
    });
  };

  const openGroup = (g: AlertGroup) => {
    markRead(g.ids);
    close();
    router.push(notificationUrl(g.latest));
  };

  const markAll = () => {
    setServer({ items: [], total: 0 });
    void markAllNotificationsRead().then((r) => {
      if (r.ok) router.refresh();
    });
  };

  const attention = groups.length;
  return (
    <Sheet
      open={open}
      onClose={close}
      variant="popover"
      title="Alerts"
      subtitle={attention ? `${attention} ${attention === 1 ? "thing needs" : "things need"} your attention` : "Nothing needs your attention"}
      footer={
        <div className="flex gap-2">
          <Link prefetch={false} href="/notifications" onClick={close} className={buttonClass("secondary", "flex-1")}>
            All notifications
          </Link>
          {unread.length ? (
            <button type="button" onClick={markAll} className={buttonClass("primary", "flex-1")}>
              <CheckIcon className="h-4 w-4" />
              Mark all read
            </button>
          ) : null}
        </div>
      }
    >
      {groups.length ? (
        <ul className="flex flex-col gap-3">
          {groups.map((g, i) => (
            <li key={g.kind} className="sp-reveal" style={{ ["--i" as string]: i }}>
              <NotificationCard
                n={g.latest}
                unread
                when={timeAgo(g.latest.created_at, now)}
                note={g.ids.length > 1 ? `+${g.ids.length - 1} earlier ${g.ids.length === 2 ? "alert" : "alerts"} like this` : undefined}
              >
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={() => openGroup(g)} className={buttonClass("primary", "flex-1 sm:flex-none")}>
                    Open
                    <ArrowRightIcon className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => markRead(g.ids)}
                    aria-label={g.ids.length > 1 ? `Mark these ${g.ids.length} alerts read` : "Mark read"}
                    className={buttonClass("secondary", "flex-1 whitespace-nowrap sm:flex-none")}
                  >
                    <CheckIcon className="h-4 w-4" />
                    Mark read
                  </button>
                </div>
              </NotificationCard>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center px-4 py-8 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-ok-soft text-ok">
            <CheckIcon className="h-7 w-7" />
          </span>
          <p className="mt-3 text-base font-bold">All clear</p>
          <p className="mt-1 max-w-xs text-sm text-muted">New alerts show up here as soon as they come in: stock, dispatch, capacity and syncs.</p>
        </div>
      )}

      {updates.length ? (
        <section aria-label="Other updates" className="mt-5">
          <h3 className="px-1 text-xs font-bold uppercase tracking-wider text-muted">Other updates</h3>
          <ul className="mt-2 overflow-hidden rounded-2xl border border-line-soft bg-surface">
            {updates.slice(0, 6).map((n) => (
              <li key={n.id} className="border-b border-line-soft last:border-b-0">
                <Link
                  prefetch={false}
                  href={notificationUrl(n)}
                  onClick={() => {
                    markRead([n.id]);
                    close();
                  }}
                  className="focus-ring flex min-h-14 items-center gap-3 px-3.5 py-2.5 transition hover:bg-surface2"
                >
                  <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface2 text-muted">
                    <KindIcon kind={n.kind} className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold">{n.title}</span>
                    {n.body ? <span className="block truncate text-xs text-muted">{n.body}</span> : null}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted">{timeAgo(n.created_at, now)}</span>
                </Link>
              </li>
            ))}
          </ul>
          {updates.length > 6 ? (
            <p className="mt-2 px-1 text-xs text-muted">+{updates.length - 6} more in All notifications</p>
          ) : null}
        </section>
      ) : null}
    </Sheet>
  );
}
