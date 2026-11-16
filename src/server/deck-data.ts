import "server-only";
import { forUser } from "@/server/short-cache-user";
import { dispatchToday, dryAndSelling, heroFor, KIND_TAG, ordersTrend, outOfStock, outOfStockSub, rankQueue, SEVERITY, urgentCount, warehouseHealth, type Health, type Hero, type LoadRow, type OutOfStock, type QueueItem } from "@/lib/deck";
import { ticketHref } from "@/lib/flipkart-analysis";
import { buildRows, topMovers } from "@/lib/forecast";
import { dueLabel, formatDateTime, formatNumber, postNumber, ticketNumber, todayIST } from "@/lib/format";
import { readCards, readOrderLines } from "@/lib/orders-view";
import { logError } from "@/lib/redact";
import { restockHref } from "@/lib/stock-analysis";
import { defaultStockQuery } from "@/lib/stock-view";
import { createClient } from "@/lib/supabase/server";
import { warehouseColor } from "@/lib/theme";
import { ACTIVE_STATUSES, type SessionUser } from "@/lib/types";
import { loadEmpties, warehousesFor } from "@/server/flipkart-data";
import { loadOrderCounts } from "@/server/orders-view";
import { loadStockDesk } from "@/server/stock-view";
import { loadTeamCapacity, type Loose } from "@/server/team-data";

const HOUR = 3_600_000;

type Series = { stock: { day: string; units: number; out: number; low: number }[]; due: { day: string; n: number }[]; tickets: { day: string; n: number }[] };

export type DeckWarehouse = { id: string; name: string; color: string; health: Health; active: number; late: number; out: number | null; next: string | null; href: string };

/** One warehouse's stock (active listings) and its empty and low SKUs, for the deck's breakdown charts. */
export type WarehouseStock = { id: string; name: string; color: string; units: number; out: number; low: number };
/** One warehouse's active orders by Seller Hub stage. */
export type WarehouseStages = { id: string; name: string; color: string; to_accept: number; to_pack: number; to_dispatch: number };

/** The top card: orders still to go out today, against what the team packs, with yesterday and the last week. */
export type TodayCard = {
  due: number;
  /** Orders already past their dispatch time (the Late dispatch tile's number). */
  late: number;
  warehouses: number;
  busiest: { name: string; color: string; orders: number } | null;
  /** What the team packs comfortably in a day. Owner and admin only; null when nobody is set up. */
  capacity: { comfortable: number; staff: number } | null;
  yesterday: number | null;
  yesterdayChange: number | null;
  avg7: number | null;
  avg7Change: number | null;
};

export type DeckData = {
  firstName: string;
  nowIso: string;
  today: string;
  hero: Hero;
  urgent: number;
  pulses: { key: string; label: string; value: number; tone: "bad" | "warn" | "cyan"; sub: string; spark: number[]; sparkLabel: string; href: string }[];
  queue: (QueueItem & { tag: string })[];
  warehouses: DeckWarehouse[];
  /** Empty when stock has not been read yet. */
  whStock: WarehouseStock[];
  whStages: WarehouseStages[];
  dispatch: { points: { label: string; value: number }[]; total: number; avg: number } | null;
  /** Null when the orders have not been read yet. */
  todayCard: TodayCard | null;
  /** Orders placed per day, the last 14 full days, oldest first. */
  trend: { day: string; label: string; orders: number }[];
  kpis: {
    units: number | null;
    unitsChange: number | null;
    low: number | null;
    out: number | null;
    weight: number | null;
    openTickets: number;
    stockSeries: { units: number[]; low: number[]; out: number[] };
    ticketSeries: number[];
    snapshot: string | null;
  };
  movers: { sku: string; title: string | null; f30: number; rate: number; cover: number | null; share: number }[];
  moversDays: number;
  notes: string[];
};

const weekday = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short" });
const dayMonth = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short" });

function minutesWord(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ${m % 60 ? `${m % 60} min` : ""}`.trim() : `${Math.floor(h / 24)} d`;
}

/** Reads a small answer, and logs and falls back when it fails: one broken panel does not take the whole deck down. */
async function soft<T>(what: string, fallback: T, run: () => PromiseLike<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    logError(`deck ${what}`, error);
    return fallback;
  }
}

const rows = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v.filter((x) => typeof x === "object" && x !== null) as Record<string, unknown>[]) : []);

/** team_order_load's rows, kept only when they have the expected shape. */
function readLoad(data: unknown): LoadRow[] {
  return rows(data)
    .filter((r) => (r.kind === "placed" || r.kind === "due") && typeof r.day === "string" && typeof r.orders === "number")
    .map((r) => ({
      kind: r.kind as LoadRow["kind"],
      day: (r.day as string).slice(0, 10),
      warehouse_id: typeof r.warehouse_id === "string" ? r.warehouse_id : null,
      orders: r.orders as number,
    }));
}

/** Logs a failed query the way the deck always has, and passes the answer on unchanged. */
function logged<T extends { error: unknown }>(answer: PromiseLike<T>): Promise<T> {
  return Promise.resolve(answer).then((r) => {
    if (r.error) logError("deck", r.error);
    return r;
  });
}

/** Every loader the deck reads, all started at once; each section then waits only for the answers it uses. */
function startLoaders(user: SessionUser, supabase: Awaited<ReturnType<typeof createClient>>, today: string) {
  return {
    warehouses: warehousesFor(user),
    counts: soft("order counts", null as unknown, () => loadOrderCounts(supabase)),
    desk: soft("stock", null, () => loadStockDesk(user, defaultStockQuery("out", { hide: true }), 1)),
    empties: soft("overfill", [], () => loadEmpties(supabase)),
    lineRes: logged(supabase.rpc("flipkart_order_lines", { p_wh: null, p_status: "active", p_q: null, p_sort: "due", p_dir: "asc", p_limit: 16, p_offset: 0 })),
    series: soft("series", null as Series | null, async () => {
      const { data, error } = await forUser("deck_series", [{ p_low: 100 }], async () => await supabase.rpc("deck_series", { p_low: 100 }));
      if (error) throw error;
      return data as Series;
    }),
    dispatchRes: logged(forUser("dispatch_series", [{ p_days: 7 }], async () => await supabase.rpc("dispatch_series", { p_days: 7 }))),
    followUps: logged(supabase.from("tickets").select("id, number, ticket_id, sku, next_follow_up, status").in("status", ["open", "waiting_marketplace"]).lte("next_follow_up", today).order("next_follow_up").limit(12)),
    openTickets: logged(supabase.from("tickets").select("id", { count: "exact", head: true }).in("status", ["open", "waiting_marketplace"])),
    mine: logged(supabase.from("posts").select("id, number, title, priority, priority_rank, status, due_date").eq("assignee_id", user.id).in("status", ACTIVE_STATUSES).order("due_date", { ascending: true, nullsFirst: false }).limit(12)),
    // Orders placed per day (the last 15 days) and still waiting by dispatch day: the top card and the orders graph.
    load: soft("order load", [] as LoadRow[], async () => {
      const { data, error } = await forUser("team_order_load", [{ p_days: 15 }], async () => await (supabase as unknown as Loose).rpc("team_order_load", { p_days: 15 }));
      if (error) throw error;
      return readLoad(data);
    }),
    // Staff and attendance are owner and admin only; a warehouse user gets the card without the capacity bar.
    capacity: user.role === "warehouse" ? Promise.resolve(null) : soft("team capacity", null, () => loadTeamCapacity(supabase as unknown as Loose, today)),
  };
}
type Loaders = ReturnType<typeof startLoaders>;

/** The order counts per warehouse (fast): the cards and their totals, with each warehouse's name and colour. */
async function ordersBase(L: Loaders) {
  const [warehouses, counts] = await Promise.all([L.warehouses, L.counts]);
  const nameOf = (id: string | null) => warehouses.find((w) => w.id === id)?.name ?? "a warehouse";
  const colorOf = (id: string, name: string) => warehouseColor(name, warehouses.findIndex((w) => w.id === id));
  const cards = readCards(counts, warehouses).filter((c) => c.warehouseId);
  return {
    cards,
    nameOf,
    colorOf,
    lateTotal: cards.reduce((n, c) => n + c.late, 0),
    activeTotal: cards.reduce((n, c) => n + c.active, 0),
    tomorrowTotal: cards.reduce((n, c) => n + c.tomorrow, 0),
  };
}

/** The stock desk (slow): days of cover, the forecast, selling SKUs with no stock, and orders waiting where stock is 0. */
async function stockBase(L: Loaders) {
  const [desk, empties] = await Promise.all([L.desk, L.empties]);
  const cover = desk && desk.kind === "ready" ? desk.cover : null;
  const forecast = cover?.forecast ?? [];
  // Matched against the Stock tab's own out-of-stock list, so "selling" never counts SKUs the tile cannot see.
  const out: OutOfStock = desk && desk.kind === "ready" ? outOfStock(desk.page.data) : new Map();
  const dry = dryAndSelling(forecast, out);
  const overfill = [...empties].sort((a, b) => b.units - a.units || a.sku.localeCompare(b.sku));
  const overfillSkus = new Set(overfill.map((e) => e.sku));
  const dryOnly = dry.filter((d) => !overfillSkus.has(d.sku));
  return { desk, cover, forecast, dry, overfill, dryOnly };
}

type FollowUp = { id: string; number: number; ticket_id: string; sku: string | null; next_follow_up: string };
type MyPost = { id: string; number: number; title: string; due_date: string | null };

/** Ticket follow-ups due and work assigned to me: the queue rows that need no order or stock data. */
function workItems(followUps: FollowUp[], mine: MyPost[], today: string): QueueItem[] {
  const items: QueueItem[] = [];
  for (const t of followUps) {
    items.push({
      key: `ticket-${t.id}`,
      kind: "ticket",
      severity: SEVERITY.ticket,
      deadline: Date.parse(`${t.next_follow_up}T00:00:00+05:30`),
      title: `${ticketNumber(t.number)} · ${t.ticket_id}`,
      detail: `Follow-up: ${dueLabel(t.next_follow_up, today)}${t.sku ? ` · ${t.sku}` : ""}`,
      actions: [{ label: "Open", href: `/tickets/${t.id}` }],
    });
  }
  for (const p of mine) {
    const overdue = p.due_date !== null && p.due_date < today;
    items.push({
      key: `work-${p.id}`,
      kind: "work",
      severity: overdue ? SEVERITY.ticket : SEVERITY.work,
      deadline: p.due_date ? Date.parse(`${p.due_date}T00:00:00+05:30`) : null,
      title: `${postNumber(p.number)} · ${p.title}`,
      detail: `Assigned to you · ${dueLabel(p.due_date, today)}`,
      actions: [{ label: "Open", href: `/posts/${p.id}` }],
    });
  }
  return items;
}

/** Late and at-risk orders, orders with no stock, and selling SKUs that are dry: the queue rows from orders and stock. */
function orderItems(o: Awaited<ReturnType<typeof ordersBase>>, s: Awaited<ReturnType<typeof stockBase>>, lineData: unknown, now: Date): QueueItem[] {
  const items: QueueItem[] = [];
  const lines = readOrderLines(lineData).rows.filter((l) => !l.hold && l.dispatch_by);
  let lateShown = 0;
  let riskShown = 0;
  for (const l of lines) {
    const due = Date.parse(l.dispatch_by as string);
    const late = due < now.getTime();
    if (late && lateShown >= 5) continue;
    if (!late && (due - now.getTime() > 3 * HOUR || riskShown >= 3)) continue;
    if (late) lateShown++;
    else riskShown++;
    items.push({
      key: `order-${l.order_item_id}`,
      kind: late ? "late" : "risk",
      severity: late ? SEVERITY.late : SEVERITY.risk,
      deadline: due,
      title: `Order ${l.order_id}`,
      detail: `${l.sku ?? "No SKU"} × ${formatNumber(l.quantity)} · ${late ? `${minutesWord(now.getTime() - due)} late` : `due in ${minutesWord(due - now.getTime())}`}`,
      actions: [{ label: "View order", href: `/flipkart?tab=orders&view=list&q=${encodeURIComponent(l.order_id)}` }],
    });
  }
  const { lateTotal, nameOf } = o;
  const { overfill, dryOnly, cover } = s;
  if (lateTotal > lateShown) {
    items.push({
      key: "late-more",
      kind: "late",
      severity: SEVERITY.late,
      deadline: Number.MAX_SAFE_INTEGER - 1,
      title: `${formatNumber(lateTotal - lateShown)} more late ${lateTotal - lateShown === 1 ? "order" : "orders"}`,
      detail: "All late orders, earliest deadline first",
      actions: [{ label: "View orders", href: "/flipkart?tab=orders&view=list" }],
    });
  }
  for (const e of overfill.slice(0, 5)) {
    items.push({
      key: `overfill-${e.sku}-${e.warehouseId}`,
      kind: "overfill",
      severity: SEVERITY.overfill,
      deadline: null,
      title: e.sku,
      detail: `${formatNumber(e.orders)} ${e.orders === 1 ? "order" : "orders"} (${formatNumber(e.units)} ${e.units === 1 ? "unit" : "units"}) waiting at ${nameOf(e.warehouseId)}, stock 0`,
      actions: [
        { label: "Raise ticket", href: ticketHref(e.sku) },
        { label: "+ Restock", href: restockHref(e.sku, e.warehouseId) },
      ],
    });
  }
  if (overfill.length > 5) {
    items.push({ key: "overfill-more", kind: "overfill", severity: SEVERITY.overfill, deadline: Number.MAX_SAFE_INTEGER - 1, title: `${formatNumber(overfill.length - 5)} more SKUs with orders and no stock`, detail: "All of them are on the Overfill Orders tab", actions: [{ label: "Open", href: "/flipkart?tab=overfill" }] });
  }
  for (const d of dryOnly.slice(0, 5)) {
    items.push({
      key: `dry-${d.sku}`,
      kind: "dry",
      severity: SEVERITY.dry,
      deadline: null,
      title: d.sku,
      detail: `${d.title ? `${d.title} · ` : ""}${formatNumber(d.disp)} dispatched in the last ${formatNumber(cover?.days ?? 0)} days, 0 in stock${d.inactive ? ", listing inactive" : ""}`,
      actions: [{ label: "+ Restock", href: restockHref(d.sku, null) }],
    });
  }
  if (dryOnly.length > 5) {
    // Inactive listings only show on the Stock tab with "Hide inactive" off.
    const href = dryOnly.some((d) => d.inactive) ? "/flipkart?tab=stock&view=out" : "/flipkart?tab=stock&view=out&hide=1";
    items.push({ key: "dry-more", kind: "dry", severity: SEVERITY.dry, deadline: Number.MAX_SAFE_INTEGER - 1, title: `${formatNumber(dryOnly.length - 5)} more selling SKUs out of stock`, detail: "Busiest first on the Stock tab", actions: [{ label: "Open", href }] });
  }
  return items;
}

const tagged = (items: QueueItem[]): DeckData["queue"] => rankQueue(items).map((i) => ({ ...i, tag: KIND_TAG[i.kind] }));

/**
 * The Command Centre, one promise per part of the page, so each part shows as soon as its own answers are in (the
 * header and the work queue at once; the stock, the orders graph and the charts as their loaders finish). Every loader
 * starts at once, exactly as before, and every number is worked out by the same code.
 */
export type DeckParts = {
  meta: Pick<DeckData, "firstName" | "nowIso" | "today">;
  head: Promise<Pick<DeckData, "hero" | "notes">>;
  todayCard: Promise<Pick<DeckData, "todayCard" | "trend">>;
  pulses: Promise<Pick<DeckData, "pulses">>;
  flow: Promise<Pick<DeckData, "warehouses" | "whStages">>;
  orderQueue: Promise<Pick<DeckData, "queue">>;
  workQueue: Promise<{ queue: DeckData["queue"]; openTickets: number }>;
  dispatch: Promise<Pick<DeckData, "dispatch">>;
  stockHealth: Promise<Pick<DeckData, "kpis">>;
  whStock: Promise<Pick<DeckData, "whStock">>;
  movers: Promise<Pick<DeckData, "movers" | "moversDays">>;
};

export async function startDeck(user: SessionUser): Promise<DeckParts> {
  const supabase = await createClient();
  const now = new Date();
  const today = todayIST(now);
  const L = startLoaders(user, supabase, today);
  const ob = ordersBase(L);
  const sb = stockBase(L);
  const work = Promise.all([L.followUps, L.mine]).then(([f, m]) => workItems((f.data ?? []) as FollowUp[], (m.data ?? []) as MyPost[], today));

  const head = Promise.all([ob, sb, L.followUps]).then(([o, s, followUps]) => {
    const notes: string[] = [];
    if (s.desk && s.desk.kind === "empty") notes.push("Stock has not been read from Flipkart yet, so stock numbers are not shown.");
    const followUpsDue = (followUps.data ?? []).length;
    return { hero: heroFor({ lateOrders: o.lateTotal, dry: s.dry, overfillSkus: s.overfill.length, followUpsDue, onTime: Math.max(0, o.activeTotal - o.lateTotal), active: o.activeTotal }), notes };
  });

  // ---- Today's dispatch and the orders graph -------------------------------------------------------------------------
  const todayCard = Promise.all([ob, L.load, L.capacity]).then(([o, load, capacity]) => {
    const t = dispatchToday(load, today);
    const card: TodayCard | null = load.length
      ? {
          due: t.due,
          late: o.lateTotal,
          warehouses: t.warehouses,
          busiest: t.busiest ? { name: o.nameOf(t.busiest.id), color: o.colorOf(t.busiest.id, o.nameOf(t.busiest.id)), orders: t.busiest.orders } : null,
          capacity,
          yesterday: t.yesterday,
          yesterdayChange: t.yesterdayChange,
          avg7: t.avg7,
          avg7Change: t.avg7Change,
        }
      : null;
    const trend = ordersTrend(load, today).map((p) => ({ ...p, label: dayMonth.format(new Date(`${p.day}T00:00:00Z`)) }));
    return { todayCard: card, trend };
  });

  // ---- Pulses -----------------------------------------------------------------------------------------------------
  const pulses = Promise.all([ob, sb, L.series]).then(([o, s, series]) => {
    const due = series?.due ?? [];
    const dueByDay = (from: number, to: number) => due.slice(from, to).map((d) => d.n);
    const tiles = s.desk && s.desk.kind === "ready" ? s.desk.view.tiles : null;
    const stockSeries = series?.stock ?? [];
    const outNow = tiles ? tiles.out : null;
    const list: DeckData["pulses"] = [
      { key: "late", label: "Late dispatch", value: o.lateTotal, tone: o.lateTotal > 0 ? "bad" : "cyan", sub: o.lateTotal > 0 ? "past their dispatch-by time" : "nothing past its deadline", spark: dueByDay(0, 4), sparkLabel: "Orders still waiting, by the day they were due, last 3 days and today", href: "/flipkart?tab=orders&view=list" },
      { key: "out", label: "Out of stock", value: outNow ?? 0, tone: (outNow ?? 0) > 0 ? "warn" : "cyan", sub: outOfStockSub(s.dry), spark: stockSeries.map((x) => x.out), sparkLabel: "SKUs out of stock at each stock reading", href: "/flipkart?tab=stock&view=out&hide=1" },
      { key: "tomorrow", label: "Due tomorrow", value: o.tomorrowTotal, tone: "cyan", sub: "orders with a deadline tomorrow", spark: dueByDay(3, 10), sparkLabel: "Orders due per day, today and the next 6 days", href: "/flipkart?tab=orders&view=list" },
    ];
    return { pulses: list };
  });

  // ---- Warehouses -------------------------------------------------------------------------------------------------
  const flow = Promise.all([ob, L.desk]).then(([o, desk]) => {
    const stockCards = desk && desk.kind === "ready" ? desk.view.cards : [];
    const warehouses: DeckWarehouse[] = o.cards.map((c) => ({
      id: c.warehouseId as string,
      name: c.name,
      color: o.colorOf(c.warehouseId as string, c.name),
      health: warehouseHealth(c, now),
      active: c.active,
      late: c.late,
      out: stockCards.find((x) => x.id === c.warehouseId)?.empty ?? null,
      next: c.nextDue ? formatDateTime(c.nextDue, now) : null,
      href: `/flipkart?tab=stock&wh=${c.warehouseId}`,
    }));
    const whStages: WarehouseStages[] = o.cards.map((c) => ({ id: c.warehouseId as string, name: c.name, color: o.colorOf(c.warehouseId as string, c.name), to_accept: c.to_accept, to_pack: c.to_pack, to_dispatch: c.to_dispatch }));
    return { warehouses, whStages };
  });
  const whStock = Promise.all([ob, L.desk]).then(([o, desk]) => {
    const stockCards = desk && desk.kind === "ready" ? desk.view.cards : [];
    return { whStock: stockCards.map((x) => ({ id: x.id, name: x.name, color: o.colorOf(x.id, x.name), units: x.units, out: x.empty, low: x.low })) };
  });

  // ---- The queues: the ranking is a sort, so the work rows rank the same on their own as among the order rows ------
  const orderQueue = Promise.all([ob, sb, L.lineRes, work]).then(([o, s, lineRes, w]) => ({ queue: tagged([...orderItems(o, s, lineRes.data, now), ...w]) }));
  const workQueue = Promise.all([work, L.openTickets]).then(([w, open]) => ({ queue: tagged(w), openTickets: open.count ?? 0 }));

  // ---- Dispatch chart -----------------------------------------------------------------------------------------------
  const dispatch = L.dispatchRes.then((dispatchRes) => {
    const disp = rows(dispatchRes.data).map((r) => ({ label: weekday.format(new Date(`${String(r.day).slice(0, 10)}T12:00:00+05:30`)), value: Number(r.units) || 0 }));
    const dispatchTotal = disp.reduce((n, d) => n + d.value, 0);
    return { dispatch: disp.length ? { points: disp, total: dispatchTotal, avg: Math.round(dispatchTotal / disp.length) } : null };
  });

  // ---- Stock health -------------------------------------------------------------------------------------------------
  const stockHealth = Promise.all([L.desk, L.series, L.openTickets]).then(([desk, series, openTickets]) => {
    const tiles = desk && desk.kind === "ready" ? desk.view.tiles : null;
    const stockSeries = series?.stock ?? [];
    return {
      kpis: {
        units: tiles ? tiles.units : null,
        unitsChange: tiles ? tiles.unitsChange : null,
        low: tiles ? tiles.low : null,
        out: tiles ? tiles.out : null,
        weight: tiles ? tiles.weight : null,
        openTickets: openTickets.count ?? 0,
        stockSeries: { units: stockSeries.map((x) => x.units), low: stockSeries.map((x) => x.low), out: stockSeries.map((x) => x.out) },
        ticketSeries: (series?.tickets ?? []).map((t) => t.n),
        snapshot: desk && desk.kind === "ready" ? desk.meta.snapshotDate : null,
      },
    };
  });

  // ---- Movers -----------------------------------------------------------------------------------------------------
  const movers = sb.then((s) => {
    const moversRows = topMovers(buildRows(s.forecast, s.cover?.days ?? 0, false), 5).filter((r) => r.f30 > 0);
    const topF30 = Math.max(...moversRows.map((m) => m.f30), 1);
    return { movers: moversRows.map((m) => ({ sku: m.sku, title: m.title, f30: m.f30, rate: m.rate, cover: m.cover, share: m.f30 / topF30 })), moversDays: s.cover?.days ?? 0 };
  });

  const parts = { head, todayCard, pulses, flow, orderQueue, workQueue, dispatch, stockHealth, whStock, movers };
  // A part that fails shows its section's error; this only stops Node reporting it before the section has asked.
  for (const part of Object.values(parts)) part.catch(() => undefined);
  return { meta: { firstName: user.name.split(" ")[0], nowIso: now.toISOString(), today }, ...parts };
}

/** The whole deck at once (the Dashboard shows it in one piece): the same parts, put together. */
export async function loadDeck(user: SessionUser): Promise<DeckData> {
  const { meta, ...p } = await startDeck(user);
  const [head, today, pulses, flow, orders, dispatch, health, whStock, movers] = await Promise.all([p.head, p.todayCard, p.pulses, p.flow, p.orderQueue, p.dispatch, p.stockHealth, p.whStock, p.movers]);
  return { ...meta, ...head, urgent: urgentCount(orders.queue), ...pulses, queue: orders.queue, ...flow, ...whStock, ...dispatch, ...today, ...health, ...movers };
}
