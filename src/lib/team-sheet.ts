// Reads the owner's staff spreadsheet (as rows of cells, from readSheets). Plain functions, relative imports, so
// `node --test` can load it.
//
// The layout it expects (what the "Salary Department" sheet looks like):
//   row A   a warehouse name over its first column ("Lucknow", then a few people, then a gap, then "Delhi", ...)
//   row B   "Date" in the first cell, then one person's name per column ("Aman ( Paid )" marks a salary already paid)
//   rows    one date per row (an Excel date number or a text date), with that person's mark for the day
//   last    a row that starts "Total Salary" with each person's monthly salary
// Marks are optional: a sheet with no marks still gives the people and their salaries.

import type { AttendanceStatus } from "./capacity.ts";

export type SheetPerson = { name: string; warehouse: string; salary: number | null; paid: boolean; col: number };
export type SheetMark = { col: number; day: string; status: AttendanceStatus };
export type ParsedTeamSheet = { people: SheetPerson[]; marks: SheetMark[]; unknownMarks: number; errors: string[] };

const norm = (s: string | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();

/** An Excel date number (days since 1899-12-30) as YYYY-MM-DD, or null when it is not one a person would write. */
export function excelDay(serial: number): string | null {
  if (!Number.isInteger(serial) || serial < 36526 || serial > 80000) return null; // years 2000 to 2118
  return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10);
}

function valid(y: number, mo: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
}

/** A date cell: an Excel number, 2026-08-01, or 1/8/2026 (day first, as written in India). */
export function parseDayCell(text: string): string | null {
  const t = norm(text);
  if (/^\d{5}$/.test(t)) return excelDay(Number(t));
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  return m ? valid(Number(m[3]), Number(m[2]), Number(m[1])) : null;
}

const STATUS: Record<string, AttendanceStatus> = {
  p: "present", present: "present", "1": "present", y: "present", yes: "present", "✓": "present", "✔": "present",
  h: "half", half: "half", hd: "half", "half day": "half", "0.5": "half", ".5": "half",
  a: "absent", absent: "absent", "0": "absent", n: "absent", no: "absent", x: "absent",
  l: "leave", leave: "leave", pl: "leave", cl: "leave", sl: "leave", off: "leave",
};

/** One attendance cell: a status, "" for nothing written, or null for something that is not understood. */
export function parseMark(text: string): AttendanceStatus | "" | null {
  const t = norm(text).toLowerCase();
  if (t === "") return "";
  return STATUS[t] ?? null;
}

function salary(text: string): number | null {
  const digits = norm(text).replace(/[^\d.]/g, "");
  if (digits === "") return null;
  const n = Math.round(Number(digits));
  return Number.isFinite(n) && n >= 0 && n < 10_000_000 ? n : null;
}

export function parseTeamSheet(rows: string[][]): ParsedTeamSheet {
  const out: ParsedTeamSheet = { people: [], marks: [], unknownMarks: 0, errors: [] };
  const headerAt = rows.findIndex((r) => norm(r[0]).toLowerCase() === "date");
  if (headerAt < 0) {
    out.errors.push('The first cell of the names row must say "Date".');
    return out;
  }
  const header = rows[headerAt];
  const above = headerAt > 0 ? rows[headerAt - 1] : [];

  // A warehouse name applies to its column and every column after it until a gap (an empty name cell) or the next name.
  let warehouse = "";
  for (let c = 1; c < header.length; c++) {
    const label = norm(above[c]);
    const raw = norm(header[c]);
    if (label) warehouse = label;
    if (!raw) {
      warehouse = "";
      continue;
    }
    const paid = /\(\s*paid\s*\)/i.test(raw);
    const name = norm(raw.replace(/\(\s*paid\s*\)/gi, ""));
    if (!name) continue;
    if (!warehouse) {
      out.errors.push(`"${name}" has no warehouse name above it.`);
      continue;
    }
    out.people.push({ name, warehouse, salary: null, paid, col: c });
  }
  if (out.people.length === 0 && out.errors.length === 0) out.errors.push("No people were found in the names row.");

  const byCol = new Map(out.people.map((p) => [p.col, p]));
  for (const row of rows.slice(headerAt + 1)) {
    const first = norm(row[0]);
    if (/^total\s+salary/i.test(first)) {
      for (const [col, p] of byCol) p.salary = salary(row[col] ?? "");
      continue;
    }
    const day = parseDayCell(first);
    if (!day) continue;
    for (const [col] of byCol) {
      const mark = parseMark(row[col] ?? "");
      if (mark === "") continue;
      if (mark === null) out.unknownMarks += 1;
      else out.marks.push({ col, day, status: mark });
    }
  }
  return out;
}

/** The sheet's warehouse names that are called something else in the app. Edit when a warehouse is renamed. */
const WAREHOUSE_ALIASES: Record<string, string> = { mumbai: "bhiwandi" };

/** The app's warehouse a sheet name means, or null. Case and spacing do not matter; "Mumbai" means Bhiwandi. */
export function matchWarehouse(name: string, warehouses: { id: string; name: string }[]): { id: string; name: string } | null {
  const key = norm(name).toLowerCase();
  const want = WAREHOUSE_ALIASES[key] ?? key;
  return warehouses.find((w) => norm(w.name).toLowerCase() === want) ?? null;
}
