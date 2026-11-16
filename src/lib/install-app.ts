// "Get the app" (shell): when to offer installing VR Prime Ops, and how. Pure, so it can be tested without a browser.

/** localStorage: "Not now" hides the card until this time (ms). */
export const HIDE_KEY = "vr-install-hidden-until";
export const HIDE_DAYS = 30;
/** localStorage: set once the browser reports the app installed from this browser. */
export const INSTALLED_KEY = "vr-installed";
/** Fired on window by the early script whenever the saved install event changes. */
export const INSTALL_CHANGE = "vr-install-change";

/**
 * Runs from the page's <head>, before React loads: Chrome and Edge fire `beforeinstallprompt` once per page load, often
 * before the rail has hydrated, so the event is kept on `window.__vrInstall` for the rail to read whenever it is ready.
 */
export const INSTALL_EARLY_SCRIPT = `(function(){var w=window;w.__vrInstall=null;function tell(){w.dispatchEvent(new Event("${INSTALL_CHANGE}"))}w.addEventListener("beforeinstallprompt",function(e){e.preventDefault();w.__vrInstall=e;tell()});w.addEventListener("appinstalled",function(){w.__vrInstall=null;try{localStorage.setItem("${INSTALLED_KEY}","1")}catch(_){}tell()})})();`;

/**
 * - none: inside the installed app, installed from this browser, "Not now" in the last 30 days, or a browser that
 *   cannot install (Firefox, desktop Safari);
 * - prompt: Chrome or Edge has offered; the button opens its install prompt;
 * - steps: Chrome or Edge has not offered (yet); the card says where its install control is;
 * - ios: iPhone and iPad, Share › Add to Home Screen.
 */
export type InstallKind = "none" | "prompt" | "steps" | "ios";

export function installKind(o: { standalone: boolean; installed: boolean; hidden: boolean; ios: boolean; offered: boolean; chromium: boolean }): InstallKind {
  if (o.standalone || o.installed || o.hidden) return "none";
  if (o.ios) return "ios";
  if (o.offered) return "prompt";
  return o.chromium ? "steps" : "none";
}

/** Chrome, Edge and other Chromium browsers, which can install the site; not Firefox, not Safari. */
export function isChromium(userAgent: string, brands?: { brand: string }[]): boolean {
  if (brands?.length) return brands.some((b) => /Chromium|Google Chrome|Microsoft Edge/.test(b.brand));
  return /\b(Chrome|Chromium|Edg)\//.test(userAgent) && !/Firefox|FxiOS/.test(userAgent);
}
