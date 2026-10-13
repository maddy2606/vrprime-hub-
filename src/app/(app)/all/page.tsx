import type { Metadata } from "next";
import Link from "next/link";
import { Filters } from "@/components/posts/filters";
import { PostGrid } from "@/components/posts/post-card";
import { buttonClass, EmptyState, PageTitle } from "@/components/ui";
import { canManage, requireUser } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import { formatNumber, todayIST } from "@/lib/format";
import { NEW_LISTING_VIEWS, SORTS, type FilterValues } from "@/lib/post-options";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_STATUSES, POST_STATUSES, POST_TYPES, PRIORITIES, type PostStatus, type PostType, type Priority } from "@/lib/types";

export const metadata: Metadata = { title: "All posts" };

const PAGE_SIZE = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** Reads filters from the URL, dropping anything that is not a known value. */
function readFilters(sp: Record<string, string | string[] | undefined>, canSeeListings: boolean): FilterValues {
  const type = one(sp.type);
  const status = one(sp.status);
  const priority = one(sp.priority);
  const warehouse = one(sp.warehouse);
  const assignee = one(sp.assignee);
  const sort = one(sp.sort);
  const nl = one(sp.nl);
  return {
    q: one(sp.q).slice(0, 100),
    type: (POST_TYPES as readonly string[]).includes(type) ? type : "",
    status: ["active", "any", ...POST_STATUSES].includes(status) ? status : "",
    priority: (PRIORITIES as readonly string[]).includes(priority) ? priority : "",
    warehouse: UUID.test(warehouse) ? warehouse : "",
    assignee: assignee === "none" || UUID.test(assignee) ? assignee : "",
    overdue: one(sp.overdue) === "1",
    // The New listings view is for owner and admin; warehouse users never see these posts.
    nl: canSeeListings && NEW_LISTING_VIEWS.some((v) => v.value === nl) ? nl : "",
    sort: SORTS.some((s) => s.value === sort) ? sort : "updated",
  };
}

export default async function AllPostsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const canSeeListings = canManage(user);
  const filters = readFilters(await searchParams, canSeeListings);
  const today = todayIST();
  // With no status chosen: show active posts, but search across everything.
  const effectiveStatus = filters.status || (filters.q ? "any" : "active");

  const supabase = await createClient();
  let query = supabase.rpc("search_posts", { q: filters.q }, { count: "exact" }).select("*");
  if (filters.nl) query = query.eq("type", "new_listing");
  else if (filters.type) query = query.eq("type", filters.type as PostType);
  if (filters.priority) query = query.eq("priority", filters.priority as Priority);
  if (filters.warehouse) query = query.eq("warehouse_id", filters.warehouse);
  if (filters.assignee === "none") query = query.is("assignee_id", null);
  else if (filters.assignee) query = query.eq("assignee_id", filters.assignee);
  if (filters.nl === "open") query = query.in("status", ACTIVE_STATUSES);
  else if (filters.nl === "live") query = query.eq("status", "done").eq("live_found", true);
  else if (filters.nl === "missing") query = query.eq("status", "done").or("live_found.is.null,live_found.eq.false");
  else if (filters.overdue) query = query.lt("due_date", today).in("status", ACTIVE_STATUSES);
  else if (effectiveStatus === "active") query = query.in("status", ACTIVE_STATUSES);
  else if (effectiveStatus !== "any") query = query.eq("status", effectiveStatus as PostStatus);

  if (filters.sort === "due") query = query.order("due_date", { ascending: true, nullsFirst: false });
  else if (filters.sort === "created") query = query.order("created_at", { ascending: false });
  else if (filters.sort === "priority") query = query.order("priority_rank", { ascending: false });
  query = query.order("updated_at", { ascending: false }).limit(PAGE_SIZE);

  // How many are in each New listings view, for the three buttons.
  const nlCount = (view: "open" | "live" | "missing") => {
    const q = supabase.from("posts").select("id", { count: "exact", head: true }).eq("type", "new_listing");
    if (view === "open") return q.in("status", ACTIVE_STATUSES);
    if (view === "live") return q.eq("status", "done").eq("live_found", true);
    return q.eq("status", "done").or("live_found.is.null,live_found.eq.false");
  };
  const [{ data: posts, error, count }, lookups, nlCounts] = await Promise.all([
    query,
    getLookups(),
    canSeeListings ? Promise.all([nlCount("open"), nlCount("live"), nlCount("missing")]) : Promise.resolve(null),
  ]);
  if (error) throw new Error("Could not load posts");

  const total = count ?? posts.length;
  const filtered = Boolean(
    filters.q || filters.type || filters.status || filters.priority || filters.warehouse || filters.assignee || filters.overdue || filters.nl,
  );

  return (
    <>
      <div className="mb-4 flex gap-1 rounded-lg border border-line bg-surface p-1 lg:hidden">
        <Link prefetch={false} href="/" className="focus-ring flex min-h-10 flex-1 items-center justify-center rounded-md text-sm font-bold text-muted">
          My work
        </Link>
        <span className="flex min-h-10 flex-1 items-center justify-center rounded-md bg-accent text-sm font-bold text-accent-ink">
          Everything
        </span>
      </div>

      <PageTitle
        title={filters.nl ? "New listings" : "All posts"}
        sub={
          total > posts.length
            ? `Showing the first ${formatNumber(posts.length)} of ${formatNumber(total)}. Narrow the filters to see the rest.`
            : `${formatNumber(total)} ${total === 1 ? "post" : "posts"}`
        }
      />
      <Filters
        values={filters}
        effectiveStatus={effectiveStatus}
        people={lookups.people}
        warehouses={lookups.warehouses}
        meId={user.id}
        newListingCounts={nlCounts ? { open: nlCounts[0].count ?? 0, live: nlCounts[1].count ?? 0, missing: nlCounts[2].count ?? 0 } : null}
      />

      {posts.length ? (
        <PostGrid posts={posts} lookups={lookups} today={today} />
      ) : filtered ? (
        <EmptyState
          title="Nothing matches"
          body="Try a different search, or clear the filters. Done and cancelled posts only show when you pick that status or search."
        />
      ) : (
        <EmptyState
          title="No open posts"
          body="When someone posts a task, problem, new listing or restock, it shows up here."
          action={
            <Link prefetch={false} href="/posts/new" className={buttonClass("primary")}>
              + Post
            </Link>
          }
        />
      )}
    </>
  );
}
