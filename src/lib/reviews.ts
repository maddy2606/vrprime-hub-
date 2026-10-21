/**
 * The Review tracker's arithmetic: written reviews (not star ratings) per VRPRIME listing, one check against another.
 * Pure, so the page and the tests share it.
 */

export type ReviewPlatform = "Flipkart" | "Shopsy";

export type ReviewLink = {
  rowNo: number;
  platform: ReviewPlatform;
  product: string;
  sku: string;
  url: string;
  /** Priority on Aman's sheet: 1 to 7, and 8 for "Last". */
  priority: number | null;
  /** Written reviews the listing is aiming for. */
  target: number | null;
  /** The row whose reviews this listing also shows (Flipkart shows one set on several listings), or null. */
  sharesWith: number | null;
};

export type ReviewStatus = "Dropped" | "Gained" | "No change" | "Not checked" | "New";

export type ReviewLine = ReviewLink & {
  /** Written reviews in the chosen check; null when the page could not be read. */
  reviews: number | null;
  /** The same in the check it is compared with; null when there was none. */
  before: number | null;
  change: number | null;
  status: ReviewStatus;
};

export type ReviewTotals = {
  /** Every listing that was read, shared listings counted once. */
  reviews: number;
  /** The same listings in the earlier check, so the change compares like with like. */
  before: number;
  change: number;
  byPlatform: Record<ReviewPlatform, { reviews: number; before: number; change: number }>;
  dropped: number;
  gained: number;
  notChecked: number;
};

const statusOf = (now: number | null, before: number | null): ReviewStatus => {
  if (now == null) return "Not checked";
  if (before == null) return "New";
  return now < before ? "Dropped" : now > before ? "Gained" : "No change";
};

/** One line per link for a check, compared with an earlier check. */
export function reviewLines(links: ReviewLink[], now: Map<number, number | null>, before: Map<number, number | null> | null): ReviewLine[] {
  return links.map((l) => {
    const reviews = now.get(l.rowNo) ?? null;
    const was = before?.get(l.rowNo) ?? null;
    return { ...l, reviews, before: was, change: reviews != null && was != null ? reviews - was : null, status: statusOf(reviews, was) };
  });
}

/**
 * Totals for the headline. A listing that shares another's reviews is left out of the sums, and so is any listing
 * missing from either check, so the change is never inflated by a page that failed to load.
 */
export function reviewTotals(lines: ReviewLine[]): ReviewTotals {
  const byPlatform: ReviewTotals["byPlatform"] = { Flipkart: { reviews: 0, before: 0, change: 0 }, Shopsy: { reviews: 0, before: 0, change: 0 } };
  let reviews = 0;
  let before = 0;
  for (const l of lines) {
    if (l.sharesWith != null || l.reviews == null) continue;
    reviews += l.reviews;
    byPlatform[l.platform].reviews += l.reviews;
    // A listing with no earlier count (new since then) counts in full as change.
    if (l.before != null) {
      before += l.before;
      byPlatform[l.platform].before += l.before;
    }
  }
  for (const p of Object.keys(byPlatform) as ReviewPlatform[]) byPlatform[p].change = byPlatform[p].reviews - byPlatform[p].before;
  return {
    reviews,
    before,
    change: reviews - before,
    byPlatform,
    dropped: lines.filter((l) => l.status === "Dropped").length,
    gained: lines.filter((l) => l.status === "Gained").length,
    notChecked: lines.filter((l) => l.status === "Not checked").length,
  };
}

/** Written reviews still needed to reach the sheet's target: 0 once there, null with no target or no count. */
export function toGo(l: ReviewLine): number | null {
  if (!l.target || l.target <= 0 || l.reviews == null) return null;
  return Math.max(0, l.target - l.reviews);
}

export type TargetProgress = {
  /** Reviews counted towards targets, each listing capped at its own target, so one listing over target can't hide another short of it. */
  have: number;
  target: number;
  /** Links with a target, and how many have reached it. */
  links: number;
  atTarget: number;
};

const progressOf = (lines: ReviewLine[]): TargetProgress => {
  const withTarget = lines.filter((l) => l.target != null && l.target > 0);
  return {
    have: withTarget.reduce((n, l) => n + Math.min(l.reviews ?? 0, l.target ?? 0), 0),
    target: withTarget.reduce((n, l) => n + (l.target ?? 0), 0),
    links: withTarget.length,
    atTarget: withTarget.filter((l) => (l.reviews ?? 0) >= (l.target ?? 0)).length,
  };
};

/** How far every link is towards its target, all added up. Each listing counts against its own target, shared or not. */
export function targetProgress(lines: ReviewLine[]): TargetProgress {
  return progressOf(lines);
}

/** The same per priority on Aman's sheet (0 for links with none), 1 first and "Last" (8) at the end. */
export function priorityProgress(lines: ReviewLine[]): (TargetProgress & { priority: number })[] {
  const groups = new Map<number, ReviewLine[]>();
  for (const l of lines) groups.set(l.priority ?? 0, [...(groups.get(l.priority ?? 0) ?? []), l]);
  return [...groups.entries()].sort(([a], [b]) => (a || 99) - (b || 99)).map(([priority, ls]) => ({ priority, ...progressOf(ls) }));
}

/**
 * Links short of their target, nearest first (the quick wins) or furthest first. Links that were not read this check
 * are left out: their distance isn't known.
 */
export function byDistanceToTarget(lines: ReviewLine[], order: "nearest" | "furthest"): ReviewLine[] {
  const dir = order === "nearest" ? 1 : -1;
  return lines.filter((l) => (toGo(l) ?? 0) > 0).sort((a, b) => dir * ((toGo(a) ?? 0) - (toGo(b) ?? 0)) || a.rowNo - b.rowNo);
}

/** The order the table opens in: drops first (biggest loss first), then links not read, then gains (biggest first), then the rest. */
export function sortForAttention(lines: ReviewLine[]): ReviewLine[] {
  const rank: Record<ReviewStatus, number> = { Dropped: 0, "Not checked": 1, Gained: 2, New: 3, "No change": 4 };
  return [...lines].sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      (a.status === "Dropped" ? (a.change ?? 0) - (b.change ?? 0) : (b.change ?? 0) - (a.change ?? 0)) ||
      a.rowNo - b.rowNo,
  );
}
