import type { Tone } from "@/lib/labels";
import type { NotificationRow } from "@/lib/types";

// Alerts are the notifications that ask for action (a sync is down, orders may miss dispatch, stock is running out). They
// pop up when the site opens; everything else (comments, assignments, "done") is an update and waits in the list.

/** Most urgent first: this order is the order of the alert cards. */
export const ALERT_KINDS = [
  "sync_alert",
  "dispatch_risk",
  "stock_alert",
  "overdue",
  "listing_not_found",
  "capacity_alert",
  "follow_up",
  "money_reminder",
] as const;

const RANK = new Map<string, number>(ALERT_KINDS.map((k, i) => [k, i]));

export function isAlertKind(kind: string): boolean {
  return RANK.has(kind);
}

export const KIND_TONE: Record<string, Tone> = {
  assigned: "accent",
  comment: "info",
  done: "ok",
  overdue: "bad",
  follow_up: "warn",
  test: "neutral",
  dispatch_risk: "bad",
  listing_live: "ok",
  listing_not_found: "bad",
  money_reminder: "info",
  stock_alert: "bad",
  capacity_alert: "warn",
  sync_alert: "bad",
};

export function kindTone(kind: string): Tone {
  return KIND_TONE[kind] ?? "neutral";
}

export type AlertGroup = {
  kind: string;
  /** The newest of the kind: its title and body are shown. */
  latest: NotificationRow;
  /** Every unread one of the kind, so "Mark read" clears them all. */
  ids: string[];
};

/** Unread alerts as one group per kind, newest on top of each, the most urgent kind first. */
export function groupAlerts(items: NotificationRow[]): AlertGroup[] {
  const groups = new Map<string, AlertGroup>();
  const newestFirst = [...items].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  for (const n of newestFirst) {
    if (n.read_at || !isAlertKind(n.kind)) continue;
    const g = groups.get(n.kind);
    if (g) g.ids.push(n.id);
    else groups.set(n.kind, { kind: n.kind, latest: n, ids: [n.id] });
  }
  return [...groups.values()].sort((a, b) => (RANK.get(a.kind) ?? 99) - (RANK.get(b.kind) ?? 99));
}

export type AlertLine = { text: string; badge?: { label: string; tone: Tone } };

/**
 * An alert's body as a lead sentence and short lines, for a card that reads at a glance on a phone. The database writes
 * bodies as "a · b · c"; a stock line ends "OUT" or "6d" (days of cover) and a dispatch line ends with a count, and those
 * become badges. A body without " · " is just the lead.
 */
export function alertLines(kind: string, body: string | null | undefined): { lead: string | null; lines: AlertLine[] } {
  const text = (body ?? "").trim();
  if (!text) return { lead: null, lines: [] };
  let lead: string | null = null;
  let rest = text;
  if (kind === "stock_alert") {
    const at = text.indexOf(": ");
    if (at > 0) {
      lead = text.slice(0, at);
      rest = text.slice(at + 2);
    }
  }
  const lines = rest
    .split(" · ")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => lineFor(kind, p));
  // A plain sentence stays a sentence; one line with a badge (a single warehouse) is still a line.
  if (!lead && lines.length < 2 && !lines.some((l) => l.badge)) return { lead: text, lines: [] };
  return { lead, lines };
}

function lineFor(kind: string, part: string): AlertLine {
  if (kind === "stock_alert") {
    const out = /^(.*\S)\s+OUT$/.exec(part);
    if (out) return { text: out[1], badge: { label: "Out", tone: "bad" } };
    const days = /^(.*\S)\s+(\d+)d$/.exec(part);
    if (days) {
      const d = Number(days[2]);
      return { text: days[1], badge: { label: `${d}d left`, tone: d <= 3 ? "bad" : "warn" } };
    }
  }
  if (kind === "dispatch_risk") {
    const count = /^(.*\D)\s+(\d+)$/.exec(part);
    if (count) return { text: count[1], badge: { label: `${count[2]} ${count[2] === "1" ? "order" : "orders"}`, tone: "bad" } };
  }
  if (kind === "capacity_alert") {
    // "Bhiwandi 20 Oct: 2,350 orders, room for 2,000" → Bhiwandi 20 Oct, 350 over.
    const cap = /^(.*?):\s*([\d,]+) orders?, room for ([\d,]+)/.exec(part);
    if (cap) {
      const orders = Number(cap[2].replace(/,/g, ""));
      const room = Number(cap[3].replace(/,/g, ""));
      const over = Math.max(0, orders - room);
      return { text: cap[1], badge: { label: `${over.toLocaleString("en-IN")} over`, tone: over > room * 0.2 ? "bad" : "warn" } };
    }
  }
  return { text: part };
}

/** "just now", "12m ago", "3h ago", "2d ago". */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
