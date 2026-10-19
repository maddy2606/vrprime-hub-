// Made-up expenses for the local-only /dev/preview screen (?view=expenses). Never used in production.
import type { BudgetPlan } from "@/components/expenses/budget";
import type { ExpenseRow, MonthTotal, WhatsAppState } from "@/components/expenses/expenses-board";
import { warehouseColor } from "@/lib/theme";

// Made-up warehouses (ids are fake).
const WH = { blr: "00000000-0000-4000-8000-000000000b01", bhw: "00000000-0000-4000-8000-000000000b02", del: "00000000-0000-4000-8000-000000000b03", kol: "00000000-0000-4000-8000-000000000b04", lko: "00000000-0000-4000-8000-000000000b05" };

const at = (day: number, hour: number) => new Date(Date.UTC(2026, 9, day, hour - 5, 30)).toISOString();
const row = (id: number, day: number, hour: number, amount: number | null, category: string, reason: string, extra: Partial<ExpenseRow> = {}): ExpenseRow => ({
  id: `00000000-0000-4000-8000-${String(9000 + id).padStart(12, "0")}`,
  spentAt: at(day, hour),
  sender: "Fake Jigar",
  reason,
  category,
  amount,
  amountFrom: amount === null ? null : "screenshot",
  textAmount: null,
  readAmount: amount,
  paidTo: null,
  reference: null,
  status: "checked",
  verdict: "payment",
  warehouseId: null,
  manual: false,
  readDone: true,
  isPdf: false,
  thumbUrl: null,
  imageUrl: null,
  ...extra,
});

export const FAKE_EXPENSES: ExpenseRow[] = [
  row(1, 19, 11, 1250, "Packing material", "Bhiwandi brown tape 10 rolls", { paidTo: "Fake Packaging Co", reference: "429316843210", warehouseId: WH.bhw }),
  row(2, 19, 10, 800, "Transport and courier", "Tempo bhada to Bhiwandi", { warehouseId: WH.bhw, status: "new", amountFrom: "note", readAmount: null, textAmount: 800 }),
  row(3, 18, 17, 240, "Food and tea", "Chai and biscuits for the team"),
  row(4, 18, 12, null, "Other", "Fake shop QR", { status: "new", amountFrom: null, verdict: "not_payment" }),
  row(5, 17, 9, 2300, "Rent and utilities", "Delhi light bill October", { paidTo: "Fake Electricity Board", warehouseId: WH.del }),
  row(6, 16, 15, 560, "Fuel", "Lucknow petrol for delivery bike", { verdict: "pending", status: "new", warehouseId: WH.lko }),
  row(7, 15, 13, 4500, "Staff and labour", "Kolkata loading labour, 3 people", { manual: true, amountFrom: "typed", warehouseId: WH.kol }),
];

export const FAKE_EXPENSE_MONTHS: MonthTotal[] = [
  { month: "2026-10", label: "Oct 2026", total: 9090, count: 6 },
  { month: "2026-09", label: "Sept 2026", total: 7420, count: 18 },
];

export const FAKE_WHATSAPP: WhatsAppState = {
  linkedAs: "Fake Owner",
  groupId: "120363000000000000@g.us",
  groupName: "Warehouse Expenses VRPRIME",
  groups: [],
  lastFetchAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  lastResult: "4 new messages, 2 new expenses, 2 screenshots saved.",
  lastError: null,
};

const names: [keyof typeof WH, string][] = [["blr", "Bangalore"], ["bhw", "Bhiwandi"], ["del", "Delhi"], ["kol", "Kolkata"], ["lko", "Lucknow"]];
const salaries = { [WH.blr]: 36_000, [WH.bhw]: 145_000, [WH.del]: 72_000, [WH.kol]: 48_000, [WH.lko]: 30_000 };

/** October planned: Delhi near its running budget, Kolkata over on labour. */
export const FAKE_BUDGET_PLAN: BudgetPlan = {
  month: "2026-10",
  label: "Oct 2026",
  lines: [
    { warehouseId: WH.blr, labour: 36_000, running: 3_000 },
    { warehouseId: WH.bhw, labour: 145_000, running: 4_000 },
    { warehouseId: WH.del, labour: 72_000, running: 2_500 },
    { warehouseId: WH.kol, labour: 48_000, running: 1_500 },
    { warehouseId: WH.lko, labour: 30_000, running: 1_000 },
    { warehouseId: null, labour: 0, running: 500 },
  ],
  lastLines: [],
  warehouses: names.map(([k, name], i) => ({ id: WH[k], name, color: warehouseColor(name, i) })),
  salaries,
  people: { [WH.blr]: 2, [WH.bhw]: 8, [WH.del]: 4, [WH.kol]: 3, [WH.lko]: 2 },
  orders: { [WH.blr]: 900, [WH.bhw]: 5_200, [WH.del]: 2_600, [WH.kol]: 1_500, [WH.lko]: 800 },
  lastRunning: { [WH.bhw]: 3_900, [WH.del]: 2_100, [WH.kol]: 1_200, [WH.lko]: 700, general: 600 },
  lastLabel: "Sept 2026",
};
