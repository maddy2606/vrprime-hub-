"use client";

import { useSyncExternalStore } from "react";
import { isIos, isStandalone } from "@/lib/push-client";

/** Chrome and Edge's install event (not in the TypeScript DOM types). */
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

const HIDE_KEY = "vr-install-hidden-until";
const HIDE_DAYS = 30;

type InstallState = { kind: "none" } | { kind: "prompt"; event: InstallEvent } | { kind: "ios" };

function hiddenForNow(): boolean {
  try {
    return Number(localStorage.getItem(HIDE_KEY) ?? 0) > Date.now();
  } catch {
    return false;
  }
}

// Chrome fires its install event once per page load, often before a menu that wants it has opened, so the page keeps
// it here and every card or row reads the same copy.
const NONE: InstallState = { kind: "none" };
let current: InstallState = NONE;
let started = false;
const listeners = new Set<() => void>();
const set = (next: InstallState) => {
  current = next;
  listeners.forEach((l) => l());
};

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  if (isStandalone() || hiddenForNow()) return;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // keep Chrome's own mini-bar away; the card asks instead
    set({ kind: "prompt", event: e as InstallEvent });
  });
  window.addEventListener("appinstalled", () => set(NONE));
  if (isIos()) set({ kind: "ios" });
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Whether the app can be installed here, and how. Chrome and Edge (desktop and Android) fire `beforeinstallprompt`
 * when the site is installable and not installed yet; iPhone Safari has no such event, so it gets the Share › Add to
 * Home Screen steps. Nothing shows inside the installed app, after "Not now" (for 30 days), or in other browsers.
 */
export function useInstallApp() {
  const state = useSyncExternalStore(subscribe, () => current, () => NONE);

  const install = async () => {
    if (state.kind !== "prompt") return;
    await state.event.prompt();
    await state.event.userChoice;
    // The event works once; after a "No", Chrome offers it again on a later visit.
    set(NONE);
  };

  const notNow = () => {
    try {
      localStorage.setItem(HIDE_KEY, String(Date.now() + HIDE_DAYS * 86_400_000));
    } catch {
      // storage blocked: hide for this visit only
    }
    set(NONE);
  };

  return { state, install, notNow };
}

/** A small flat phone with bars, in the product colours (no glow, graphite-spec section 1). */
function PhoneArt() {
  return (
    <svg viewBox="0 0 44 72" aria-hidden="true" className="h-[72px] w-[44px] shrink-0">
      <rect x="1" y="1" width="42" height="70" rx="8" fill="var(--surface2)" stroke="var(--line)" strokeWidth="1.5" />
      <rect x="17" y="5" width="10" height="2.5" rx="1.25" fill="var(--line)" />
      {[
        [8, 40, "var(--stage-1)"],
        [13, 30, "var(--wh-1)"],
        [18, 34, "var(--stage-1)"],
        [23, 20, "var(--accent)"],
        [28, 26, "var(--cyan)"],
        [33, 16, "var(--wh-1)"],
      ].map(([x, y, fill]) => (
        <rect key={x as number} x={x as number} y={y as number} width="3.2" height={60 - (y as number)} rx="1.6" fill={fill as string} />
      ))}
      <rect x="8" y="62" width="28" height="1.5" rx="0.75" fill="var(--line)" />
    </svg>
  );
}

function IosSteps() {
  return <p className="t-caption mt-1">In Safari, tap Share, then Add to Home Screen.</p>;
}

/** The rail's install card (from 1100 px), above Sync status; on the 72 px rail just an icon button. */
export function InstallAppCard() {
  const { state, install, notNow } = useInstallApp();
  if (state.kind === "none") return null;
  return (
    <>
      <div className="vr-rail-wide mt-4 flex gap-3 rounded-[14px] border border-line bg-surface p-[14px]">
        <PhoneArt />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-ink">Get the app</p>
          <p className="t-caption mt-0.5">Open it like an app, on this computer or your phone.</p>
          {state.kind === "ios" ? (
            <IosSteps />
          ) : (
            <button type="button" onClick={install} className="focus-ring mt-2 text-[13px] font-semibold text-accent-text hover:underline">
              Install app →
            </button>
          )}
          <button type="button" onClick={notNow} className="focus-ring mt-1 block text-[12px] text-muted hover:underline">
            Not now
          </button>
        </div>
      </div>
      {state.kind === "prompt" ? (
        <div className="vr-rail-narrow group relative mt-4 flex justify-center">
          <button type="button" onClick={install} aria-label="Install the app" className="focus-ring flex h-10 w-10 items-center justify-center rounded-[11px] text-muted hover:bg-panel2">
            <InstallIcon className="h-[18px] w-[18px]" />
          </button>
          <span
            role="tooltip"
            className="sp-pop sp-tip pointer-events-none absolute bottom-0 left-[58px] z-50 whitespace-nowrap px-2.5 py-1.5 text-xs font-semibold text-ink opacity-0 transition-opacity duration-160 group-hover:opacity-100 group-focus-within:opacity-100"
          >
            Install the app
          </span>
        </div>
      ) : null}
    </>
  );
}

/** Phones: one row at the bottom of the More sheet. */
export function InstallAppRow({ onDone }: { onDone: () => void }) {
  const { state, install } = useInstallApp();
  if (state.kind === "none") return null;
  return (
    <div className="sp-inner mt-2 flex items-center gap-3 px-3.5 py-3">
      <InstallIcon className="h-5 w-5 shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">Install the app</p>
        {state.kind === "ios" ? <IosSteps /> : <p className="t-caption mt-0.5">Opens full screen from your home screen.</p>}
      </div>
      {state.kind === "prompt" ? (
        <button
          type="button"
          onClick={async () => {
            await install();
            onDone();
          }}
          className="focus-ring h-10 shrink-0 rounded-[12px] bg-accent px-4 text-[12px] font-semibold text-accent-ink"
        >
          Install
        </button>
      ) : null}
    </div>
  );
}

/** Download-to-device arrow, 24 px stroke style like the other icons. */
function InstallIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M12 3v11M7.5 9.5L12 14l4.5-4.5M5 15v3a2 2 0 002 2h10a2 2 0 002-2v-3" />
    </svg>
  );
}
