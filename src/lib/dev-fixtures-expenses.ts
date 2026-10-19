// Made-up expenses for the local-only /dev/preview screen (?view=expenses). Never used in production.
import type { ExpenseRow, MonthTotal, WhatsAppState } from "@/components/expenses/expenses-board";

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
  manual: false,
  readDone: true,
  isPdf: false,
  thumbUrl: null,
  imageUrl: null,
  ...extra,
});

export const FAKE_EXPENSES: ExpenseRow[] = [
  row(1, 19, 11, 1250, "Packing material", "Brown tape 10 rolls", { paidTo: "Fake Packaging Co", reference: "429316843210" }),
  row(2, 19, 10, 800, "Transport and courier", "Tempo bhada to Bhiwandi", { status: "new", amountFrom: "note", readAmount: null, textAmount: 800 }),
  row(3, 18, 17, 240, "Food and tea", "Chai and biscuits for the team"),
  row(4, 18, 12, null, "Other", "Fake shop QR", { status: "new", amountFrom: null, verdict: "not_payment" }),
  row(5, 17, 9, 2300, "Rent and utilities", "Light bill October", { paidTo: "Fake Electricity Board" }),
  row(6, 16, 15, 560, "Fuel", "Petrol for delivery bike", { verdict: "pending", status: "new" }),
  row(7, 15, 13, 4500, "Staff and labour", "Loading labour, 3 people", { manual: true, amountFrom: "typed" }),
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
