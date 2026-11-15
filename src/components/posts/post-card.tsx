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

/** The 3px left bar: red when overdue, amber when due today or High/Urgent, otherwise the line colour. */
function barTone(post: Post, today: string): string {
  const open = post.status !== "done" && post.status !== "cancelled";
  const state = open ? dueState(post.due_date, today) : "later";
  if (state === "overdue") return "tone-bad";
  if (state === "today" || (open && (post.priority === "high" || post.priority === "urgent"))) return "tone-warn";
  return "";
}

/** A post card: a glass Card on its own, or an inner box (`inner`) inside a work board column. */
export function PostCard({ post, lookups, today, inner = false }: { post: Post; lookups: Lookups; today: string; inner?: boolean }) {
  return (
    <Link prefetch={false}
      href={`/posts/${post.id}`}
      className={`focus-ring bar-card ${barTone(post, today)} ${inner ? "sp-inner" : "sp-card"} block min-w-0 p-3.5 pl-[17px] transition-colors duration-160 hover:border-line`}
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
      <p className="mt-2 line-clamp-2 break-words text-[15px] font-semibold leading-snug">{post.title}</p>
      <div className="t-caption mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span>{lookups.personName(post.assignee_id)}</span>
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
    <div className="g-cards">
      {posts.map((post) => (
        <PostCard key={post.id} post={post} lookups={lookups} today={today} />
      ))}
    </div>
  );
}

/** My work / Everything, as a segmented control. */
export function WorkSwitch({ on }: { on: "mine" | "all" }) {
  return (
    <nav aria-label="Work views" className="seg mb-4">
      <Link prefetch={false} href="/work" aria-current={on === "mine" ? "page" : undefined} className="seg-opt">
        My work
      </Link>
      <Link prefetch={false} href="/all" aria-current={on === "all" ? "page" : undefined} className="seg-opt">
        Everything
      </Link>
    </nav>
  );
}
