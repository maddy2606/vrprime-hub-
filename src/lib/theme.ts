// Chart colours, as CSS variable references. The hex values live in one place, src/app/globals.css, in two sets
// (light, and dark under data-theme="dark" or an Auto phone in dark mode), so every chart follows the chosen mode
// with no JavaScript. Use these only where a style or SVG attribute takes a CSS colour.

export const COLOR = {
  bg: "var(--canvas)",
  panel: "var(--surface)",
  panel2: "var(--panel2)",
  raised: "var(--surface2)",
  line: "var(--line)",
  lineSoft: "var(--line-soft)",
  fg: "var(--ink)",
  muted: "var(--muted)",
  faint: "var(--faint)",
  indigo: "var(--accent)",
  indigoSoft: "var(--accent-soft)",
  madder: "var(--madder)",
  cyan: "var(--cyan)",
  danger: "var(--bad)",
  dangerBg: "var(--bad-soft)",
  /** For marks (bars, dots). The "warn" text colour is a darker brown that reads as a bar only poorly. */
  warn: "var(--warn-mark)",
  warnBg: "var(--warn-soft)",
  ok: "var(--ok)",
  okBg: "var(--ok-soft)",
} as const;

export type SignalTone = "bad" | "warn" | "ok" | "accent" | "cyan" | "neutral";

/** The colour for a semantic tone. */
export const TONE_COLOR: Record<SignalTone, string> = {
  bad: COLOR.danger,
  warn: COLOR.warn,
  ok: COLOR.ok,
  accent: COLOR.indigo,
  cyan: COLOR.cyan,
  neutral: COLOR.muted,
};

/**
 * One colour per warehouse, in this fixed order (the --wh-1..5 variables). The order is what keeps neighbours apart for
 * colour-blind readers in stacked and side-by-side charts: validated in both modes (light: adjacent ΔE 18.8 for
 * deutan/protan, 22 normal vision; dark: 14.9 and 18.6), all >= 3:1 on the card. Never cycle past five: a sixth
 * warehouse needs a new validated slot, not a repeat.
 */
export const WAREHOUSE_SERIES = ["var(--wh-1)", "var(--wh-2)", "var(--wh-3)", "var(--wh-4)", "var(--wh-5)"] as const;

const BY_NAME: Record<string, number> = { bangalore: 0, bhiwandi: 1, delhi: 2, kolkata: 3, lucknow: 4 };

/**
 * A warehouse's colour follows the warehouse, never its position in a list: the five known warehouses are pinned by
 * name, so a warehouse user who sees only two of them still sees each in its usual colour. Anything else falls back
 * to its place in the full list.
 */
export function warehouseColor(name: string, index: number): string {
  const pinned = BY_NAME[name.trim().toLowerCase()];
  return WAREHOUSE_SERIES[pinned ?? Math.max(0, index) % WAREHOUSE_SERIES.length];
}

/** Order stages as one indigo ramp, light to dark as the order moves along (validated as an ordinal ramp, both modes). */
export const STAGE_COLOR = { to_accept: "var(--stage-1)", to_pack: "var(--stage-2)", to_dispatch: "var(--stage-3)" } as const;
