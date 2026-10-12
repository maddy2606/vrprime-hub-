// Dates are always shown in IST and numbers in the Indian format (1,00,000).

const IST = "Asia/Kolkata";

const numberFormat = new Intl.NumberFormat("en-IN");
const inrFormat = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const isoDayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: IST });
const dayFormat = new Intl.DateTimeFormat("en-IN", { timeZone: IST, day: "numeric", month: "short" });
const dayYearFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST,
  day: "numeric",
  month: "short",
  year: "numeric",
});
const timeFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

export function formatNumber(n: number): string {
  return numberFormat.format(n);
}

export function formatINR(n: number): string {
  return inrFormat.format(n);
}

/** Today's date in IST as YYYY-MM-DD. */
export function todayIST(now: Date = new Date()): string {
  return isoDayFormat.format(now);
}

function dayDiff(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

/** A calendar date (YYYY-MM-DD), e.g. "12 Oct" or "12 Oct 2025" when not this year. */
export function formatDate(isoDay: string, today: string = todayIST()): string {
  const date = new Date(`${isoDay}T00:00:00+05:30`);
  return isoDay.slice(0, 4) === today.slice(0, 4) ? dayFormat.format(date) : dayYearFormat.format(date);
}

/** A timestamp, e.g. "Today 4:05 pm", "Yesterday 9:30 am", "3 Oct, 11:15 am". */
export function formatDateTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const today = todayIST(now);
  const day = isoDayFormat.format(date);
  const time = timeFormat.format(date);
  const diff = dayDiff(day, today);
  if (diff === 0) return `Today ${time}`;
  if (diff === 1) return `Yesterday ${time}`;
  return `${formatDate(day, today)}, ${time}`;
}

export type DueState = "overdue" | "today" | "soon" | "later" | "none";

export function dueState(dueDate: string | null, today: string = todayIST()): DueState {
  if (!dueDate) return "none";
  const diff = dayDiff(today, dueDate);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff <= 2) return "soon";
  return "later";
}

export function dueLabel(dueDate: string | null, today: string = todayIST()): string {
  if (!dueDate) return "No due date";
  const diff = dayDiff(today, dueDate);
  if (diff < -1) return `Overdue ${-diff} days`;
  if (diff === -1) return "Overdue 1 day";
  if (diff === 0) return "Due today";
  if (diff === 1) return "Due tomorrow";
  return `Due ${formatDate(dueDate, today)}`;
}

export function postNumber(n: number): string {
  return `VR-${n}`;
}

export function ticketNumber(n: number): string {
  return `VR-T-${n}`;
}

/** A calendar date (YYYY-MM-DD) moved by a number of days (negative goes back). */
export function addDays(isoDay: string, days: number): string {
  const d = new Date(`${isoDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
