// Reads spreadsheets picked in the browser: every sheet of an .xlsx (or a .csv as one sheet) as rows of cells.

import { splitCsv } from "@/lib/master-csv";

/** Every sheet, by name, in file order. A .csv is one sheet called "CSV". Empty rows are left out. */
export async function readSheets(file: File): Promise<Map<string, string[][]>> {
  if (!/\.xlsx$/i.test(file.name)) return new Map([["CSV", splitCsv(await file.text())]]);
  const { readWorkbook } = await import("@/lib/money/xlsx-stream");
  async function* chunks(): AsyncGenerator<Uint8Array> {
    const reader = file.stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  }
  const index = (letters: string) => [...letters].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;
  const sheets = new Map<string, string[][]>();
  for await (const row of readWorkbook(chunks())) {
    const cells: string[] = [];
    for (const [col, text] of Object.entries(row.cells)) cells[index(col)] = text;
    const out = Array.from(cells, (c) => c ?? "");
    if (!out.some((c) => c.trim() !== "")) continue;
    const rows = sheets.get(row.sheet) ?? [];
    rows.push(out);
    sheets.set(row.sheet, rows);
  }
  return sheets;
}

/** The first sheet of an .xlsx (or a .csv) as rows of cells. */
export async function readTable(file: File): Promise<string[][]> {
  const sheets = await readSheets(file);
  return sheets.values().next().value ?? [];
}
