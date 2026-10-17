// Browser only: apply a colour mode to the page now and remember it. Called from the theme switch's click handler.
// Kept out of the component because it writes to document, and out of theme-mode.ts because the server imports that.
import { THEME_COOKIE, type ThemeMode } from "./theme-mode.ts";

const YEAR = 60 * 60 * 24 * 365;

/** Light and Dark set data-theme on <html> and save a cookie for a year; Auto removes both so the device decides. */
export function applyThemeMode(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === "auto") {
    root.removeAttribute("data-theme");
    document.cookie = `${THEME_COOKIE}=; path=/; max-age=0; samesite=lax`;
    return;
  }
  root.setAttribute("data-theme", mode);
  document.cookie = `${THEME_COOKIE}=${mode}; path=/; max-age=${YEAR}; samesite=lax`;
}
