"use client";

import { useSyncExternalStore } from "react";
import { HIDE_DAYS, HIDE_KEY, INSTALL_CHANGE, INSTALLED_KEY, installKind, isChromium } from "@/lib/install-app";
import { isIos, isStandalone } from "@/lib/push-client";

/** Chrome and Edge's install event (not in the TypeScript DOM types). */
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
/** Where the early script in the root layout keeps the event (see INSTALL_EARLY_SCRIPT). */
type InstallWindow = Window & { __vrInstall?: InstallEvent | null };

type InstallState = { kind: "none" } | { kind: "prompt"; event: InstallEvent } | { kind: "steps" } | { kind: "ios" };

const NONE: InstallState = { kind: "none" };
const STEPS: InstallState = { kind: "steps" };
const IOS: InstallState = { kind: "ios" };

const stored = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage blocked: as if never set
  }
};
/** "Not now" for this visit only, when storage is blocked. */
let hiddenThisVisit = false;

/** The state from the browser as it is now; the same object while nothing changed, as useSyncExternalStore needs. */
function read(): InstallState {
  const w = window as InstallWindow;
  const nav = navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } };
  const kind = installKind({
    standalone: isStandalone(),
    installed: stored(INSTALLED_KEY) === "1",
    hidden: hiddenThisVisit || Number(stored(HIDE_KEY) ?? 0) > Date.now(),
    ios: isIos(),
    offered: Boolean(w.__vrInstall),
    chromium: isChromium(navigator.userAgent, nav.userAgentData?.brands),
  });
  if (kind === "prompt") return current.kind === "prompt" && current.event === w.__vrInstall ? current : { kind: "prompt", event: w.__vrInstall! };
  return kind === "steps" ? STEPS : kind === "ios" ? IOS : NONE;
}

// One copy for the rail card and the More-sheet row.
let current: InstallState = NONE;
let started = false;
const listeners = new Set<() => void>();
const refresh = () => {
  const next = read();
  if (next === current) return;
  current = next;
  listeners.forEach((l) => l());
};

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  const w = window as InstallWindow;
  // Normally the early script has been listening since the page began loading; if it is missing, listen from here.
  if (!("__vrInstall" in w)) {
    w.__vrInstall = null;
    w.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault(); // keep Chrome's own mini-bar away; the card asks instead
      w.__vrInstall = e as InstallEvent;
      refresh();
    });
    w.addEventListener("appinstalled", () => {
      w.__vrInstall = null;
      try {
        localStorage.setItem(INSTALLED_KEY, "1");
      } catch {
        // storage blocked: hidden for this visit by display-mode once it opens as an app
      }
      refresh();
    });
  }
  w.addEventListener(INSTALL_CHANGE, refresh);
  current = read();
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Whether to offer installing the app here, and how (see installKind): Chrome's own prompt once it has offered, the
 * steps to its install control until then, Share › Add to Home Screen on iPhone, nothing in the installed app, after
 * "Not now" (30 days) or in Firefox.
 */
export function useInstallApp() {
  const state = useSyncExternalStore(subscribe, () => current, () => NONE);

  const install = async () => {
    if (state.kind !== "prompt") return;
    await state.event.prompt();
    await state.event.userChoice;
    // The event works once; after a "No" the card shows the steps, and Chrome offers again on a later visit.
    (window as InstallWindow).__vrInstall = null;
    refresh();
  };

  const notNow = () => {
    hiddenThisVisit = true;
    try {
      localStorage.setItem(HIDE_KEY, String(Date.now() + HIDE_DAYS * 86_400_000));
    } catch {
      // storage blocked: hidden for this visit only
    }
    refresh();
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

/** Chrome or Edge, before (or without) its install offer. */
function BrowserSteps() {
  return <p className="t-caption mt-1">In Chrome or Edge, click the install icon at the right of the address bar, or open the ⋮ menu › Cast, save and share › Install page as app.</p>;
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
          ) : state.kind === "steps" ? (
            <BrowserSteps />
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
        {state.kind === "ios" ? <IosSteps /> : state.kind === "steps" ? <BrowserSteps /> : <p className="t-caption mt-0.5">Opens full screen from your home screen.</p>}
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
