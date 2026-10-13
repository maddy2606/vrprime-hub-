// The period the Money page looks at. "Last 30 days" ends on the latest day money was settled, not on today:
// Flipkart's reports are always behind, so counting back from today would mostly show an empty month.
import { addDays } from "../format.ts";

export const PRESETS = [7, 30, 90] as const;
export type Period = { from: string; to: string; preset: number | null };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Reads ?range=7|30|90 or ?from=&to= (custom). `latest` is the last settlement day we hold. */
export function readPeriod(sp: { range?: string; from?: string; to?: string }, latest: string | null, today: string): Period {
  const end = latest ?? today;
  if (sp.from && sp.to && DAY.test(sp.from) && DAY.test(sp.to) && sp.from <= sp.to) {
    return { from: sp.from, to: sp.to, preset: null };
  }
  const days = PRESETS.find((p) => String(p) === sp.range) ?? 30;
  return { from: addDays(end, -(days - 1)), to: end, preset: days };
}
