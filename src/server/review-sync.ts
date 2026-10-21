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

  // A few at a time, Flipkart and Shopsy mixed, so neither site sees a burst.
  const counts = new Map<number, number | null>();
  const queue = [...links];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let link = queue.shift(); link; link = queue.shift()) counts.set(link.row_no, await countFor(link, deadline));
    }),
  );

  const missed = links.filter((l) => counts.get(l.row_no) == null).map((l) => l.row_no);
  const read = links.length - missed.length;
  if (read === 0) return { ok: false, text: "Flipkart and Shopsy didn't answer, so nothing was saved. Try again later.", read, missed };

  const day = todayIST();
  const { error: dErr } = await db.from("review_checks").delete().eq("checked_on", day);
  const { data: check, error: cErr } = dErr
    ? { data: null, error: dErr }
    : await db.from("review_checks").insert({ checked_on: day, note: missed.length ? `${note}; ${missed.length} not read` : note }).select("id").single();
  if (cErr || !check) {
    logError("save the review check", cErr ?? { message: "no id" });
    return { ok: false, text: "The counts were read but could not be saved. Try again." };
  }
  const rows = links.map((l) => ({ check_id: (check as { id: string }).id, row_no: l.row_no, reviews: counts.get(l.row_no) ?? null }));
  const { error: rErr } = await db.from("review_counts").insert(rows);
  if (rErr) {
    logError("save the review counts", rErr);
    return { ok: false, text: "The counts were read but could not be saved. Try again." };
  }
  try {
    revalidatePath("/reviews");
  } catch {
    // Outside a request (the automatic run) there is no cache to clear; the page reads fresh data anyway.
  }
  return {
    ok: true,
    text: missed.length ? `Synced ${read} of ${links.length} links. Not read: rows ${missed.join(", ")}.` : `Synced all ${links.length} links.`,
    read,
    missed,
  };
}
