import "server-only";
import { revalidatePath } from "next/cache";
import { todayIST } from "@/lib/format";
import { isUnratedProductPage, readReviewCount, reviewsPageUrl } from "@/lib/review-count";
import { logError } from "@/lib/redact";
import { serverDb } from "@/server/service-db";

/**
 * The Review tracker's Sync: opens every watched link's reviews page from the site (Mumbai), reads the written reviews
 * and saves them as today's check (India date), replacing any check saved earlier today. A link that can't be read is
 * saved as "not read" (null), never as 0, so a page that failed to load never looks like reviews were removed.
 *
 * Runs from the Sync now button (owner and admin) and by itself every 5 days (private.start_review_auto_sync).
 */

export type ReviewSyncResult = { ok: boolean; text: string; read?: number; missed?: number[] };

type Link = { row_no: number; sku: string; url: string };

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-IN,en;q=0.9",
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One page's HTML, retried once after a pause when the site says it is busy (429 / 503). */
async function page(url: string, deadline: number): Promise<{ status: number; html: string } | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const left = deadline - Date.now();
    if (left < 2_000) return null;
    try {
      const res = await fetch(url, { headers: HEADERS, redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(Math.min(15_000, left)) });
      const html = await res.text();
      if ((res.status === 429 || res.status === 503) && attempt === 0) {
        await wait(4_000);
        continue;
      }
      return { status: res.status, html };
    } catch {
      if (attempt === 0) await wait(1_500);
    }
  }
  return null;
}

/** Written reviews on one link, or null when it couldn't be read. */
async function countFor(link: Link, deadline: number): Promise<number | null> {
  const reviews = await page(reviewsPageUrl(link.url), deadline);
  const n = reviews?.status === 200 ? readReviewCount(reviews.html) : null;
  if (n != null) return n;
  // No counts on the reviews page: the product page either has them, or has no ratings at all.
  const product = await page(link.url, deadline);
  if (!product || product.status !== 200) return null;
  return readReviewCount(product.html) ?? (isUnratedProductPage(product.html, link.sku) ? 0 : null);
}

export async function syncReviews(deadline: number, note: string): Promise<ReviewSyncResult> {
  const db = serverDb();
  if (!db) return { ok: false, text: "The site is missing its database key, so Sync can't save." };
  const { data, error } = await db.from("review_links").select("row_no, sku, url").eq("active", true).order("row_no");
  if (error) {
    logError("read the review links", error);
    return { ok: false, text: "Could not read the links. Try again." };
  }
  const links = (data ?? []) as Link[];
  if (!links.length) return { ok: false, text: "There are no links to check." };

  // Two at a time with a pause between pages, Flipkart and Shopsy mixed, so neither site sees a burst.
  const counts = new Map<number, number | null>();
  const queue = [...links];
  await Promise.all(
    Array.from({ length: 2 }, async () => {
      for (let link = queue.shift(); link; link = queue.shift()) {
        counts.set(link.row_no, await countFor(link, deadline));
        await wait(400);
      }
    }),
  );
  return saveCounts(links.map((l) => l.row_no), counts, note);
}

/**
 * Saves counts as today's check (India date). A link with no count keeps the count today's check already has, so a
 * partial sync only adds to what is known and never wipes it. Used by Sync now, the automatic sync and /api/reviews/save
 * (counts read in the owner's own browser).
 */
export async function saveCounts(rowNos: number[], counts: Map<number, number | null>, note: string): Promise<ReviewSyncResult> {
  const db = serverDb();
  if (!db) return { ok: false, text: "The site is missing its database key, so it can't save." };
  const read = rowNos.filter((r) => counts.get(r) != null);
  const missed = rowNos.filter((r) => counts.get(r) == null);
  if (read.length === 0) return { ok: false, text: "No link could be read, so nothing was saved. Flipkart and Shopsy may be blocking the site. Try again later.", read: 0, missed };

  const day = todayIST();
  const { data: existing } = await db.from("review_checks").select("id").eq("checked_on", day).maybeSingle();
  let checkId = (existing as { id: string } | null)?.id ?? null;
  if (!checkId) {
    const { data: made, error: cErr } = await db.from("review_checks").insert({ checked_on: day, note }).select("id").single();
    if (cErr || !made) {
      logError("save the review check", cErr ?? { message: "no id" });
      return { ok: false, text: "The counts were read but could not be saved. Try again." };
    }
    checkId = (made as { id: string }).id;
  }
  // New check: every link, null where not read. Today's check already there: only the links read now change.
  const rows = (existing ? read : rowNos).map((r) => ({ check_id: checkId, row_no: r, reviews: counts.get(r) ?? null }));
  const { error: rErr } = await db.from("review_counts").upsert(rows, { onConflict: "check_id,row_no" });
  if (rErr) {
    logError("save the review counts", rErr);
    return { ok: false, text: "The counts were read but could not be saved. Try again." };
  }
  await db.from("review_checks").update({ note: existing ? `${note} (updated)` : note }).eq("id", checkId);
  try {
    revalidatePath("/reviews");
  } catch {
    // Outside a request (the automatic run) there is no cache to clear; the page reads fresh data anyway.
  }
  const kept = existing && missed.length ? ` The other ${missed.length} keep today's earlier count.` : missed.length ? ` ${missed.length} not read.` : "";
  return { ok: true, text: `Updated ${read.length} of ${rowNos.length} links.${kept}`, read: read.length, missed };
}
