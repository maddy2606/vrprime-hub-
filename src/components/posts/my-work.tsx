import Link from "next/link";
import { PostCard } from "@/components/posts/post-card";
import { buttonClass, Chip, EmptyState, Headline, Num, PageTitle } from "@/components/ui";
type Tone = "bad" | "warn" | "neutral";
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
  tone: Tone;
  posts: Post[];
  lookups: Lookups;
  today: string;
}) {
  return (
    <section className="sp-card g-pad min-w-0" aria-label={title}>
      <h2 className="t-card-title g-head flex items-center gap-2">
        {title}
        <Chip tone={posts.length ? tone : "neutral"}>{posts.length}</Chip>
      </h2>
      {posts.length ? (
        <div className="flex flex-col gap-2">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} lookups={lookups} today={today} inner />
          ))}
        </div>
      ) : (
        <p className="t-caption">None.</p>
      )}
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
      <PageTitle title={`Hi ${firstName}`} sub={posts.length ? "Your open work, most urgent first" : summary} />
      {posts.length ? (
        <>
          <Headline size="md" className="mb-6">
            <Num>{posts.length}</Num> open
            {overdue.length ? (
              <>
                , <Num tone="bad">{overdue.length}</Num> overdue
              </>
            ) : null}
            {dueToday.length ? (
              <>
                , <Num tone="warn">{dueToday.length}</Num> due today
              </>
            ) : null}
            .
          </Headline>
          <div className="grid items-start gap-3 min-[700px]:gap-4 min-[1100px]:grid-cols-3">
            <Section title="Overdue" tone="bad" posts={overdue} lookups={lookups} today={today} />
            <Section title="Due today" tone="warn" posts={dueToday} lookups={lookups} today={today} />
            <Section title="Next" tone="neutral" posts={rest} lookups={lookups} today={today} />
          </div>
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
