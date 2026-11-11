// Advances and expenses per person (Team page), as plain functions so `node --test` can load them.

export type StaffMoneyKind = "advance" | "expense" | "recovered";
export type StaffMoneyEntry = { id: string; staffId: string; kind: StaffMoneyKind; day: string; amount: number; note: string | null };

export const STAFF_MONEY_KINDS: { kind: StaffMoneyKind; label: string; hint: string }[] = [
  { kind: "advance", label: "Advance", hint: "Given ahead of salary; they owe it back" },
  { kind: "expense", label: "Expense", hint: "Paid to or for them for work; not owed back" },
  { kind: "recovered", label: "Recovered", hint: "Advance taken back, e.g. cut from salary" },
];

/** What a person owes and was given: advance still due overall, and this month's advances, expenses and recoveries. */
export function staffMoneySummary(entries: StaffMoneyEntry[], month: string) {
  let advanced = 0;
  let recovered = 0;
  const thisMonth = { advance: 0, expense: 0, recovered: 0 };
  for (const e of entries) {
    if (e.kind === "advance") advanced += e.amount;
    if (e.kind === "recovered") recovered += e.amount;
    if (e.day.slice(0, 7) === month) thisMonth[e.kind] += e.amount;
  }
  return { due: Math.round((advanced - recovered) * 100) / 100, thisMonth };
}

/** Entries newest first, grouped by month ("2026-11"), each month with its totals per kind. */
export function staffMoneyByMonth(entries: StaffMoneyEntry[]) {
  const sorted = [...entries].sort((a, b) => b.day.localeCompare(a.day) || b.id.localeCompare(a.id));
  const months: { month: string; entries: StaffMoneyEntry[]; totals: Record<StaffMoneyKind, number> }[] = [];
  for (const e of sorted) {
    const m = e.day.slice(0, 7);
    let g = months[months.length - 1];
    if (!g || g.month !== m) {
      g = { month: m, entries: [], totals: { advance: 0, expense: 0, recovered: 0 } };
      months.push(g);
    }
    g.entries.push(e);
    g.totals[e.kind] += e.amount;
  }
  return months;
}
