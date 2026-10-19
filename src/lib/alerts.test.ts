import assert from "node:assert/strict";
import { test } from "node:test";
import { alertLines, groupAlerts, isAlertKind, timeAgo } from "./alerts.ts";
import { notificationUrl } from "./notifications.ts";
import type { NotificationRow } from "./types.ts";

const note = (id: string, kind: string, minutesAgo: number, extra: Partial<NotificationRow> = {}): NotificationRow => ({
  id,
  user_id: "u",
  kind,
  title: `${kind} ${id}`,
  body: null,
  post_id: null,
  ticket_id: null,
  read_at: null,
  created_at: new Date(Date.UTC(2026, 9, 19, 6, 0) - minutesAgo * 60_000).toISOString(),
  ...extra,
});

test("alerts are grouped per kind, newest on top, most urgent kind first; updates and read ones are left out", () => {
  const groups = groupAlerts([
    note("a", "dispatch_risk", 90),
    note("b", "comment", 1),
    note("c", "stock_alert", 30),
    note("d", "dispatch_risk", 5),
    note("e", "sync_alert", 200),
    note("f", "capacity_alert", 10, { read_at: "2026-10-19T06:00:00Z" }),
  ]);
  assert.deepEqual(groups.map((g) => g.kind), ["sync_alert", "dispatch_risk", "stock_alert"]);
  assert.equal(groups[1].latest.id, "d", "the newest dispatch alert is the one shown");
  assert.deepEqual(groups[1].ids, ["d", "a"], "both dispatch alerts are cleared together");
  assert.ok(isAlertKind("money_reminder") && !isAlertKind("assigned"));
});

test("a stock alert reads as a lead and one line per product, with Out and days-left badges", () => {
  const r = alertLines("stock_alert", "Under 7 days of cover, soonest first: 8 in 1 Kit OUT · Car Perfume OUT · Black Rack 6d · BedBug 2d");
  assert.equal(r.lead, "Under 7 days of cover, soonest first");
  assert.deepEqual(r.lines, [
    { text: "8 in 1 Kit", badge: { label: "Out", tone: "bad" } },
    { text: "Car Perfume", badge: { label: "Out", tone: "bad" } },
    { text: "Black Rack", badge: { label: "6d left", tone: "warn" } },
    { text: "BedBug", badge: { label: "2d left", tone: "bad" } },
  ]);
});

test("a dispatch alert lists warehouses with their order counts; the earliest deadline stays plain", () => {
  const r = alertLines("dispatch_risk", "Bhiwandi 661 · Delhi 1 · earliest 18 Oct, 12:00 pm");
  assert.equal(r.lead, null);
  assert.deepEqual(r.lines, [
    { text: "Bhiwandi", badge: { label: "661 orders", tone: "bad" } },
    { text: "Delhi", badge: { label: "1 order", tone: "bad" } },
    { text: "earliest 18 Oct, 12:00 pm" },
  ]);
});

test("a capacity alert shows each warehouse and day with how many orders are over what the team can pack", () => {
  const r = alertLines("capacity_alert", "Bhiwandi 20 Oct: 2,350 orders, room for 2,000 · Delhi 21 Oct: 900 orders, room for 800. See the Team page to plan extra people.");
  assert.deepEqual(r.lines, [
    { text: "Bhiwandi 20 Oct", badge: { label: "350 over", tone: "warn" } },
    { text: "Delhi 21 Oct", badge: { label: "100 over", tone: "warn" } },
  ]);
  assert.equal(alertLines("capacity_alert", "Delhi 21 Oct: 1,500 orders, room for 800").lines[0].badge?.tone, "bad", "more than a fifth over is red");
});

test("a body with no list is just the lead; an empty body is nothing", () => {
  assert.deepEqual(alertLines("sync_alert", "No successful read for more than 7 hours."), { lead: "No successful read for more than 7 hours.", lines: [] });
  assert.deepEqual(alertLines("comment", null), { lead: null, lines: [] });
});

test("time ago", () => {
  const now = Date.UTC(2026, 9, 19, 6, 0);
  const at = (min: number) => new Date(now - min * 60_000).toISOString();
  assert.equal(timeAgo(at(0), now), "just now");
  assert.equal(timeAgo(at(12), now), "12m ago");
  assert.equal(timeAgo(at(185), now), "3h ago");
  assert.equal(timeAgo(at(60 * 50), now), "2d ago");
});

test("each new alert opens the right page", () => {
  const base = { post_id: null, ticket_id: null };
  assert.equal(notificationUrl({ ...base, kind: "stock_alert" }), "/flipkart?tab=forecast");
  assert.equal(notificationUrl({ ...base, kind: "capacity_alert" }), "/team");
  assert.equal(notificationUrl({ ...base, kind: "sync_alert", title: "Flipkart orders have not been read for 3 hours" }), "/flipkart?tab=orders");
  assert.equal(notificationUrl({ ...base, kind: "sync_alert", title: "Flipkart stock sync is not working" }), "/flipkart?tab=stock");
  assert.equal(notificationUrl({ ...base, kind: "sync_alert", title: "VR Prime stock sync is not working" }), "/flipkart?tab=forecast");
  assert.equal(notificationUrl({ ...base, kind: "sync_alert", title: "WhatsApp expenses are not being fetched" }), "/expenses");
});
