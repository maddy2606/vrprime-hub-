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
import { ForecastTab } from "@/components/flipkart/forecast-tab";
import { MastersTab } from "@/components/flipkart/masters-tab";
import { HealthTab } from "@/components/flipkart/health-tab";
import { NeedsAction } from "@/components/flipkart/needs-action";
import { OrdersTab } from "@/components/flipkart/orders-tab";
import { OverfillTab } from "@/components/flipkart/overfill-tab";
import { PricesTab } from "@/components/flipkart/prices-tab";
import { ReturnsTab } from "@/components/flipkart/returns-tab";
import { TabBar, tabsFor } from "@/components/flipkart/tab-bar";
import { DispatchChart, Hero, Movers, PriorityQueue, Pulses, StockHealth, Warehouses } from "@/components/deck/sections";
import { fakeDeck } from "@/lib/dev-fixtures-deck";
import { StockDesk } from "@/components/stock/stock-desk";
import { SyncBar } from "@/components/stock/sync-bar";
import { MarkAllReadButton, NotificationList } from "@/components/notifications/notification-list";
import { PushSettings } from "@/components/notifications/push-settings";
import { TicketCard, type TicketPost } from "@/components/tickets/ticket-card";
import { TicketFilters } from "@/components/tickets/ticket-filters";
import { TicketForm } from "@/components/tickets/ticket-form";
import { PageTitle, PostListSkeleton } from "@/components/ui";
import { buildLookups } from "@/lib/data";
import {
  FAKE_COMMENTS,
  FAKE_EVENTS,
  FAKE_NOTIFICATIONS,
  FAKE_PEOPLE,
  FAKE_POSTS,
  FAKE_SYNC,
  FAKE_TICKETS,
  FAKE_WAREHOUSES,
} from "@/lib/dev-fixtures";
import {
  fakeCards,
  fakeHealthRows,
  fakeNeedsAction,
  fakeOrdersView,
  fakeOrderSync,
  fakePriceRows,
  fakeReturnRates,
  fakeReturnsPage,
} from "@/lib/dev-fixtures-flipkart";
import { addDays, todayIST } from "@/lib/format";
import { defaultQuery, type OrderView, type StatusFilter } from "@/lib/orders-view";
import { EMPTY_POST } from "@/lib/post-options";
import { buildStockView, defaultStockQuery, stockMeta } from "@/lib/stock-view";
import { isViewKey } from "@/lib/stock-views";
import { emptyTicket } from "@/lib/ticket-options";
import { POST_TYPES, type PostType } from "@/lib/types";

const PREVIEW_SYNCED = new Date(Date.now() - 42_000).toISOString();

// Local-only screen for checking layout (360px, dark mode) with fake data,
// without touching the real database. It does not exist in production.
const VIEWS = [
  "deck",
  "deckclear",
  "mywork",
  "listings",
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
  "fneeds",
  "forders",
  "flist",
  "foverfill",
  "fprocessing",
  "fcancelled",
  "freturns",
  "frates",
  "fprices",
  "fhealth",
  "fforecast",
  "fmasters",
  "settings",
  "users",
  "password",
  "loading",
] as const;

const FAKE_ORDER_VIEW: Record<string, { view: OrderView; status: StatusFilter } | undefined> = {
  forders: { view: "sku", status: "active" },
  flist: { view: "list", status: "to_accept" },
  fprocessing: { view: "sku", status: "processing" },
  fcancelled: { view: "cancelled", status: "active" },
};

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
    <AppShell user={{ name: me.name, role: "owner", email: "fake.owner@example.test" }} unread={3} scope="All warehouses" syncedAt={PREVIEW_SYNCED}>
      <nav className="mb-4 flex flex-wrap gap-x-3 gap-y-1 rounded-lg bg-warn-soft px-3 py-2 text-xs font-bold text-warn">
        <span>Preview (fake data):</span>
        {VIEWS.map((v) => (
          <Link prefetch={false} key={v} href={`/dev/preview?view=${v}`} className="underline">
            {v}
          </Link>
        ))}
      </nav>

      {view === "deck" || view === "deckclear" ? (
        <div className="flex flex-col gap-5">
          <div className="grid gap-5 lg:grid-cols-[1.45fr_1fr]">
            <Hero d={fakeDeck(view === "deckclear")} />
            <Pulses d={fakeDeck(view === "deckclear")} />
          </div>
          <div className="grid items-start gap-5 lg:grid-cols-[1.5fr_1fr]">
            <PriorityQueue d={fakeDeck(view === "deckclear")} />
            <Warehouses d={fakeDeck(view === "deckclear")} />
          </div>
          <DispatchChart d={fakeDeck(view === "deckclear")} />
          <StockHealth d={fakeDeck(view === "deckclear")} />
          <Movers d={fakeDeck(view === "deckclear")} />
        </div>
      ) : null}
      {view === "mywork" ? <MyWork posts={open} lookups={lookups} today={today} firstName="Test" /> : null}
      {view === "empty" ? <MyWork posts={[]} lookups={lookups} today={today} firstName="Test" /> : null}
      {view === "all" ? (
        <>
          <PageTitle title="All posts" sub={`${FAKE_POSTS.length} posts`} />
          <Filters
            values={{ q: "", type: "", status: "", warehouse: "", assignee: "", priority: "", overdue: true, nl: "", sort: "updated" }}
            effectiveStatus="active"
            people={FAKE_PEOPLE}
            warehouses={FAKE_WAREHOUSES}
            meId={me.id}
          />
          <PostGrid posts={FAKE_POSTS} lookups={lookups} today={today} />
        </>
      ) : null}
      {view === "listings" ? (
        <div className="flex flex-col gap-10">
          {[
            { title: "Open request with details (over the weight limit)", post: { ...FAKE_POSTS[0], type: "new_listing" as const, title: "List rat spray 500 ml on Flipkart", product_name: "Rat spray 500 ml", reference_url: "https://example.test/rat-spray", target_price: 199, mrp: 299, dim_l: 30, dim_b: 20, dim_h: 10, weight_kg: 1.25, platform: "flipkart" as const } },
            { title: "Done, live and over the limit on Flipkart", post: { ...FAKE_POSTS[0], type: "new_listing" as const, status: "done" as const, title: "List rat spray 500 ml", sku: "RS-500", done_at: new Date(`${addDays(today, -2)}T12:00:00+05:30`).toISOString(), done_by: FAKE_PEOPLE[1].id, live_found: true, live_status: "ACTIVE", live_since: today, live_over_weight: true, live_package: { l: 30, b: 20, h: 10, kg: 1.25, total: 7250 } } },
            { title: "Done, not found for 4 days", post: { ...FAKE_POSTS[0], type: "new_listing" as const, status: "done" as const, title: "List fly trap", sku: "FLY-1", done_at: new Date(`${addDays(today, -4)}T12:00:00+05:30`).toISOString(), done_by: FAKE_PEOPLE[1].id, live_found: false } },
          ].map((x) => (
            <div key={x.title}>
              <p className="mb-2 text-sm font-bold text-muted">{x.title}</p>
              <PostView post={x.post} tickets={[]} lookups={lookups} today={today} comments={[]} events={[]} photos={[]} weightLimit={2000} />
            </div>
          ))}
        </div>
      ) : null}
      {view === "post" ? (
        <PostView post={FAKE_POSTS[0]} tickets={FAKE_TICKETS.slice(0, 1)} lookups={lookups} today={today} comments={FAKE_COMMENTS} events={FAKE_EVENTS} photos={[]} weightLimit={2000} />
      ) : null}
      {view === "done" ? (
        <PostView post={FAKE_POSTS[5]} tickets={[]} lookups={lookups} today={today} comments={[]} events={FAKE_EVENTS.slice(3)} photos={[]} weightLimit={2000} />
      ) : null}
      {view === "new" ? (
        <div className="mx-auto max-w-2xl">
          <PageTitle title="New post" sub="Pick a type, then fill the short form." />
          <PostForm key={type ?? "pick"} initial={{ ...EMPTY_POST, type }} people={FAKE_PEOPLE} warehouses={FAKE_WAREHOUSES} canPostListings weightLimit={2000} />
        </div>
      ) : null}
      {view === "tickets" ? (
        <>
          <PageTitle title="Tickets" sub="2 open · 1 waiting · 2 follow-up due" />
          <TicketFilters values={{ q: "", platform: "", issue: "", tab: "open" }} counts={{ open_count: 2, waiting_count: 1, follow_up_due: 2, closed_count: 1 }} />
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
          {(() => {
            const n = fakeNeedsAction();
            const query = defaultStockQuery(isViewKey(sp.sv) ? sp.sv : "low", { wh: typeof sp.wh === "string" ? sp.wh : "" });
            return (
              <StockDesk
                meta={stockMeta(n.desk)}
                initialQuery={query}
                initialData={buildStockView(n.desk, query, n.soonest)}
                latest={FAKE_SYNC}
                lastDone={FAKE_SYNC}
                canSync
                cover={{ state: n.state, limit: 7, warehouseNames: Object.fromEntries(n.desk.warehouses.map((w) => [w.id, w.name])) }}
              />
            );
          })()}
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
      {view.startsWith("f") ? <FlipkartPreview view={view} sp={sp} /> : null}
      {view === "settings" ? (
        <div className="mx-auto max-w-2xl">
          <PageTitle title="Settings" sub="Thresholds for the Stock page. They apply the next time anyone opens it." />
          <SettingsForm initial={{ low_stock_threshold: "100", weight_alert_limit: "2000", new_inactive_days: "2", price_drop_percent: "15", dispatch_sla_days: "2", running_out_days: "7", return_rate_percent: "10", money_low_margin_percent: "10", money_default_fee_percent: "12", money_unpaid_after_days: "15", money_fee_deviation_points: "2", money_upload_reminder_days: "14", money_keep_months: "12" }} />
        </div>
      ) : null}
      {view === "users" ? <UsersAdmin users={users} warehouses={FAKE_WAREHOUSES} meId={me.id} /> : null}
      {view === "password" ? (
        <div className="mx-auto max-w-sm sp-card p-5">
          <ChangePasswordForm />
        </div>
      ) : null}
      {view === "loading" ? <PostListSkeleton rows={4} /> : null}
    </AppShell>
  );
}

function FlipkartPreview({ view, sp }: { view: string; sp: Record<string, string | string[] | undefined> }) {
  const today = todayIST();
  const wh = FAKE_WAREHOUSES.map((w) => ({ id: w.id, name: w.name }));
  const stage = sp.stage === "running" || sp.stage === "failed" || sp.stage === "nobackfill" ? sp.stage : "ok";
  const active = view === "fneeds" ? "needs" : FAKE_ORDER_VIEW[view] ? "orders" : view === "freturns" || view === "frates" ? "returns" : view === "fprices" ? "prices" : view === "fforecast" ? "forecast" : view === "fmasters" ? "masters" : view === "foverfill" ? "overfill" : "health";
  const ordersView = FAKE_ORDER_VIEW[view]?.view ?? "sku";
  const needs = view === "fneeds" ? fakeNeedsAction() : null;
  const health = view === "fhealth" ? fakeHealthRows() : null;
  return (
    <>
      <PageTitle title="Flipkart" sub="Fake data" />
      <TabBar tabs={tabsFor("owner")} active={active} />
      {needs ? (
        <NeedsAction
          sections={needs.sections}
          notes={["Running out soon: collecting data, ready on 19 Oct. It needs 7 days of stock history or of shipped orders."]}
          asOf={{ stock: today, today }}
        />
      ) : null}
      {FAKE_ORDER_VIEW[view] ? (
        <OrdersTab
          cards={fakeCards()}
          warehouses={wh}
          state={fakeOrderSync(stage)}
          canSync
          today={today}
          nowIso={new Date().toISOString()}
          initialQuery={defaultQuery(ordersView, {})}
          initialData={fakeOrdersView(ordersView)}
        />
      ) : null}
      {view === "freturns" || view === "frates" ? (
        <ReturnsTab initialPage={fakeReturnsPage().page} initialSummary={fakeReturnsPage().summary} rates={fakeReturnRates(sp.ready !== "0")} historyReady={sp.ready !== "0"} rateLimit={10} warehouses={wh} state={fakeOrderSync(stage)} canSync today={today} />
      ) : null}
      {view === "fprices" ? <PricesTab rows={fakePriceRows()} today={today} dropLimit={15} snapshotDate={today} /> : null}
      {view === "foverfill" ? (
        <OverfillTab
          warehouses={FAKE_WAREHOUSES.map((w) => ({ id: w.id, name: w.name }))}
          rows={[
            { sku: "FAKE-SKU-0003", title: "Fake steel bottle, 1 litre, brushed finish", warehouseId: FAKE_WAREHOUSES[2].id, orders: 6, units: 6 },
            { sku: "FAKE-SKU-0011", title: "Fake lunch box set", warehouseId: FAKE_WAREHOUSES[1].id, orders: 3, units: 4 },
            { sku: "FAKE-SKU-0020", title: null, warehouseId: FAKE_WAREHOUSES[2].id, orders: 2, units: 2 },
          ]}
        />
      ) : null}
      {view === "fforecast" ? (
        <ForecastTab
          meta={{ today, windowStart: addDays(today, -24), windowEnd: addDays(today, -1), days: 24, asked: 30, historyFrom: addDays(today, -24), snapshot: today }}
          raw={[
            { sku: "FAKE-SKU-RED-XL", wid: FAKE_WAREHOUSES[0].id, title: "Fake red cleaner, extra large pack, long title that wraps", disp: 720, stock: 400 },
            { sku: "FAKE-SKU-RED-XL", wid: FAKE_WAREHOUSES[1].id, title: null, disp: 240, stock: 90 },
            { sku: "FAKE-SKU-BLU-M", wid: FAKE_WAREHOUSES[0].id, title: "Fake blue spray", disp: 48, stock: 1000 },
            { sku: "FAKE-NO-SALES", wid: FAKE_WAREHOUSES[0].id, title: "Never sold", disp: 0, stock: 25 },
            { sku: "FAKE-LINT1", wid: FAKE_WAREHOUSES[0].id, title: "Fake lint remover, rechargeable", disp: 300, stock: 120 },
            { sku: "FAKE-LINT1", wid: FAKE_WAREHOUSES[2].id, title: null, disp: 96, stock: 40 },
            { sku: "fake-lint2", wid: FAKE_WAREHOUSES[1].id, title: "Fake lint remover, two pack", disp: 72, stock: 15 },
            { sku: "FAKE-SHOPSY-LINT2", wid: FAKE_WAREHOUSES[1].id, title: null, disp: 12, stock: 60 },
            { sku: "FAKE-RACK-BLK", wid: FAKE_WAREHOUSES[3].id, title: "Fake black rack, two piece", disp: 30, stock: 200 },
            { sku: "FAKE-RACK-BLK2", wid: FAKE_WAREHOUSES[4].id, title: null, disp: 6, stock: 3 },
            { sku: "FAKE-REMOVED", wid: FAKE_WAREHOUSES[4].id, title: "Removed on the Master SKUs tab: never shown", disp: 600, stock: 3 },
            { sku: "FAKE-BERRY1", wid: FAKE_WAREHOUSES[0].id, title: "Fake berry perfume", disp: 0, stock: 500 },
            { sku: "FAKE-MUSK1", wid: FAKE_WAREHOUSES[0].id, title: "Fake musk perfume", disp: 0, stock: 500 },
            { sku: "FAKE-COMBO", wid: FAKE_WAREHOUSES[0].id, title: "Fake berry + musk combo", disp: 240, stock: 20 },
          ]}
          warehouses={FAKE_WAREHOUSES.map((w) => ({ id: w.id, name: w.name }))}
          window={30}
          masters={[
            { master: "Lint Machine", sku: "FAKE-LINT1" },
            { master: "Lint Machine", sku: "FAKE-LINT2" },
            { master: "Lint Machine", sku: "FAKE-SHOPSY-LINT2" },
            { master: "Black Rack 2pc", sku: "FAKE-RACK-BLK" },
            { master: "Black Rack 2pc", sku: "FAKE-RACK-BLK2", units: 2 },
            { master: "Red Cleaner", sku: "FAKE-SKU-RED-XL" },
            { master: "Product with no Flipkart SKU", sku: "FAKE-GHOST" },
            { master: "Berry Car Perfume", sku: "FAKE-BERRY1" },
            { master: "Musk Car Perfume", sku: "FAKE-MUSK1" },
            { master: "Car Perfume", sku: "FAKE-COMBO" },
          ]}
          removed={["FAKE-REMOVED"]}
          kits={[
            { name: "Car Perfume", parts: [{ name: "Berry Car Perfume", qty: 1 }, { name: "Musk Car Perfume", qty: 1 }] },
            { name: "Shoe Cleaning Kit", parts: [{ name: "Shoe Bottle", qty: 1 }, { name: "Shoe Brush", qty: 1 }] },
          ]}
          allLabel="All warehouses"
        />
      ) : null}
      {view === "fmasters" ? (
        <MastersTab
          products={[
            { id: "00000000-0000-4000-8000-000000000101", code: "180-LINT", name: "Lint Roller 180", kit: [] },
            { id: "00000000-0000-4000-8000-000000000102", code: "ALLIN_ONE", name: "All In One Repellent", kit: [] },
            { id: "00000000-0000-4000-8000-000000000103", code: "8PC-AROMA", name: "Aroma Oil", kit: [] },
            { id: "00000000-0000-4000-8000-000000000104", code: null, name: "Black Rack 2pc", kit: [] },
            { id: "00000000-0000-4000-8000-000000000105", code: null, name: "Berry Car Perfume", kit: [] },
            { id: "00000000-0000-4000-8000-000000000106", code: null, name: "Musk Car Perfume", kit: [] },
            {
              id: "00000000-0000-4000-8000-000000000107",
              code: null,
              name: "Car Perfume",
              kit: [
                { partId: "00000000-0000-4000-8000-000000000105", qty: 1 },
                { partId: "00000000-0000-4000-8000-000000000106", qty: 1 },
              ],
            },
          ]}
          links={[
            { sku: "FAKE-LINT3", masterId: "00000000-0000-4000-8000-000000000101", units: 1 },
            { sku: "FAKE-LINTR1", masterId: "00000000-0000-4000-8000-000000000101", units: 1 },
            { sku: "Shopsy_FAKE-LINT3", masterId: "00000000-0000-4000-8000-000000000101", units: 1 },
            { sku: "FAKE-ALLIN1", masterId: "00000000-0000-4000-8000-000000000102", units: 1 },
            { sku: "FAKE-ALLIN-2", masterId: "00000000-0000-4000-8000-000000000102", units: 2 },
            { sku: "FAKE-OALLIN4", masterId: "00000000-0000-4000-8000-000000000102", units: 4 },
            { sku: "FAKE-RACK1", masterId: "00000000-0000-4000-8000-000000000104", units: 1 },
          ]}
          removed={["FAKE-OLD1", "FAKE-OLD-2", "FAKE-DISCONTINUED"]}
          listings={[
            { sku: "FAKE-LINT3", title: "Fake lint roller" },
            { sku: "SH_FAKE-LINTR1", title: "Fake lint roller, Shopsy listing" },
            { sku: "FAKE-CLEAN-KIT", title: "Fake laptop cleaning kit, 500 ml, with microfibre cloth, pack of one" },
            { sku: "S_FAKE-ALLIN1", title: "Fake all-in-one repellent spray" },
            { sku: "FAKE-NEW-THING", title: null },
          ]}
          sold={{ "SH_FAKE-LINTR1": 66, "FAKE-CLEAN-KIT": 360, "S_FAKE-ALLIN1": 22 }}
          canReplace
        />
      ) : null}
      {health ? <HealthTab rows={health.rows} total={health.total} taxUnread={0} slaLimit={2} /> : null}
    </>
  );
}
