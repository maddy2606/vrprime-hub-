// New-listing requests: the weight check and how a done request is shown against Flipkart. Pure functions
// (no database, no React) so the tests can run them. Relative imports with .ts on purpose.
import { weightMetric } from "./stock-analysis.ts";

/** A request not found on Flipkart this many days after it was marked done is flagged. */
export const NOT_FOUND_DAYS = 3;

export type WeightCheck = {
  /** L x B x H in cm. */
  volume: number;
  grams: number;
  total: number;
  limit: number;
  over: boolean;
  overBy: number;
};

function positive(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Size (cm) and weight (kg) against the weight limit: L x B x H plus the weight in grams, the same sum as Listing
 * health. Needs all four numbers; null when one is missing.
 */
export function checkWeight(l: unknown, b: unknown, h: unknown, kg: unknown, limit: number): WeightCheck | null {
  const dl = positive(l);
  const db = positive(b);
  const dh = positive(h);
  const w = positive(kg);
  if (dl === null || db === null || dh === null || w === null) return null;
  const m = weightMetric({ l: dl, b: db, h: dh, kg: w });
  return { ...m, limit, over: m.total > limit, overBy: Math.round(m.total - limit) };
}

export function weightWarning(check: WeightCheck): string {
  const n = (v: number) => Math.round(v).toLocaleString("en-IN");
  return `${n(check.volume)} (size) + ${n(check.grams)} g = ${n(check.total)}, over the limit of ${n(check.limit)} by ${n(check.overBy)}. Check the package before you list it.`;
}

export type LiveFields = {
  status: string;
  done_at: string | null;
  sku: string | null;
  live_found: boolean | null;
  live_status: string | null;
  live_since: string | null;
  live_alerted_at: string | null;
  live_over_weight: boolean | null;
};

export type LiveState =
  | { kind: "no_sku" }
  | { kind: "not_checked" }
  | { kind: "live"; since: string | null; active: boolean; overWeight: boolean }
  | { kind: "not_found"; late: boolean };

/** Whole days from one instant to another (floor). */
export function daysSince(iso: string, now: Date): number {
  return Math.floor((now.getTime() - Date.parse(iso)) / 86_400_000);
}

export function liveState(post: LiveFields, now: Date = new Date()): LiveState {
  if (!post.sku) return { kind: "no_sku" };
  if (post.live_found === true) {
    return { kind: "live", since: post.live_since, active: post.live_status === "ACTIVE", overWeight: post.live_over_weight === true };
  }
  if (post.live_found === false) {
    const late = Boolean(post.done_at) && daysSince(post.done_at as string, now) >= NOT_FOUND_DAYS;
    return { kind: "not_found", late };
  }
  return { kind: "not_checked" };
}

/** The line shown on the post. */
export function liveLine(state: LiveState, formatDate: (iso: string) => string): string | null {
  switch (state.kind) {
    case "live":
      return `Live on Flipkart ✓${state.since ? ` since ${formatDate(state.since)}` : ""} · ${state.active ? "Active" : "Inactive"}`;
    case "not_found":
      return "Not found on Flipkart yet";
    case "not_checked":
      return "Will be checked at the next daily stock sync";
    default:
      return null;
  }
}

/** One SKU: text, trimmed, nothing odd inside. Returns the trimmed SKU, or an error message. */
export function cleanSku(raw: unknown): { ok: true; sku: string } | { ok: false; message: string } {
  const sku = typeof raw === "string" ? raw.trim() : "";
  if (!sku) return { ok: false, message: "Enter the SKU" };
  if (sku.length > 120) return { ok: false, message: "Keep the SKU under 120 characters" };
  if (/[\r\n\t]/.test(sku)) return { ok: false, message: "A SKU cannot contain line breaks or tabs" };
  return { ok: true, sku };
}
