// Fake Command Deck data for the local preview only (/dev/preview?view=deck and deckclear). Not used in production.
import { KIND_TAG, rankQueue, SEVERITY, urgentCount, warehouseHealth, type QueueItem } from "@/lib/deck";
import { warehouseColor } from "@/lib/theme";
import type { DeckData } from "@/server/deck-data";

const WH = [
  { id: "w1", name: "Fake Bangalore", active: 412, late: 1, next: "2026-10-14T10:30:00Z", out: 9, units: 306_000, low: 49, stages: [120, 180, 112] },
  { id: "w2", name: "Fake Bhiwandi", active: 655, late: 0, next: "2026-10-14T16:00:00Z", out: 21, units: 1_092_000, low: 1, stages: [210, 300, 145] },
  { id: "w3", name: "Fake Delhi", active: 184, late: 0, next: "2026-10-14T09:00:00Z", out: 4, units: 554_000, low: 3, stages: [40, 90, 54] },
  { id: "w4", name: "Fake Kolkata", active: 96, late: 0, next: "2026-10-14T12:00:00Z", out: 12, units: 496_000, low: 6, stages: [20, 50, 26] },
  { id: "w5", name: "Fake Lucknow", active: 0, late: 0, next: null, out: 0, units: 346_000, low: 2, stages: [0, 0, 0] },
];

export function fakeDeck(clear: boolean): DeckData {
  const now = new Date();
  const q = (kind: QueueItem["kind"], key: string, title: string, detail: string, actions: QueueItem["actions"], deadline: number | null = null): QueueItem => ({ key, kind, severity: SEVERITY[kind], deadline, title, detail, actions });
  const items: QueueItem[] = clear
    ? []
    : [
        q("late", "o1", "Order OD3345678", "FAKE-SKU-A × 2 · 2 h 10 min late", [{ label: "View order", href: "/flipkart?tab=orders&view=list&q=OD3345678" }], 1),
        q("overfill", "of1", "FAKE-SKU-B", "3 orders (4 units) waiting at Fake Delhi, stock 0", [{ label: "Raise ticket", href: "/tickets/new" }, { label: "+ Restock", href: "/posts/new?type=restock" }]),
        q("dry", "d1", "VACMAP2", "Fake vacuum mop · 2,204 dispatched in the last 30 days, 0 in stock", [{ label: "+ Restock", href: "/posts/new?type=restock&sku=VACMAP2" }]),
        q("dry", "d2", "FAKE-SKU-C", "1,120 dispatched in the last 30 days, 0 in stock", [{ label: "+ Restock", href: "/posts/new?type=restock" }]),
        q("risk", "r1", "Order OD3345999", "FAKE-SKU-D × 1 · due in 54 min", [{ label: "View order", href: "/flipkart?tab=orders&view=list" }], 2),
        q("ticket", "t1", "VR-T-118 · FAKE-FK-CASE-0004712", "Follow-up: Due today · FAKE-SKU-A", [{ label: "Open", href: "/tickets/x" }], 3),
        q("work", "w1", "VR-1042 · Count shelf C", "Assigned to you · Due tomorrow", [{ label: "Open", href: "/posts/x" }], 4),
        q("work", "w2", "VR-1039 · Re-label returns bin", "Assigned to you · No due date", [{ label: "Open", href: "/posts/y" }]),
      ];
  const queue = rankQueue(items).map((i) => ({ ...i, tag: KIND_TAG[i.kind] }));
  const lateTotal = clear ? 0 : 1;
  return {
    firstName: "Test",
    nowIso: now.toISOString(),
    today: now.toISOString().slice(0, 10),
    hero: clear
      ? { tone: "ok", headline: "You're all caught up", reassurance: "Nothing is urgent. 1,251 of 1,251 active orders are on time." }
      : { tone: "bad", headline: "1 order is late, and 2 selling SKUs are out of stock", reassurance: "1,250 of 1,251 active orders are on time." },
    urgent: urgentCount(queue),
    pulses: [
      { key: "late", label: "Late dispatch", value: lateTotal, tone: lateTotal ? "bad" : "cyan", sub: lateTotal ? "past their dispatch-by time" : "nothing past its deadline", spark: [8, 5, 3, lateTotal], sparkLabel: "Late orders", href: "/flipkart?tab=orders" },
      { key: "out", label: "Out of stock", value: clear ? 0 : 34, tone: clear ? "cyan" : "warn", sub: clear ? "active listings with no units" : "2 of them selling", spark: [30, 31, 34], sparkLabel: "Out of stock", href: "/flipkart?tab=stock" },
      { key: "tomorrow", label: "Due tomorrow", value: 1920, tone: "cyan", sub: "orders with a deadline tomorrow", spark: [1710, 1920, 927, 370, 302, 240, 190], sparkLabel: "Due per day", href: "/flipkart?tab=orders" },
    ],
    queue,
    warehouses: WH.map((w, i) => ({ id: w.id, name: w.name, color: warehouseColor(w.name, i), health: warehouseHealth({ active: w.active, late: clear ? 0 : w.late, nextDue: w.next }, now), active: w.active, late: clear ? 0 : w.late, out: w.out, next: w.next ? "Today 4:00 pm" : null, href: "/flipkart?tab=stock" })),
    whStock: WH.map((w, i) => ({ id: w.id, name: w.name, color: warehouseColor(w.name, i), units: w.units, out: w.out, low: w.low })),
    whStages: WH.map((w, i) => ({ id: w.id, name: w.name, color: warehouseColor(w.name, i), to_accept: w.stages[0], to_pack: w.stages[1], to_dispatch: w.stages[2] })),
    dispatch: { points: [["Thu", 812], ["Fri", 905], ["Sat", 1040], ["Sun", 770], ["Mon", 1180], ["Tue", 1295], ["Wed", 1004]].map(([label, value]) => ({ label: label as string, value: value as number })), total: 7006, avg: 1001 },
    kpis: {
      units: 2_468_440,
      unitsChange: -3_120,
      low: 58,
      out: clear ? 0 : 34,
      weight: 12,
      openTickets: 7,
      stockSeries: { units: [2_480_000, 2_471_560, 2_468_440], low: [51, 55, 58], out: [30, 31, 34] },
      ticketSeries: [0, 1, 0, 2, 0, 0, 1, 0, 3, 0, 1, 0, 0, 2],
      snapshot: "2026-10-14",
    },
    movers: [
      { sku: "LINT1", title: "Fake lint remover", f30: 4552, rate: 151.7, cover: 74.7, share: 1 },
      { sku: "VACMAP2", title: "Fake vacuum mop", f30: 2204, rate: 73.5, cover: 0, share: 0.48 },
      { sku: "FAKE-SKU-A", title: "Fake product A", f30: 1800, rate: 60, cover: 9.4, share: 0.4 },
      { sku: "FAKE-SKU-B", title: null, f30: 1100, rate: 36.7, cover: 18, share: 0.24 },
      { sku: "FAKE-SKU-C", title: "Fake product C", f30: 700, rate: 23.3, cover: null, share: 0.15 },
    ],
    moversDays: 30,
    notes: [],
  };
}
