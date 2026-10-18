import assert from "node:assert/strict";
import { test } from "node:test";
import { strToU8, zipSync } from "fflate";
import { readWorkbookWhole } from "./money/xlsx-stream.ts";
import { parseTeamSheet } from "./team-sheet.ts";

// A tiny workbook written the way some programs do it: the sheets first, the text table (sharedStrings) last.
function workbook(order: "text-first" | "text-last"): Uint8Array {
  const strings = ["Date", "Asha", "Northville", "Total Salary"];
  const sst = `<sst>${strings.map((s) => `<si><t>${s}</t></si>`).join("")}</sst>`;
  const sheet = `<worksheet><sheetData>
    <row r="1"><c r="B1" t="s"><v>2</v></c></row>
    <row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2" t="s"><v>1</v></c></row>
    <row r="3"><c r="A3"><v>46235</v></c><c r="B3" t="inlineStr"><is><t>P</t></is></c></row>
    <row r="4"><c r="A4" t="s"><v>3</v></c><c r="B4"><v>20000</v></c></row>
  </sheetData></worksheet>`;
  const parts: Record<string, Uint8Array> =
    order === "text-first"
      ? { "xl/sharedStrings.xml": strToU8(sst), "xl/worksheets/sheet1.xml": strToU8(sheet) }
      : { "xl/worksheets/sheet1.xml": strToU8(sheet), "xl/sharedStrings.xml": strToU8(sst) };
  return zipSync({
    "xl/workbook.xml": strToU8(`<workbook><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`),
    ...parts,
  });
}

for (const order of ["text-first", "text-last"] as const) {
  test(`the whole-file reader gets the text whatever the order of the zip (${order})`, () => {
    const rows = readWorkbookWhole(workbook(order));
    assert.equal(rows.length, 4);
    assert.deepEqual(rows[1].cells, { A: "Date", B: "Asha" });
    assert.deepEqual(rows[3].cells, { A: "Total Salary", B: "20000" });
  });
}

test("the staff sheet parser works on rows read from such a file", () => {
  const rows = readWorkbookWhole(workbook("text-last")).map((r) => {
    const out: string[] = [];
    for (const [col, text] of Object.entries(r.cells)) out[col.charCodeAt(0) - 65] = text;
    return Array.from(out, (c) => c ?? "");
  });
  const parsed = parseTeamSheet(rows);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.people.map((p) => [p.name, p.warehouse, p.salary]), [["Asha", "Northville", 20000]]);
  assert.deepEqual(parsed.marks.map((m) => [m.day, m.status]), [["2026-08-01", "present"]]);
});
