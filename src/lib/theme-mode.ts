// The colour mode the person chose: Light, Dark, or Auto (follow the phone or computer). Kept in a plain cookie so the
// server can paint the right mode on the very first frame. Nothing here is secret, so the cookie is not httpOnly and
// the browser sets it itself when the switch is used.

export const THEME_COOKIE = "vr-theme";

export type ThemeMode = "light" | "dark" | "auto";

/** Anything that is not exactly "light" or "dark" (no cookie, an old value, tampering) means Auto. */
export function readThemeMode(value: string | null | undefined): ThemeMode {
  return value === "light" || value === "dark" ? value : "auto";
}
