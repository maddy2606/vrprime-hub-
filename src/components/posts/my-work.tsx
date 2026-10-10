import Link from "next/link";
import { PostGrid } from "@/components/posts/post-card";
import { buttonClass, EmptyState, PageTitle } from "@/components/ui";
import type { Lookups } from "@/lib/data";
import { dueState } from "@/lib/format";
import type { Post } from "@/lib/types";

function byDueThenPriority(a: Post, b: Post): number {
  if (a.due_date !== b.due_date) {
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date < b.due_date ? -1 : 1;
  }
  return (b.priority_rank ?? 0) - (a.priority_rank ?? 0) || (a.created_at < b.created_at ? -1 : 1);
}

function Section({
  title,
  tone,
  posts,
  lookups,
  today,
}: {
  title: string;
  tone: string;
  posts: Post[];
  lookups: Lookups;
  today: string;
}) {
  if (!posts.length) return null;
  return (
    <section className="mb-6">
      <h2 className={`mb-2 text-sm font-extrabold uppercase tracking-wide ${tone}`}>
        {title} · {posts.length}
      </h2>
      <PostGrid posts={posts} lookups={lookups} today={today} />
    </section>
  );
}

type Props = { posts: Post[]; lookups: Lookups; today: string; firstName: string };

/** Open items assigned to me: overdue first, then due today, then the rest. */
export function MyWork({ posts, lookups, today, firstName }: Props) {
  const sorted = [...posts].sort(byDueThenPriority);
  const overdue = sorted.filter((p) => dueState(p.due_date, today) === "overdue");
  const dueToday = sorted.filter((p) => dueState(p.due_date, today) === "today");
  const rest = sorted.filter((p) => !["overdue", "today"].includes(dueState(p.due_date, today)));

  const summary = posts.length
    ? [
        `${posts.length} open`,
        overdue.length ? `${overdue.length} overdue` : null,
        dueToday.length ? `${dueToday.length} due today` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "Nothing assigned to you right now";

  return (
    <>
      <PageTitle title={`Hi ${firstName}`} sub={summary} />
      {posts.length ? (
        <>
          <Section title="Overdue" tone="text-bad" posts={overdue} lookups={lookups} today={today} />
          <Section title="Due today" tone="text-warn" posts={dueToday} lookups={lookups} today={today} />
          <Section title="Next" tone="text-muted" posts={rest} lookups={lookups} today={today} />
        </>
      ) : (
        <EmptyState
          title="You are all caught up"
          body="Posts assigned to you show up here. Create one, or look at everything the team is working on."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Link prefetch={false} href="/posts/new" className={buttonClass("primary")}>
                + Post
              </Link>
              <Link prefetch={false} href="/all" className={buttonClass("secondary")}>
                See everything
              </Link>
            </div>
          }
        />
      )}
    </>
  );
}
