"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ALERTS_COUNT_EVENT, ALERTS_OPEN_EVENT } from "@/components/alerts/alert-center";
import { BellIcon, PlusIcon, RefreshIcon, SearchIcon } from "@/components/icons";
import { CommandPalette } from "@/components/shell/command-palette";
import { UnreadBadge } from "@/components/ui";
import { syncInventoryNow } from "@/server/actions/inventory";
import { startOrdersSync } from "@/server/actions/orders";
import { lastSyncedAt } from "@/server/actions/search";
import { startStockSync } from "@/server/actions/stock";

type Role = "owner" | "admin" | "warehouse";

function ago(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

/**
 * "Synced 42s ago · All warehouses" and, for the owner and admins, the Sync now button. It ticks every second and starts
 * over when a sync finishes (checked every minute). On a phone the age sits inside the button to save room.
 */
function SyncControl({ since, scope, canSync }: { since: string | null; scope: string; canSync: boolean }) {
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
    window.addEventListener("vr-sync-check", poll);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(tick);
      window.clearInterval(every);
      document.removeEventListener("visibilitychange", poll);
      window.removeEventListener("vr-sync-check", poll);
    };
  }, []);

  const age = at && now !== null ? now - Date.parse(at) : null;
  // Orders are read every 30 minutes in working hours; an hour with no read is worth a second look.
  const stale = age !== null && age > 60 * 60_000;
  const label = !at ? "Not synced yet" : age === null ? "Synced" : `Synced ${ago(age)}`;
  const short = !at ? "—" : age === null ? "" : ago(age).replace(" ago", "");
  const dot = `sp-dot h-2 w-2 shrink-0 rounded-full ${stale || !at ? "bg-warn text-warn" : "bg-cyan text-cyan"}`;
  return (
    <>
      <div className="hidden min-w-0 items-center gap-2 text-xs text-muted sm:flex" role="status" aria-label={`${label}, ${scope}`}>
        <span aria-hidden="true" className={dot} />
        <span className="whitespace-nowrap font-mono">{label}</span>
        <span aria-hidden="true" className="hidden lg:inline">·</span>
        <span className="hidden truncate lg:inline">{scope}</span>
      </div>
      {canSync ? (
        <SyncNowButton short={short} label={label} dot={dot} />
      ) : (
        <span className="flex items-center gap-1.5 font-mono text-xs text-muted sm:hidden" role="status" aria-label={label}>
          <span aria-hidden="true" className={dot} />
          {short}
        </span>
      )}
    </>
  );
}

/** "Sync now" in the top bar: one button for everything (VR Prime stock, Flipkart stock and orders). Owner and admin only. */
function SyncNowButton({ short, label: synced, dot }: { short: string; label: string; dot: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "done" | "failed">("idle");

  async function run() {
    setState("busy");
    try {
      // VR Prime stock, Flipkart stock and Flipkart orders. Flipkart runs one at a time, so the orders read waits for the
      // stock read and then starts by itself.
      const results = await Promise.allSettled([syncInventoryNow(), startStockSync(), startOrdersSync("pending")]);
      const started = results.filter((r) => r.status === "fulfilled" && r.value.ok).length;
      setState(started > 0 ? "done" : "failed");
      // The answers arrive a few seconds later; look again then.
      for (const wait of [8000, 40000, 100000]) {
        globalThis.setTimeout(() => {
          router.refresh();
          window.dispatchEvent(new Event("vr-sync-check"));
        }, wait);
      }
    } catch {
      setState("failed");
    }
    globalThis.setTimeout(() => setState("idle"), 9000);
  }

  const label = state === "busy" ? "Syncing…" : state === "done" ? "Started" : state === "failed" ? "Failed" : "Sync now";
  return (
    <button
      type="button"
      onClick={run}
      disabled={state === "busy"}
      aria-label={`Sync everything now. ${synced}`}
      className="focus-ring flex h-11 items-center justify-center gap-1.5 rounded-xl border border-line bg-surface/60 px-2.5 text-sm font-bold text-ink transition hover:border-accent/50 disabled:opacity-60 md:px-3"
    >
      <RefreshIcon className={`h-5 w-5 ${state === "busy" ? "animate-spin" : ""}`} />
      {/* Phone: how long ago, with the green/amber dot. Wide screens: the words. */}
      <span className="flex items-center gap-1 font-mono text-xs font-semibold text-muted sm:hidden">
        {state === "idle" ? (
          <>
            <span aria-hidden="true" className={dot} />
            {short}
          </>
        ) : state === "busy" ? (
          "…"
        ) : (
          label
        )}
      </span>
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}

/** The bell: opens the alerts panel. Its count follows the panel, which checks for new alerts every minute. */
function AlertBell({ unread }: { unread: number }) {
  const [count, setCount] = useState(unread);
  const [prev, setPrev] = useState(unread);
  if (unread !== prev) {
    setPrev(unread);
    setCount(unread);
  }
  useEffect(() => {
    const onCount = (e: Event) => {
      const n = (e as CustomEvent<unknown>).detail;
      if (typeof n === "number") setCount(n);
    };
    window.addEventListener(ALERTS_COUNT_EVENT, onCount);
    return () => window.removeEventListener(ALERTS_COUNT_EVENT, onCount);
  }, []);
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(ALERTS_OPEN_EVENT))}
      aria-haspopup="dialog"
      aria-label={count ? `Alerts and notifications, ${count} unread` : "Alerts and notifications"}
      className="focus-ring relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-surface2 hover:text-ink"
    >
      <BellIcon className="h-6 w-6" />
      {count ? (
        <span className="vr-ring absolute right-0.5 top-0.5 rounded-full">
          <UnreadBadge count={count} />
        </span>
      ) : null}
    </button>
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
      <header className="sticky top-0 z-30 border-b border-line-soft bg-canvas/75 pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-1.5 px-3 min-[400px]:px-4 sm:gap-2 lg:px-8">
          {/* Phones have no side rail, so the logo (home) sits here. */}
          <Link
            prefetch={false}
            href="/"
            aria-label="VR Prime Ops, Command Deck"
            className="focus-ring sp-glow font-display flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-sm font-semibold text-accent-ink max-[339px]:hidden min-[561px]:hidden"
          >
            VR
          </Link>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="focus-ring flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface/60 text-muted transition hover:border-accent/50 sm:hidden"
            aria-label="Search"
            aria-haspopup="dialog"
          >
            <SearchIcon className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="focus-ring hidden min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl border border-line bg-surface px-3 text-left text-sm text-faint transition hover:border-accent/50 sm:flex md:max-w-md"
            aria-label="Search (Ctrl K)"
            aria-haspopup="dialog"
          >
            <SearchIcon className="h-[18px] w-[18px] shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate">Search SKUs, orders, tickets</span>
            <kbd className="hidden shrink-0 rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted sm:block">Ctrl K</kbd>
          </button>

          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-3">
            <SyncControl since={syncedAt} scope={scope} canSync={user.role !== "warehouse"} />
            <Link
              prefetch={false}
              href="/posts/new"
              aria-label="New post"
              className="focus-ring sp-glow flex h-11 w-11 items-center justify-center gap-1.5 rounded-xl bg-accent text-sm font-bold text-accent-ink transition hover:brightness-110 sm:w-auto sm:px-4"
            >
              <PlusIcon className="h-5 w-5" />
              <span className="hidden sm:inline">Post</span>
            </Link>
            <AlertBell unread={unread} />
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
