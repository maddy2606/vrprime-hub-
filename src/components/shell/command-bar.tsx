"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ALERTS_COUNT_EVENT, ALERTS_OPEN_EVENT } from "@/components/alerts/alert-center";
import { BellIcon, PlusIcon, RefreshIcon, SearchIcon } from "@/components/icons";
import { CommandPalette } from "@/components/shell/command-palette";
import { UnreadBadge } from "@/components/ui";
import { formatDate, formatDateTime, todayIST } from "@/lib/format";
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

/** When the orders were last read, and how long ago: ticks every second, looks for a newer read every minute. */
function useSyncAge(since: string | null): { at: string | null; age: number | null } {
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

  return { at, age: at && now !== null ? now - Date.parse(at) : null };
}

/**
 * The rail's "Sync status" card (graphite-spec section 8): a 7px dot, green while the last order read is under 3 hours
 * old and amber after that (or with no read yet); "All syncs healthy" or "Orders sync needs a look"; "Orders read N ago
 * · scope"; and Sync now for the owner and admins. On the 72px rail it is just the dot, with a tooltip.
 */
export function SyncCard({ since, scope, canSync }: { since: string | null; scope: string; canSync: boolean }) {
  const { at, age } = useSyncAge(since);
  const healthy = Boolean(at) && (age === null || age <= 3 * 60 * 60_000);
  const status = healthy ? "All syncs healthy" : "Orders sync needs a look";
  const read = !at ? "Orders not read yet" : age === null ? "Orders read" : `Orders read ${ago(age)}`;
  const dot = `g-dot ${healthy ? "bg-ok" : "bg-warn-mark"}`;
  return (
    <>
      <div className="vr-rail-wide mt-4 rounded-[14px] border border-line bg-surface p-[14px]" role="status" aria-label={`Sync status: ${status}. ${read} · ${scope}`}>
        <p className="flex items-center gap-2 text-[13px] font-semibold text-ink">
          <span aria-hidden="true" className={dot} />
          Sync status
        </p>
        <p className={`mt-1.5 text-[12px] font-semibold leading-4 ${healthy ? "text-ok" : "text-warn"}`}>{status}</p>
        <p className="t-caption mt-0.5">
          {read} · {scope}
        </p>
        {canSync ? <SyncNowButton label={read} className="mt-3 !h-9 !min-h-9 w-full" /> : null}
      </div>
      <div className="vr-rail-narrow group relative mt-4 flex h-10 items-center justify-center" tabIndex={0} role="status" aria-label={`Sync status: ${status}. ${read} · ${scope}`}>
        <span aria-hidden="true" className={dot} />
        <span
          role="tooltip"
          className="sp-pop sp-tip pointer-events-none absolute bottom-0 left-[58px] z-50 whitespace-nowrap px-2.5 py-1.5 text-xs font-semibold text-ink opacity-0 transition-opacity duration-160 group-hover:opacity-100 group-focus-visible:opacity-100"
        >
          {status} · {read}
        </span>
      </div>
    </>
  );
}

/**
 * Phones only (graphite-spec section 8 keeps them where ui/glass put them): "Synced 42s ago · All warehouses" and, for
 * the owner and admins, the Sync now button, leading the page.
 */
export function SyncControl({ since, scope, canSync }: { since: string | null; scope: string; canSync: boolean }) {
  const { at, age } = useSyncAge(since);
  // Orders are read every 30 minutes in working hours; an hour with no read is worth a second look.
  const stale = age !== null && age > 60 * 60_000;
  const label = !at ? "Not synced yet" : age === null ? "Synced" : `Synced ${ago(age)}`;
  const dot = `g-dot ${stale || !at ? "bg-warn-mark" : "bg-ok"}`;
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 min-[700px]:hidden">
      <div className="t-caption flex min-w-0 items-center gap-2" role="status" aria-label={`${label}, ${scope}`}>
        <span aria-hidden="true" className={dot} />
        <span className="whitespace-nowrap">{label}</span>
        <span aria-hidden="true">·</span>
        <span className="truncate">{scope}</span>
      </div>
      {canSync ? <SyncNowButton label={label} /> : null}
    </div>
  );
}

/** "Sync now": one button for everything (VR Prime stock, Flipkart stock and orders). Owner and admin only. */
function SyncNowButton({ label: synced, className = "" }: { label: string; className?: string }) {
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
      className={`g-btn g-btn-secondary focus-ring shrink-0 ${className}`}
    >
      <RefreshIcon className={`h-[18px] w-[18px] ${state === "busy" ? "animate-spin" : ""}`} />
      {label}
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
      className="focus-ring relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted transition-colors duration-160 hover:bg-surface2 hover:text-ink"
    >
      <BellIcon className="h-5 w-5" />
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

/** Today's date and time with a 7px green dot, in India time (the top bar from 700px). */
function TopClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const first = window.setTimeout(() => setNow(new Date()), 0);
    const tick = window.setInterval(() => setNow(new Date()), 30_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(tick);
    };
  }, []);
  if (!now) return null;
  const time = formatDateTime(now.toISOString(), now).replace(/^Today /, "");
  return (
    <span className="hidden items-center gap-2 whitespace-nowrap text-[13px] text-muted min-[1100px]:flex">
      <span aria-hidden="true" className="g-dot bg-ok" />
      {formatDate(todayIST(now), todayIST(now))} · {time}
    </span>
  );
}

function AccountMenu({ name, role, sub, children }: { name: string; role: string; sub: string; children: ReactNode }) {
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
        className="focus-ring flex h-11 min-w-10 items-center gap-2.5 rounded-full text-left"
      >
        <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-panel2 text-[12px] font-bold text-ink">{initials(name)}</span>
        <span className="hidden min-w-0 pr-1 min-[1100px]:block">
          <span className="block max-w-[140px] truncate text-[13px] font-semibold leading-4 text-ink">{name}</span>
          <span className="block text-[11px] leading-[14px] text-muted">{role}</span>
        </span>
      </button>
      {open ? (
        <div className="sp-pop vr-sheet vr-pop absolute right-0 top-12 z-50 w-64 p-3" onClick={() => setOpen(false)}>
          <p className="truncate text-sm font-semibold">{name}</p>
          <p className="t-caption truncate">{sub}</p>
          <div className="mt-3 flex flex-col gap-2">{children}</div>
        </div>
      ) : null}
    </div>
  );
}

export function CommandBar({
  user,
  unread,
  menu,
}: {
  user: { name: string; role: Role; roleLabel: string; sub: string };
  unread: number;
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
      <header className="vr-bar sticky top-0 z-30 pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-14 w-full max-w-[1440px] items-center gap-2 px-3 min-[700px]:h-16 min-[700px]:gap-3 min-[700px]:px-4 min-[1100px]:px-7">
          {/* Phones have no side rail, so the mark (home) sits here. */}
          <Link
            prefetch={false}
            href="/"
            aria-label="VR Prime Ops, Command Centre"
            className="focus-ring relative flex h-[30px] w-[30px] shrink-0 after:absolute after:-inset-1.5 after:content-[''] items-center justify-center rounded-[9px] bg-accent font-display text-[12px] font-bold text-accent-ink min-[700px]:hidden"
          >
            VR
          </Link>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="focus-ring flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line-soft bg-surface2 text-muted transition-colors duration-160 hover:text-ink min-[700px]:hidden"
            aria-label="Search"
            aria-haspopup="dialog"
          >
            <SearchIcon className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="focus-ring hidden h-11 min-w-0 max-w-[420px] flex-1 items-center gap-3 rounded-full border border-line bg-surface px-4 text-left text-[13px] text-faint transition-colors duration-160 hover:text-muted min-[700px]:flex"
            aria-label="Search (Ctrl K)"
            aria-haspopup="dialog"
          >
            <SearchIcon className="h-[18px] w-[18px] shrink-0" />
            <span className="min-w-0 flex-1 truncate">Search SKUs, orders, tickets</span>
            <kbd className="g-chip font-mono">Ctrl K</kbd>
          </button>

          <div className="ml-auto flex shrink-0 items-center gap-2 min-[700px]:gap-3">
            <TopClock />
            <Link prefetch={false} href="/posts/new" aria-label="New post" className="g-btn g-btn-primary focus-ring !w-10 !px-0 min-[700px]:!w-auto min-[700px]:!px-4">
              <PlusIcon className="h-[18px] w-[18px]" />
              <span className="hidden min-[700px]:inline">Post</span>
            </Link>
            <AlertBell unread={unread} />
            <AccountMenu name={user.name} role={user.roleLabel} sub={user.sub}>
              {menu}
            </AccountMenu>
          </div>
        </div>
      </header>
      <CommandPalette open={open} onClose={() => setOpen(false)} role={user.role} />
    </>
  );
}
