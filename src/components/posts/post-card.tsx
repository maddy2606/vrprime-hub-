import Link from "next/link";
import { Chip, PriorityChip, StatusChip, TypeChip } from "@/components/ui";
import type { Lookups } from "@/lib/data";
import { dueLabel, dueState, postNumber } from "@/lib/format";
import type { Post } from "@/lib/types";

export function DueChip({ post, today }: { post: Pick<Post, "due_date" | "status">; today: string }) {
  if (!post.due_date) return null;
  const closed = post.status === "done" || post.status === "cancelled";
  const state = closed ? "later" : dueState(post.due_date, today);
  const tone = state === "overdue" ? "bad" : state === "today" || state === "soon" ? "warn" : "neutral";
  return <Chip tone={tone}>{dueLabel(post.due_date, today)}</Chip>;
}

export function PostCard({ post, lookups, today }: { post: Post; lookups: Lookups; today: string }) {
  const overdue =
    post.status !== "done" && post.status !== "cancelled" && dueState(post.due_date, today) === "overdue";
  return (
    <Link
      href={`/posts/${post.id}`}
      className={`focus-ring block min-w-0 rounded-xl border bg-surface p-3 transition hover:border-accent ${
        overdue ? "border-bad/50" : "border-line"
      }`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-xs font-medium text-muted">{postNumber(post.number)}</span>
        <TypeChip type={post.type} />
        {post.priority === "high" || post.priority === "urgent" ? <PriorityChip priority={post.priority} /> : null}
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
