import assert from "node:assert/strict";
import { test } from "node:test";
import { attendanceRate, capacityHeadline, combinePlans, DEFAULT_CAPACITY_SETTINGS, forecastOrders, planWarehouse, shiftDay } from "./capacity.ts";

const TODAY = "2026-10-18"; // a Sunday
const S = DEFAULT_CAPACITY_SETTINGS;

/** `n` full days before today, oldest first, each given by `f(i)`. */
const hist = (n: number, f: (i: number) => number): Record<string, number> =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [shiftDay(TODAY, -(n - i)), f(i)]));

test("under a week of history there is no forecast, and it says how much is missing", () => {
  const f = forecastOrders(hist(5, () => 300), TODAY);
  assert.deepEqual(f, { ready: false, haveDays: 5, needDays: 7 });
  assert.deepEqual(forecastOrders({}, TODAY), { ready: false, haveDays: 0, needDays: 7 });
});

test("a flat week forecasts the same number every day", () => {
  const f = forecastOrders(hist(14, () => 1000), TODAY);
  assert.ok(f.ready);
  assert.equal(f.level, 1000);
  assert.equal(Math.round(f.slopePerDay), 0);
  assert.equal(f.weeklyChangePct, 0);
  assert.ok(f.days.every((d) => d.orders === 1000));
  assert.equal(f.days.length, 14);
  assert.equal(f.days[0].day, "2026-10-19");
});

test("rising orders: the trend is positive and carried forward, but damped", () => {
  const f = forecastOrders(hist(28, (i) => 800 + i * 20), TODAY);
  assert.ok(f.ready);
  assert.ok(f.slopePerDay > 15 && f.slopePerDay < 25, `slope ${f.slopePerDay}`);
  assert.ok(f.weeklyChangePct! > 10, `weekly ${f.weeklyChangePct}`);
  const orders = f.days.map((d) => d.orders);
  assert.ok(orders[0] > f.level + 40, "tomorrow is well above the 7-day average, which lags a rising trend");
  assert.ok(Math.abs(orders[0] - (800 + 28 * 20)) < 60, `tomorrow ${orders[0]} is close to the next point on the line (1360)`);
  assert.ok(orders[13] > orders[0], "and it keeps rising");
  // damped: day 14 is far below an undamped straight line of level + 14 x slope
  assert.ok(orders[13] < f.level + 14 * f.slopePerDay);
});

test("falling orders never forecast below zero", () => {
  const f = forecastOrders(hist(14, (i) => Math.max(0, 140 - i * 12)), TODAY);
  assert.ok(f.ready);
  assert.ok(f.days.every((d) => d.orders >= 0));
});

test("history that starts mid-window is not padded with fake zeros before it began", () => {
  const f = forecastOrders(hist(9, () => 600), TODAY);
  assert.ok(f.ready);
  assert.equal(f.historyDays, 9);
  assert.equal(f.level, 600);
});

test("today is not counted: it is not finished", () => {
  const h = { ...hist(10, () => 500), [TODAY]: 3 };
  const f = forecastOrders(h, TODAY);
  assert.ok(f.ready && f.level === 500);
});

test("with three weeks of history each weekday gets its usual share", () => {
  // Mondays (day of week 1) are double the other days
  const h = Object.fromEntries(
    Array.from({ length: 28 }, (_, i) => {
      const day = shiftDay(TODAY, -(28 - i));
      return [day, new Date(`${day}T00:00:00Z`).getUTCDay() === 1 ? 2000 : 1000];
    }),
  );
  const f = forecastOrders(h, TODAY);
  assert.ok(f.ready);
  const monday = f.days.find((d) => new Date(`${d.day}T00:00:00Z`).getUTCDay() === 1)!;
  const tuesday = f.days.find((d) => new Date(`${d.day}T00:00:00Z`).getUTCDay() === 2)!;
  // Monday is really double, but a weekday's share is held to +30%, so the forecast says about 1.3x, not 2x
  assert.ok(monday.orders >= Math.round(tuesday.orders * 1.29), `${monday.orders} vs ${tuesday.orders}`);
  const week = f.days.slice(0, 7).reduce((n, d) => n + d.orders, 0);
  assert.ok(Math.abs(week - 7 * f.level) < 7 * f.level * 0.01, "the weekday shares move orders between days, not the week's total");
});

test("a sale that started on a Thursday is not learned as 'Thursdays are busy'", () => {
  // Four flat weeks at 1000 a day, but two of them had a sale on Thursday and Friday (the real Sept and Oct sales did).
  const saleDays = new Set([shiftDay(TODAY, -24), shiftDay(TODAY, -23), shiftDay(TODAY, -10), shiftDay(TODAY, -9)]);
  const h = Object.fromEntries(
    Array.from({ length: 28 }, (_, i) => {
      const day = shiftDay(TODAY, -(28 - i));
      return [day, saleDays.has(day) ? 1500 : 1000];
    }),
  );
  assert.ok([...saleDays].every((d) => new Date(`${d}T00:00:00Z`).getUTCDay() >= 4), "the sale days are a Thursday and Friday");
  const f = forecastOrders(h, TODAY);
  assert.ok(f.ready);
  const byWeekday = new Map(f.days.slice(0, 7).map((d) => [new Date(`${d.day}T00:00:00Z`).getUTCDay(), d.orders]));
  const spread = Math.max(...byWeekday.values()) / Math.min(...byWeekday.values());
  assert.ok(spread < 1.05, `every weekday forecasts about the same: ${[...byWeekday.entries()].join(" ")}`);
});

test("right after a sale, a falling last week is not forecast to rise again", () => {
  // 14 quiet days at 300, a sale week at 600, then a week falling back toward 350.
  const f = forecastOrders(hist(28, (i) => (i < 14 ? 300 : i < 21 ? 600 : 450 - (i - 21) * 15)), TODAY);
  assert.ok(f.ready);
  assert.ok(f.weeklyChangePct! < 0, `the last week is down: ${f.weeklyChangePct}`);
  assert.equal(f.slopePerDay, 0, "the two-week line still points up, but the last week says otherwise");
  assert.ok(f.days.every((d) => d.orders <= Math.round(f.level) + 1), "no rise is forecast");
});

test("one sale day does not lift the level or start a trend", () => {
  // Three steady weeks at 700 with small ups and downs, a sale day of 1,050 two days ago, then a quiet day.
  const f = forecastOrders(hist(28, (i) => (i === 26 ? 1050 : i === 27 ? 450 : 700 + ((i % 3) - 1) * 20)), TODAY);
  assert.ok(f.ready);
  assert.ok(Math.abs(f.level - 700) < 25, `the level stays near 700: ${f.level}`);
  assert.ok(f.days.every((d) => d.orders < 800), `no climb after the sale: ${f.days.map((d) => d.orders).join(" ")}`);
});

test("a trend moves the forecast by at most a fifth of the level", () => {
  const f = forecastOrders(hist(28, (i) => 400 + i * 40), TODAY);
  assert.ok(f.ready);
  assert.ok(f.days[13].orders <= Math.round(f.level * 1.2) + 1, `day 14 ${f.days[13].orders} vs level ${f.level}`);
});

test("attendance rate: present 1, half 0.5, absent and leave 0; too few marks means unknown", () => {
  assert.equal(attendanceRate([{ status: "present" }, { status: "present" }]), null);
  const marks = (["present", "present", "half", "absent", "present", "leave"] as const).map((status) => ({ status }));
  assert.equal(attendanceRate(marks), (1 + 1 + 0.5 + 0 + 1 + 0) / 6);
});

const ready = (orders: number) => forecastOrders(hist(14, () => orders), TODAY);

test("a team that covers the load is ok every day", () => {
  const p = planWarehouse({ today: TODAY, staff: 3, attendanceRate: null, forecast: ready(1100), booked: {}, settings: S });
  assert.equal(p.comfortable, 1200);
  assert.equal(p.limit, 1500);
  assert.ok(p.days.every((d) => d.status === "ok"));
  assert.equal(p.firstPressure, null);
  assert.equal(p.extraNeeded, 0);
});

test("past comfort is tight, past the limit is short; the extra people are counted at the comfortable rate", () => {
  const tight = planWarehouse({ today: TODAY, staff: 3, attendanceRate: null, forecast: ready(1400), booked: {}, settings: S });
  assert.ok(tight.days.every((d) => d.status === "tight"));
  assert.equal(tight.extraNeeded, 1, "200 over comfort needs 1 more at 400 each");
  const short = planWarehouse({ today: TODAY, staff: 3, attendanceRate: null, forecast: ready(1900), booked: {}, settings: S });
  assert.ok(short.days.every((d) => d.status === "short"));
  assert.equal(short.extraNeeded, 2, "700 over comfort: ceil(700 / 400) = 2");
});

test("people who do not always come in lower the capacity, and new people count the same way", () => {
  const p = planWarehouse({ today: TODAY, staff: 4, attendanceRate: 0.75, forecast: ready(1300), booked: {}, settings: S });
  assert.equal(p.effective, 3);
  assert.equal(p.comfortable, 1200);
  assert.equal(p.extraNeeded, Math.ceil(100 / (400 * 0.75)));
});

test("orders already booked are a floor under the forecast", () => {
  const day = shiftDay(TODAY, 3);
  const p = planWarehouse({ today: TODAY, staff: 2, attendanceRate: null, forecast: ready(500), booked: { [day]: 1400 }, settings: S });
  const d = p.days.find((x) => x.day === day)!;
  assert.equal(d.demand, 1400);
  assert.equal(d.status, "short");
  assert.equal(p.firstPressure, day);
  assert.equal(p.firstShort, day);
});

test("the date to start hiring is the first pressure day minus the lead time", () => {
  const rising = forecastOrders(hist(28, (i) => 700 + i * 30), TODAY);
  const p = planWarehouse({ today: TODAY, staff: 3, attendanceRate: null, forecast: rising, booked: {}, settings: S });
  assert.ok(p.firstPressure);
  assert.equal(p.hireBy, shiftDay(p.firstPressure!, -7));
  assert.ok(p.extraNeeded >= 1);
});

test("with no forecast yet, booked orders still show", () => {
  const f = forecastOrders({}, TODAY);
  const day = shiftDay(TODAY, 1);
  const p = planWarehouse({ today: TODAY, staff: 1, attendanceRate: null, forecast: f, booked: { [day]: 450 }, settings: S });
  assert.equal(p.days[0].status, "tight");
});

test("today shows the orders already due to go out today, but does not move the hiring date", () => {
  const p = planWarehouse({ today: TODAY, staff: 2, attendanceRate: null, forecast: ready(500), booked: { [TODAY]: 900 }, settings: S });
  assert.equal(p.now.day, TODAY);
  assert.equal(p.now.demand, 900);
  assert.equal(p.now.status, "tight");
  assert.equal(p.firstPressure, null, "hiring is planned from tomorrow on: today cannot be fixed by hiring");
});

test("all warehouses together add up the rows, against everyone's capacity", () => {
  const a = planWarehouse({ today: TODAY, staff: 2, attendanceRate: null, forecast: ready(700), booked: { [TODAY]: 300 }, settings: S });
  const b = planWarehouse({ today: TODAY, staff: 1, attendanceRate: null, forecast: ready(200), booked: { [shiftDay(TODAY, 2)]: 600 }, settings: S });
  const all = combinePlans([a, b], ready(900), S);
  assert.equal(all.staff, 3);
  assert.equal(all.comfortable, a.comfortable + b.comfortable);
  assert.deepEqual(all.days.map((d) => d.demand), a.days.map((d, i) => d.demand + b.days[i].demand));
  assert.equal(all.days[1].demand, 700 + 600, "the booked floor in one warehouse is part of the total");
  assert.equal(all.days[1].status, "tight", "1300 is over 3 people's comfortable 1200");
  assert.equal(all.now.demand, 300 + 0);
});

test("a very low attendance rate is held at a floor so one bad week does not wreck the plan", () => {
  const p = planWarehouse({ today: TODAY, staff: 10, attendanceRate: 0.05, forecast: ready(100), booked: {}, settings: S });
  assert.equal(p.effective, 3);
});

const fmt = (d: string) => d.slice(5);

test("the headline: covered, plan ahead, or start now", () => {
  const ok = planWarehouse({ today: TODAY, staff: 3, attendanceRate: null, forecast: ready(900), booked: {}, settings: S });
  assert.equal(capacityHeadline([{ name: "Delhi", plan: ok }], TODAY, S, fmt).tone, "ok");

  const rising = forecastOrders(hist(28, (i) => 500 + i * 30), TODAY);
  const soon = planWarehouse({ today: TODAY, staff: 3, attendanceRate: null, forecast: rising, booked: {}, settings: S });
  const h = capacityHeadline([{ name: "Delhi", plan: soon }], TODAY, S, fmt);
  assert.match(h.headline, /^(Plan \d+ more (person|people) by|Start hiring now)/);

  const now = planWarehouse({ today: TODAY, staff: 1, attendanceRate: null, forecast: ready(1000), booked: {}, settings: S });
  const urgent = capacityHeadline([{ name: "Lucknow", plan: now }, { name: "Delhi", plan: ok }], TODAY, S, fmt);
  assert.equal(urgent.tone, "bad");
  assert.match(urgent.headline, /Start hiring now: 2 more people needed, Lucknow/);

  const none = planWarehouse({ today: TODAY, staff: 0, attendanceRate: null, forecast: ready(900), booked: {}, settings: S });
  assert.equal(capacityHeadline([{ name: "Delhi", plan: none }], TODAY, S, fmt).headline, "No team is set up yet");
});
