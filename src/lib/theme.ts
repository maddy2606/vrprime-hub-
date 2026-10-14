// SIGNAL PRO design tokens, for code that cannot read CSS variables (the canvas charts).
// The CSS in src/app/globals.css is the source of truth for everything else; keep the two in step.

export const COLOR = {
  bg: "#07070c",
  panel: "#0f0f18",
  panel2: "#0c0c14",
  raised: "#14141f",
  line: "#23222f",
  lineSoft: "#191824",
  fg: "#f3f2f9",
  muted: "#9b99b2",
  faint: "#615f78",
  violet: "#8b5cf6",
  violetSoft: "#191233",
  cyan: "#3fe0e0",
  danger: "#ff4d67",
  dangerBg: "#2a0e18",
  warn: "#ffb020",
  warnBg: "#2a1d08",
  ok: "#35e0a0",
  okBg: "#0c2619",
} as const;

export type SignalTone = "bad" | "warn" | "ok" | "accent" | "cyan" | "neutral";

/** The colour for a semantic tone. */
export const TONE_COLOR: Record<SignalTone, string> = {
  bad: COLOR.danger,
  warn: COLOR.warn,
  ok: COLOR.ok,
  accent: COLOR.violet,
  cyan: COLOR.cyan,
  neutral: COLOR.muted,
};
