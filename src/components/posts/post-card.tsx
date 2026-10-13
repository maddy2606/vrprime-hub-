import Link from "next/link";
import { Chip, PriorityChip, StatusChip, TypeChip } from "@/components/ui";
import type { Lookups } from "@/lib/data";
import { dueLabel, dueState, postNumber } from "@/lib/format";
import { liveState } from "@/lib/new-listing";
import type { Post } from "@/lib/types";

export function DueChip({ post, today }: { post: Pick<Post, "due_date" | "status">; today: string }) {
  if (!post.due_date) return null;
  const closed = post.status === "done" || post.status === "cancelled";
  const state = closed ? "later" : dueState(post.due_date, today);
  const tone = state === "overdue" ? "bad" : state === "today" || state === "soon" ? "warn" : "neutral";
  return <Chip tone={tone}>{dueLabel(post.due_date, today)}</Chip>;
}

/** Where a done new listing stands on Flipkart. */
export function LiveChips({ post }: { post: Post }) {
  if (post.type !== "new_listing" || post.status !== "done") return null;
  const state = liveState(post);
  if (state.kind === "live") {
    return (
      <>
        <Chip tone={state.active ? "ok" : "warn"}>{state.active ? "Live ✓" : "Live, inactive"}</Chip>
        {state.overWeight ? <Chip tone="warn">Over weight</Chip> : null}
      </>
    );
  }
  if (state.kind === "not_found") return <Chip tone={state.late ? "bad" : "warn"}>Not found on Flipkart</Chip>;
  if (state.kind === "not_checked") return <Chip>Not checked yet</Chip>;
  return null;
}

export function PostCard({ post, lookups, today }: { post: Post; lookups: Lookups; today: string }) {
  const overdue =
    post.status !== "done" && post.status !== "cancelled" && dueState(post.due_date, today) === "overdue";
  return (
    <Link prefetch={false}
      href={`/posts/${post.id}`}
      className={`focus-ring block min-w-0 rounded-xl border bg-surface p-3 transition hover:border-accent ${
        overdue ? "border-bad/50" : "border-line"
      }`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-xs font-medium text-muted">{postNumber(post.number)}</span>
        <TypeChip type={post.type} />
        {post.priority === "high" || post.priority === "urgent" ? <PriorityChip priority={post.priority} /> : null}
        <LiveChips post={post} />
        <span className="ml-auto">
          <StatusChip status={post.status} />
        </span>
      </div>
      <p className="mt-2 line-clamp-2 break-words text-[15px] font-bold leading-snug">{post.title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted">
        <span className="font-semibold text-ink">{lookups.personName(post.assignee_id)}</span>
        {post.warehouse_id ? <span>· {lookups.warehouseName(post.warehouse_id)}</span> : null}
        {post.sku ? <span className="max-w-full truncate font-mono">· {post.sku}</span> : null}
        <span className="ml-auto">
          <DueChip post={post} today={today} />
        </span>
      </div>
    </Link>
  );
}

export function PostGrid({ posts, lookups, today }: { posts: Post[]; lookups: Lookups; today: string }) {
  return (
    <div className="grid grid-cols-1 gap-2 lg:grid-cols-2 2xl:grid-cols-3">
      {posts.map((post) => (
        <PostCard key={post.id} post={post} lookups={lookups} today={today} />
      ))}
    </div>
  );
}
