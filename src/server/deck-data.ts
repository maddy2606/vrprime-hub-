import "server-only";
import { dryAndSelling, heroFor, KIND_TAG, outOfStock, outOfStockSub, rankQueue, SEVERITY, urgentCount, warehouseHealth, type Health, type Hero, type OutOfStock, type QueueItem } from "@/lib/deck";
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

const HOUR = 3_600_000;

type Series = { stock: { day: string; units: number; out: number; low: number }[]; due: { day: string; n: number }[]; tickets: { day: string; n: number }[] };

export type DeckWarehouse = { id: string; name: string; color: string; health: Health; active: number; late: number; out: number | null; next: string | null; href: string };

/** One warehouse's stock (active listings) and its empty and low SKUs, for the deck's breakdown charts. */
export type WarehouseStock = { id: string; name: string; color: string; units: number; out: number; low: number };
/** One warehouse's active orders by Seller Hub stage. */
export type WarehouseStages = { id: string; name: string; color: string; to_accept: number; to_pack: number; to_dispatch: number };

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

export async function loadDeck(user: SessionUser): Promise<DeckData> {
  const supabase = await createClient();
  const now = new Date();
  const today = todayIST(now);

  const [warehouses, counts, desk, empties, lineRes, series, dispatchRes, followUps, openTickets, mine] = await Promise.all([
    warehousesFor(user),
    soft("order counts", null as unknown, () => loadOrderCounts(supabase)),
    soft("stock", null, () => loadStockDesk(user, defaultStockQuery("out", { hide: true }), 1)),
    soft("overfill", [], () => loadEmpties(supabase)),
    supabase.rpc("flipkart_order_lines", { p_wh: null, p_status: "active", p_q: null, p_sort: "due", p_dir: "asc", p_limit: 16, p_offset: 0 }),
    soft("series", null as Series | null, async () => {
      const { data, error } = await supabase.rpc("deck_series", { p_low: 100 });
      if (error) throw error;
      return data as Series;
    }),
    supabase.rpc("dispatch_series", { p_days: 7 }),
    supabase.from("tickets").select("id, number, ticket_id, sku, next_follow_up, status").in("status", ["open", "waiting_marketplace"]).lte("next_follow_up", today).order("next_follow_up").limit(12),
    supabase.from("tickets").select("id", { count: "exact", head: true }).in("status", ["open", "waiting_marketplace"]),
    supabase.from("posts").select("id, number, title, priority, priority_rank, status, due_date").eq("assignee_id", user.id).in("status", ACTIVE_STATUSES).order("due_date", { ascending: true, nullsFirst: false }).limit(12),
  ]);
  for (const r of [lineRes, dispatchRes, followUps, openTickets, mine]) if (r.error) logError("deck", r.error);

  const nameOf = (id: string | null) => warehouses.find((w) => w.id === id)?.name ?? "a warehouse";
  const colorOf = (id: string, name: string) => warehouseColor(name, warehouses.findIndex((w) => w.id === id));
  const cards = readCards(counts, warehouses).filter((c) => c.warehouseId);
  const lateTotal = cards.reduce((n, c) => n + c.late, 0);
  const activeTotal = cards.reduce((n, c) => n + c.active, 0);
  const tomorrowTotal = cards.reduce((n, c) => n + c.tomorrow, 0);

  const cover = desk && desk.kind === "ready" ? desk.cover : null;
  const forecast = cover?.forecast ?? [];
  // Matched against the Stock tab's own out-of-stock list, so "selling" never counts SKUs the tile cannot see.
  const out: OutOfStock = desk && desk.kind === "ready" ? outOfStock(desk.page.data) : new Map();
  const dry = dryAndSelling(forecast, out);
  const overfill = [...empties].sort((a, b) => b.units - a.units || a.sku.localeCompare(b.sku));
  const overfillSkus = new Set(overfill.map((e) => e.sku));
  const dryOnly = dry.filter((d) => !overfillSkus.has(d.sku));

  // ---- The queue -------------------------------------------------------------------------------------------------
  const items: QueueItem[] = [];
  const lines = readOrderLines(lineRes.data).rows.filter((l) => !l.hold && l.dispatch_by);
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
  for (const t of followUps.data ?? []) {
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
  for (const p of mine.data ?? []) {
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
  const queue = rankQueue(items).map((i) => ({ ...i, tag: KIND_TAG[i.kind] }));

  // ---- The hero ---------------------------------------------------------------------------------------------------
  const followUpsDue = (followUps.data ?? []).length;
  const hero = heroFor({ lateOrders: lateTotal, dry, overfillSkus: overfill.length, followUpsDue, onTime: Math.max(0, activeTotal - lateTotal), active: activeTotal });

  // ---- Pulses -----------------------------------------------------------------------------------------------------
  const due = series?.due ?? [];
  const dueByDay = (from: number, to: number) => due.slice(from, to).map((d) => d.n);
  const tiles = desk && desk.kind === "ready" ? desk.view.tiles : null;
  const stockSeries = series?.stock ?? [];
  const outNow = tiles ? tiles.out : null;
  const pulses: DeckData["pulses"] = [
    { key: "late", label: "Late dispatch", value: lateTotal, tone: lateTotal > 0 ? "bad" : "cyan", sub: lateTotal > 0 ? "past their dispatch-by time" : "nothing past its deadline", spark: dueByDay(0, 4), sparkLabel: "Orders still waiting, by the day they were due, last 3 days and today", href: "/flipkart?tab=orders&view=list" },
    { key: "out", label: "Out of stock", value: outNow ?? 0, tone: (outNow ?? 0) > 0 ? "warn" : "cyan", sub: outOfStockSub(dry), spark: stockSeries.map((s) => s.out), sparkLabel: "SKUs out of stock at each stock reading", href: "/flipkart?tab=stock&view=out&hide=1" },
    { key: "tomorrow", label: "Due tomorrow", value: tomorrowTotal, tone: "cyan", sub: "orders with a deadline tomorrow", spark: dueByDay(3, 10), sparkLabel: "Orders due per day, today and the next 6 days", href: "/flipkart?tab=orders&view=list" },
  ];

  // ---- Warehouses -------------------------------------------------------------------------------------------------
  const stockCards = desk && desk.kind === "ready" ? desk.view.cards : [];
  const whRows: DeckWarehouse[] = cards.map((c) => ({
    id: c.warehouseId as string,
    name: c.name,
    color: colorOf(c.warehouseId as string, c.name),
    health: warehouseHealth(c, now),
    active: c.active,
    late: c.late,
    out: stockCards.find((s) => s.id === c.warehouseId)?.empty ?? null,
    next: c.nextDue ? formatDateTime(c.nextDue, now) : null,
    href: `/flipkart?tab=stock&wh=${c.warehouseId}`,
  }));
  const whStock: WarehouseStock[] = stockCards.map((s) => ({ id: s.id, name: s.name, color: colorOf(s.id, s.name), units: s.units, out: s.empty, low: s.low }));
  const whStages: WarehouseStages[] = cards.map((c) => ({
    id: c.warehouseId as string,
    name: c.name,
    color: colorOf(c.warehouseId as string, c.name),
    to_accept: c.to_accept,
    to_pack: c.to_pack,
    to_dispatch: c.to_dispatch,
  }));

  // ---- Dispatch chart -----------------------------------------------------------------------------------------------
  const disp = rows(dispatchRes.data).map((r) => ({ label: weekday.format(new Date(`${String(r.day).slice(0, 10)}T12:00:00+05:30`)), value: Number(r.units) || 0 }));
  const dispatchTotal = disp.reduce((n, d) => n + d.value, 0);

  // ---- Movers -----------------------------------------------------------------------------------------------------
  const moversRows = topMovers(buildRows(forecast, cover?.days ?? 0, false), 5).filter((r) => r.f30 > 0);
  const topF30 = Math.max(...moversRows.map((m) => m.f30), 1);

  const notes: string[] = [];
  if (desk && desk.kind === "empty") notes.push("Stock has not been read from Flipkart yet, so stock numbers are not shown.");

  return {
    firstName: user.name.split(" ")[0],
    nowIso: now.toISOString(),
    today,
    hero,
    urgent: urgentCount(queue),
    pulses,
    queue,
    warehouses: whRows,
    whStock,
    whStages,
    dispatch: disp.length ? { points: disp, total: dispatchTotal, avg: Math.round(dispatchTotal / disp.length) } : null,
    kpis: {
      units: tiles ? tiles.units : null,
      unitsChange: tiles ? tiles.unitsChange : null,
      low: tiles ? tiles.low : null,
      out: tiles ? tiles.out : null,
      weight: tiles ? tiles.weight : null,
      openTickets: openTickets.count ?? 0,
      stockSeries: { units: stockSeries.map((s) => s.units), low: stockSeries.map((s) => s.low), out: stockSeries.map((s) => s.out) },
      ticketSeries: (series?.tickets ?? []).map((t) => t.n),
      snapshot: desk && desk.kind === "ready" ? desk.meta.snapshotDate : null,
    },
    movers: moversRows.map((m) => ({ sku: m.sku, title: m.title, f30: m.f30, rate: m.rate, cover: m.cover, share: m.f30 / topF30 })),
    moversDays: cover?.days ?? 0,
    notes,
  };
}
