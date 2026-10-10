import Link from "next/link";
import { notFound } from "next/navigation";
import { UsersAdmin, type AdminUser } from "@/components/admin/users-admin";
import { AppShell } from "@/components/app-shell";
import { ChangePasswordForm } from "@/components/auth/auth-forms";
import { Filters } from "@/components/posts/filters";
import { MyWork } from "@/components/posts/my-work";
import { PostGrid } from "@/components/posts/post-card";
import { PostForm } from "@/components/posts/post-form";
import { PostView } from "@/components/posts/post-view";
import { PageTitle, PostListSkeleton } from "@/components/ui";
import { buildLookups } from "@/lib/data";
import { FAKE_COMMENTS, FAKE_EVENTS, FAKE_PEOPLE, FAKE_POSTS, FAKE_WAREHOUSES } from "@/lib/dev-fixtures";
import { todayIST } from "@/lib/format";
import { EMPTY_POST } from "@/lib/post-options";
import { POST_TYPES, type PostType } from "@/lib/types";

// Local-only screen for checking layout (360px, dark mode) with fake data,
// without touching the real database. It does not exist in production.
const VIEWS = ["mywork", "empty", "all", "post", "done", "new", "users", "password", "loading"] as const;

export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();

  const sp = await searchParams;
  const view = typeof sp.view === "string" ? sp.view : "mywork";
  const type = typeof sp.type === "string" && (POST_TYPES as readonly string[]).includes(sp.type) ? (sp.type as PostType) : null;
  const lookups = buildLookups(FAKE_PEOPLE, FAKE_WAREHOUSES);
  const today = todayIST();
  const me = FAKE_PEOPLE[0];
  const open = FAKE_POSTS.filter((p) => p.status !== "done");

  const users: AdminUser[] = FAKE_PEOPLE.map((p, i) => ({
    id: p.id,
    name: p.name,
    email: `fake.person.${i + 1}@example.test`,
    role: p.role,
    phone: null,
    active: i !== 2,
    mustChangePassword: i === 3,
    warehouseIds: p.role === "warehouse" ? [FAKE_WAREHOUSES[0].id, FAKE_WAREHOUSES[2].id] : [],
  }));

  return (
    <AppShell user={{ name: me.name, role: "owner", email: "fake.owner@example.test" }}>
      <nav className="mb-4 flex flex-wrap gap-x-3 gap-y-1 rounded-lg bg-warn-soft px-3 py-2 text-xs font-bold text-warn">
        <span>Preview (fake data):</span>
        {VIEWS.map((v) => (
          <Link prefetch={false} key={v} href={`/dev/preview?view=${v}`} className="underline">
            {v}
          </Link>
        ))}
      </nav>

      {view === "mywork" ? <MyWork posts={open} lookups={lookups} today={today} firstName="Test" /> : null}
      {view === "empty" ? <MyWork posts={[]} lookups={lookups} today={today} firstName="Test" /> : null}
      {view === "all" ? (
        <>
          <PageTitle title="All posts" sub={`${FAKE_POSTS.length} posts`} />
          <Filters
            values={{ q: "", type: "", status: "", warehouse: "", assignee: "", priority: "", overdue: true, sort: "updated" }}
            effectiveStatus="active"
            people={FAKE_PEOPLE}
            warehouses={FAKE_WAREHOUSES}
            meId={me.id}
          />
          <PostGrid posts={FAKE_POSTS} lookups={lookups} today={today} />
        </>
      ) : null}
      {view === "post" ? (
        <PostView post={FAKE_POSTS[0]} lookups={lookups} today={today} comments={FAKE_COMMENTS} events={FAKE_EVENTS} photos={[]} />
      ) : null}
      {view === "done" ? (
        <PostView post={FAKE_POSTS[5]} lookups={lookups} today={today} comments={[]} events={FAKE_EVENTS.slice(3)} photos={[]} />
      ) : null}
      {view === "new" ? (
        <div className="mx-auto max-w-2xl">
          <PageTitle title="New post" sub="Pick a type, then fill the short form." />
          <PostForm key={type ?? "pick"} initial={{ ...EMPTY_POST, type }} people={FAKE_PEOPLE} warehouses={FAKE_WAREHOUSES} />
        </div>
      ) : null}
      {view === "users" ? <UsersAdmin users={users} warehouses={FAKE_WAREHOUSES} meId={me.id} /> : null}
      {view === "password" ? (
        <div className="mx-auto max-w-sm rounded-xl border border-line bg-surface p-5">
          <ChangePasswordForm />
        </div>
      ) : null}
      {view === "loading" ? <PostListSkeleton rows={4} /> : null}
    </AppShell>
  );
}
