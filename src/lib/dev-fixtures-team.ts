// Obviously fake team data for the local-only /dev/preview screen (?view=team). Never used in production.
import { capacityHeadline, combinePlans, DEFAULT_CAPACITY_SETTINGS, forecastOrders, planWarehouse, shiftDay, type AttendanceStatus } from "@/lib/capacity";
import { FAKE_WAREHOUSES } from "@/lib/dev-fixtures";
import { formatDate, todayIST } from "@/lib/format";
import { warehouseColor } from "@/lib/theme";
import type { PersonView, TeamData, WarehouseView } from "@/server/team-data";

const MARKS: (AttendanceStatus | null)[] = ["present", "present", "half", "present", "absent", "present", "leave", null];

/** Three made-up warehouses: a busy one that is getting short, a covered one, and one with nobody added yet. */
export function fakeTeam(): TeamData {
  const today = todayIST();
  const settings = DEFAULT_CAPACITY_SETTINGS;
  const shape = [
    { w: FAKE_WAREHOUSES[0], people: 5, base: 1900, growth: 18 },
    { w: FAKE_WAREHOUSES[2], people: 3, base: 900, growth: 2 },
    { w: FAKE_WAREHOUSES[3], people: 0, base: 120, growth: 0 },
  ];
  const histories = shape.map((s) => {
    const h: Record<string, number> = {};
    for (let i = 30; i >= 1; i--) {
      const day = shiftDay(today, -i);
      const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
      h[day] = Math.round((s.base + (30 - i) * s.growth) * (weekday === 0 ? 0.7 : weekday === 1 ? 1.15 : 1));
    }
    return h;
  });

  const people: PersonView[] = shape.flatMap((s, wi) =>
    Array.from({ length: s.people }, (_, k) => ({
      id: `fake-person-${wi}-${k}`,
      name: `Fake Packer ${String.fromCharCode(65 + wi)}${k + 1}`,
      warehouseId: s.w.id,
      active: !(wi === 0 && k === 4),
      status: MARKS[(wi * 3 + k) % MARKS.length],
      month: { present: 14 - k, half: k % 2, absent: k % 3, leave: k === 1 ? 2 : 0 },
      salary: 14000 + k * 1500,
    })),
  );

  const views: WarehouseView[] = shape.map((s, i) => {
    const active = people.filter((p) => p.warehouseId === s.w.id && p.active);
    const history = histories[i];
    // Orders already due today and tomorrow, so the Today column has something to show.
    const booked = { [today]: Math.round(s.base * 1.2), [shiftDay(today, 1)]: Math.round(s.base * 0.4) };
    const plan = planWarehouse({ today, staff: active.length, attendanceRate: 0.9, forecast: forecastOrders(history, today), booked, settings });
    const last7 = Array.from({ length: 7 }, (_, k) => history[shiftDay(today, -(k + 1))] ?? 0);
    return {
      id: s.w.id,
      name: s.w.name,
      color: warehouseColor(s.w.name, i),
      plan,
      staff: active.length,
      inToday: active.filter((p) => p.status === "present" || p.status === "half").length,
      marked: active.filter((p) => p.status !== null).length,
      yesterday: history[shiftDay(today, -1)] ?? 0,
      average: Math.round(last7.reduce((a, b) => a + b, 0) / 7),
    };
  });

  const all: Record<string, number> = {};
  for (const h of histories) for (const [d, n] of Object.entries(h)) all[d] = (all[d] ?? 0) + n;
  const staff = views.reduce((n, v) => n + v.staff, 0);
  const total = combinePlans(
    views.map((v) => v.plan),
    forecastOrders(all, today),
    settings,
  );

  return {
    today,
    day: today,
    settings,
    isOwner: true,
    headline: capacityHeadline(views.map((v) => ({ name: v.name, plan: v.plan })), today, settings, (d) => formatDate(d, today)),
    total: { plan: total, staff },
    warehouses: views,
    people,
    past: Array.from({ length: 14 }, (_, k) => {
      const d = shiftDay(today, -(14 - k));
      return { day: d, orders: all[d] ?? 0 };
    }),
    noOrders: false,
    monthLabel: new Date(`${today.slice(0, 8)}01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }),
  };
}
