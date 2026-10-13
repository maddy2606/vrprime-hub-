// The header-mapping layer. A report is read by what its columns are CALLED, never by where they sit, and a
// file whose required column is missing or renamed is refused with the column's name: wrong numbers are never
// imported silently. Pure functions, relative imports, so tests and the import script can use them.
import type { SheetCells } from "./xlsx-stream.ts";

/** "Bank Settlement Value (Rs.) \n= SUM(J:R)" becomes "bank settlement value". */
export function normalizeHeader(raw: string): string {
  const firstLine = raw.split(/\r?\n/)[0] ?? "";
  return firstLine
    .toLowerCase()
    .replace(/\((rs\.?|inr|%|in kgs?|kgs?)\)/g, " ")
    .replace(/=.*$/, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export class ReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportError";
  }
}

/** Column letter for each normalized header name; the first column with a name wins when a name repeats. */
export type HeaderMap = Map<string, string>;

export function headerMapOf(cells: SheetCells): HeaderMap {
  const map: HeaderMap = new Map();
  const letters = Object.keys(cells).sort((a, b) => (a.length === b.length ? (a < b ? -1 : 1) : a.length - b.length));
  for (const letter of letters) {
    const name = normalizeHeader(cells[letter]);
    if (name && !map.has(name)) map.set(name, letter);
  }
  return map;
}

export type FieldSpec = Record<string, string>;

export type ResolvedColumns<R extends FieldSpec, O extends FieldSpec> = {
  required: { [K in keyof R]: string };
  optional: { [K in keyof O]: string | null };
};

/** Looks every required column up by name; throws a ReportError that names the ones that are missing. */
export function resolveColumns<R extends FieldSpec, O extends FieldSpec>(
  map: HeaderMap,
  sheet: string,
  required: R,
  optional: O,
): ResolvedColumns<R, O> {
  const missing = Object.values(required).filter((name) => !map.has(name));
  if (missing.length) {
    throw new ReportError(
      `The "${sheet}" sheet has no column called ${missing.map((m) => `"${m}"`).join(", ")}. Flipkart may have renamed it. Nothing was imported.`,
    );
  }
  const req = {} as { [K in keyof R]: string };
  for (const k of Object.keys(required) as (keyof R)[]) req[k] = map.get(required[k]) as string;
  const opt = {} as { [K in keyof O]: string | null };
  for (const k of Object.keys(optional) as (keyof O)[]) opt[k] = map.get(optional[k]) ?? null;
  return { required: req, optional: opt };
}

// --- Values --------------------------------------------------------------------------------------------------

const NOT_A_VALUE = new Set(["", "generation in progress", "na", "n/a", "not available", "-", "--", "null", "none"]);

export function isBlank(v: string | undefined): boolean {
  return v === undefined || NOT_A_VALUE.has(v.trim().toLowerCase());
}

/** A number, or null for a blank / "NA" cell. Throws on text that is not a number. */
export function num(v: string | undefined, where: string): number | null {
  if (isBlank(v)) return null;
  const n = Number(String(v).replace(/,/g, "").trim());
  if (!Number.isFinite(n)) throw new ReportError(`${where}: "${String(v).slice(0, 30)}" is not a number.`);
  return n;
}

export function num0(v: string | undefined, where: string): number {
  return num(v, where) ?? 0;
}

/** Excel serial day number to YYYY-MM-DD. */
export function serialToIso(serial: number): string {
  return new Date(Math.round((serial - 25569) * 86_400_000)).toISOString().slice(0, 10);
}

/** YYYY-MM-DD (with or without a time), DD-MM-YYYY, DD/MM/YYYY, or an Excel serial; null for blank. */
export function dateOf(v: string | undefined, where: string): string | null {
  if (isBlank(v)) return null;
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  if (/^\d{5}(\.\d+)?$/.test(s)) return serialToIso(Number(s));
  throw new ReportError(`${where}: "${s.slice(0, 30)}" is not a date.`);
}

/** Text as it is (SKUs are never trimmed: " RATH2" is a real SKU); null for blank or "NA". */
export function textOf(v: string | undefined): string | null {
  return isBlank(v) ? null : (v as string);
}

/** Money is kept to 3 decimals, as the reports give it. */
export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Column letters as numbers and back, for "five columns to the right of this one". */
export function letterIndex(letter: string): number {
  let n = 0;
  for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
export function indexLetter(index: number): string {
  let n = index;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** Every column with its normalized name, in order (names may repeat). */
export function headerListOf(cells: SheetCells): { letter: string; name: string }[] {
  return Object.keys(cells)
    .sort((a, b) => letterIndex(a) - letterIndex(b))
    .map((letter) => ({ letter, name: normalizeHeader(cells[letter]) }))
    .filter((h) => h.name !== "");
}
