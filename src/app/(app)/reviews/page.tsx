import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReviewTracker, type ReviewsView } from "@/components/reviews/review-tracker";
import { canManage, requireUser } from "@/lib/auth";
import { reviewLines, type ReviewLink, type ReviewPlatform } from "@/lib/reviews";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Review tracker" };

// The tables are newer than the generated types.
type Loose = { from: (table: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
type DbErr = { code?: string; message?: string } | null;

/** The tables are not there yet: the migration has not been applied to this database. */
const missingTable = (e: DbErr) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache/i.test(e.message ?? ""));

type LinkRow = { row_no: number; platform: ReviewPlatform; product: string; sku: string; url: string; shares_with: number | null };
type CheckRow = { id: string; checked_on: string; note: string | null; created_at: string };
type CountRow = { check_id: string; row_no: number; reviews: number | null };

/** Written reviews on every VRPRIME Flipkart and Shopsy link, one check against the one before. Owner and admin. */
export default async function ReviewsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  if (!canManage(user)) notFound();
  const db = (await createClient()) as unknown as Loose;
  const sp = await searchParams;

  const [linkRes, checkRes] = await Promise.all([
    db.from("review_links").select("row_no, platform, product, sku, url, shares_with").eq("active", true).order("row_no"),
    db.from("review_checks").select("id, checked_on, note, created_at").order("checked_on", { ascending: false }).limit(200),
  ]);
  if (missingTable(linkRes.error) || missingTable(checkRes.error)) return <ReviewTracker view={null} />;

  const links: ReviewLink[] = ((linkRes.data ?? []) as LinkRow[]).map((r) => ({
    rowNo: r.row_no,
    platform: r.platform,
    product: r.product,
    sku: r.sku,
    url: r.url,
    sharesWith: r.shares_with,
  }));
  const checks = (checkRes.data ?? []) as CheckRow[];
  const asked = typeof sp.check === "string" ? sp.check : null;
  const at = Math.max(0, checks.findIndex((c) => c.checked_on === asked));
  const check = checks[at] ?? null;
  const prev = checks[at + 1] ?? null;

  const ids = [check?.id, prev?.id].filter((x): x is string => Boolean(x));
  const countRes = ids.length ? await db.from("review_counts").select("check_id, row_no, reviews").in("check_id", ids).limit(5000) : { data: [] };
  const counts = (countRes.data ?? []) as CountRow[];
  const mapFor = (id: string | undefined) => new Map(counts.filter((c) => c.check_id === id).map((c) => [c.row_no, c.reviews] as const));

  // The trend: total written reviews per check, shared listings counted once.
  const trendRes = await db.from("review_counts").select("check_id, row_no, reviews").in("check_id", checks.slice(0, 12).map((c) => c.id)).limit(20000);
  const shared = new Set(links.filter((l) => l.sharesWith != null).map((l) => l.rowNo));
  const trend = checks
    .slice(0, 12)
    .map((c) => {
      const mine = ((trendRes.data ?? []) as CountRow[]).filter((r) => r.check_id === c.id && !shared.has(r.row_no));
      return { day: c.checked_on, reviews: mine.reduce((n, r) => n + (r.reviews ?? 0), 0), missing: mine.filter((r) => r.reviews == null).length };
    })
    .reverse();

  const view: ReviewsView = {
    checks: checks.map((c) => ({ day: c.checked_on, note: c.note })),
    day: check?.checked_on ?? null,
    prevDay: prev?.checked_on ?? null,
    lines: check ? reviewLines(links, mapFor(check.id), prev ? mapFor(prev.id) : null) : [],
    trend,
  };
  return <ReviewTracker view={view} />;
}
