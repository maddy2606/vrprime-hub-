"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BellIcon, PlusIcon, SearchIcon } from "@/components/icons";
import { CommandPalette } from "@/components/shell/command-palette";
import { UnreadBadge } from "@/components/ui";
import { lastSyncedAt } from "@/server/actions/search";

type Role = "owner" | "admin" | "warehouse";

function ago(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

/** "Synced 42s ago · All warehouses": ticks every second and starts over when a sync finishes (checked every minute). */
function SyncStatus({ since, scope }: { since: string | null; scope: string }) {
  const [at, setAt] = useState<string | null>(since);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const first = window.setTimeout(() => setNow(Date.now()), 0);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const poll = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const latest = await lastSyncedAt();
        if (latest) setAt(latest);
      } catch {
        /* keep counting from the last known time */
      }
    };
    const every = window.setInterval(poll, 60_000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(tick);
      window.clearInterval(every);
      document.removeEventListener("visibilitychange", poll);
    };
  }, []);

  const age = at && now !== null ? now - Date.parse(at) : null;
  // Orders are read every 30 minutes in working hours; an hour with no read is worth a second look.
  const stale = age !== null && age > 60 * 60_000;
  const label = !at ? "Not synced yet" : age === null ? "Synced" : `Synced ${ago(age)}`;
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs text-muted" role="status" aria-label={`${label}, ${scope}`}>
      <span aria-hidden="true" className={`sp-dot h-2 w-2 shrink-0 rounded-full ${stale || !at ? "bg-warn text-warn" : "bg-cyan text-cyan"}`} />
      <span className="whitespace-nowrap font-mono max-[419px]:hidden">{label}</span>
      <span className="whitespace-nowrap font-mono min-[420px]:hidden">{!at ? "—" : age === null ? "" : ago(age).replace(" ago", "")}</span>
      <span aria-hidden="true" className="hidden lg:inline">·</span>
      <span className="hidden truncate lg:inline">{scope}</span>
    </div>
  );
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

function AccountMenu({ name, sub, children }: { name: string; sub: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label="Account menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="focus-ring flex h-11 w-11 items-center justify-center rounded-full bg-accent-soft text-sm font-extrabold text-accent-text ring-1 ring-accent/40 transition hover:ring-accent"
      >
        {initials(name)}
      </button>
      {open ? (
        <div className="sp-card absolute right-0 top-12 z-50 w-64 bg-surface2 p-3" onClick={() => setOpen(false)}>
          <p className="truncate text-sm font-bold">{name}</p>
          <p className="truncate text-xs text-muted">{sub}</p>
          <div className="mt-3 flex flex-col gap-2">{children}</div>
        </div>
      ) : null}
    </div>
  );
}

export function CommandBar({
  user,
  unread,
  scope,
  syncedAt,
  menu,
}: {
  user: { name: string; role: Role; sub: string };
  unread: number;
  scope: string;
  syncedAt: string | null;
  /** The account menu's buttons (server-rendered links and the sign-out button). */
  menu: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line-soft bg-canvas/75 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-2 px-4 lg:px-8">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="focus-ring flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl border border-line bg-surface px-3 text-left text-sm text-faint transition hover:border-accent/50 md:max-w-md"
            aria-label="Search (Ctrl K)"
            aria-haspopup="dialog"
          >
            <SearchIcon className="h-[18px] w-[18px] shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate">Search SKUs, orders, tickets</span>
            <kbd className="hidden shrink-0 rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted sm:block">Ctrl K</kbd>
          </button>

          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-3">
            <SyncStatus since={syncedAt} scope={scope} />
            <Link
              prefetch={false}
              href="/posts/new"
              aria-label="New post"
              className="focus-ring sp-glow flex h-11 w-11 items-center justify-center gap-1.5 rounded-xl bg-accent text-sm font-bold text-white transition hover:brightness-110 sm:w-auto sm:px-4"
            >
              <PlusIcon className="h-5 w-5" />
              <span className="hidden sm:inline">Post</span>
            </Link>
            <Link
              prefetch={false}
              href="/notifications"
              aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
              className="focus-ring relative flex h-11 w-11 items-center justify-center rounded-full text-muted transition hover:bg-surface2 hover:text-ink"
            >
              <BellIcon className="h-6 w-6" />
              {unread ? (
                <span className="absolute right-0.5 top-0.5">
                  <UnreadBadge count={unread} />
                </span>
              ) : null}
            </Link>
            <AccountMenu name={user.name} sub={user.sub}>
              {menu}
            </AccountMenu>
          </div>
        </div>
      </header>
      <CommandPalette open={open} onClose={() => setOpen(false)} role={user.role} />
    </>
  );
}
