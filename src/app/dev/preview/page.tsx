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
import { SettingsForm } from "@/components/admin/settings-form";
import { StockDesk } from "@/components/stock/stock-desk";
import { SyncBar } from "@/components/stock/sync-bar";
import { MarkAllReadButton, NotificationList } from "@/components/notifications/notification-list";
import { PushSettings } from "@/components/notifications/push-settings";
import { TicketCard, type TicketPost } from "@/components/tickets/ticket-card";
import { TicketFilters } from "@/components/tickets/ticket-filters";
import { TicketForm } from "@/components/tickets/ticket-form";
import { TicketTabs } from "@/components/tickets/ticket-tabs";
import { PageTitle, PostListSkeleton } from "@/components/ui";
import { buildLookups } from "@/lib/data";
import {
  FAKE_COMMENTS,
  FAKE_EVENTS,
  FAKE_NOTIFICATIONS,
  FAKE_PEOPLE,
  FAKE_POSTS,
  FAKE_SYNC,
  fakeDesk,
  FAKE_TICKETS,
  FAKE_WAREHOUSES,
} from "@/lib/dev-fixtures";
import { todayIST } from "@/lib/format";
import { EMPTY_POST } from "@/lib/post-options";
import { isViewKey } from "@/lib/stock-views";
import { emptyTicket } from "@/lib/ticket-options";
import { POST_TYPES, type PostType } from "@/lib/types";

// Local-only screen for checking layout (360px, dark mode) with fake data,
// without touching the real database. It does not exist in production.
const VIEWS = [
  "mywork",
  "empty",
  "all",
  "post",
  "done",
  "new",
  "tickets",
  "ticket",
  "newticket",
  "notifications",
  "stock",
  "stockempty",
  "stockrunning",
  "settings",
  "users",
  "password",
  "loading",
] as const;

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
    <AppShell user={{ name: me.name, role: "owner", email: "fake.owner@example.test" }} unread={3}>
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
        <PostView post={FAKE_POSTS[0]} tickets={FAKE_TICKETS.slice(0, 1)} lookups={lookups} today={today} comments={FAKE_COMMENTS} events={FAKE_EVENTS} photos={[]} />
      ) : null}
      {view === "done" ? (
        <PostView post={FAKE_POSTS[5]} tickets={[]} lookups={lookups} today={today} comments={[]} events={FAKE_EVENTS.slice(3)} photos={[]} />
      ) : null}
      {view === "new" ? (
        <div className="mx-auto max-w-2xl">
          <PageTitle title="New post" sub="Pick a type, then fill the short form." />
          <PostForm key={type ?? "pick"} initial={{ ...EMPTY_POST, type }} people={FAKE_PEOPLE} warehouses={FAKE_WAREHOUSES} />
        </div>
      ) : null}
      {view === "tickets" ? (
        <>
          <PageTitle title="Tickets" sub="2 open · 1 waiting · 2 follow-up due" />
          <TicketFilters values={{ q: "", platform: "", issue: "", tab: "open" }} />
          <TicketTabs
            filters={{ q: "", platform: "", issue: "", tab: "open" }}
            counts={{ open_count: 2, waiting_count: 1, follow_up_due: 2, closed_count: 1 }}
          />
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2 2xl:grid-cols-3">
            {FAKE_TICKETS.map((t) => {
              const post: TicketPost | null = FAKE_POSTS.find((p) => p.id === t.post_id) ?? null;
              return (
                <TicketCard
                  key={t.id}
                  ticket={t}
                  post={post}
                  warehouseName={post?.warehouse_id ? lookups.warehouseName(post.warehouse_id) : null}
                  today={today}
                />
              );
            })}
          </div>
        </>
      ) : null}
      {view === "ticket" || view === "newticket" ? (
        <div className="mx-auto max-w-2xl">
          <PageTitle title={view === "ticket" ? "VR-T-118" : "New ticket"} />
          <TicketForm
            key={view}
            ticketId={view === "ticket" ? FAKE_TICKETS[0].id : undefined}
            today={today}
            linkedPost={view === "newticket" ? { id: FAKE_POSTS[0].id, number: FAKE_POSTS[0].number, title: FAKE_POSTS[0].title } : null}
            initial={
              view === "ticket"
                ? {
                    ...emptyTicket(today),
                    ticket_id: FAKE_TICKETS[0].ticket_id,
                    issue_type: "wrong_return",
                    sku: "FAKE-SKU-RED-XL",
                  }
                : emptyTicket(today)
            }
          />
        </div>
      ) : null}
      {view === "notifications" ? (
        <div className="mx-auto max-w-2xl">
          <PageTitle title="Notifications" sub="3 unread" action={<MarkAllReadButton />} />
          <PushSettings userId={me.id} />
          <NotificationList items={FAKE_NOTIFICATIONS} />
        </div>
      ) : null}
      {view === "stock" ? (
        <>
          <PageTitle title="Stock" sub="Flipkart stock across the warehouses" />
          <StockDesk
            data={fakeDesk()}
            latest={FAKE_SYNC}
            lastDone={FAKE_SYNC}
            canSync
            initial={{
              view: isViewKey(sp.sv) ? sp.sv : "low",
              warehouseId: typeof sp.wh === "string" ? sp.wh : "",
              q: "",
              hide: false,
            }}
          />
        </>
      ) : null}
      {view === "stockempty" ? (
        <>
          <PageTitle title="Stock" sub="Flipkart stock across the warehouses" />
          <SyncBar latest={null} lastDone={null} snapshotDate={null} previousDate={null} canSync />
        </>
      ) : null}
      {view === "stockrunning" ? (
        <>
          <PageTitle title="Stock" sub="Flipkart stock across the warehouses" />
          <SyncBar latest={{ ...FAKE_SYNC, status: "running", cursor: 24, total: 66 }} lastDone={FAKE_SYNC} snapshotDate={FAKE_SYNC.snapshotDate} previousDate={null} canSync />
        </>
      ) : null}
      {view === "settings" ? (
        <div className="mx-auto max-w-2xl">
          <PageTitle title="Settings" sub="Thresholds for the Stock page. They apply the next time anyone opens it." />
          <SettingsForm initial={{ low_stock_threshold: "100", weight_alert_limit: "2000", new_inactive_days: "2" }} />
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
