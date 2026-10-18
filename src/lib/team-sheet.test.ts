import assert from "node:assert/strict";
import { test } from "node:test";
import { excelDay, matchWarehouse, parseDayCell, parseMark, parseTeamSheet } from "./team-sheet.ts";

// Made-up people: the real sheet is the owner's and is never put in the repo.
const sheet = (marks: string[][] = []): string[][] => [
  ["", "Northville", "", "Southtown", "", "", "", "Eastport"],
  ["Date", "Asha Rao ( Paid )", "Bilal", "Chitra", "Dev ( Paid )", "", "", "Esha"],
  ["46235", ...(marks[0] ?? [])],
  ["46236", ...(marks[1] ?? [])],
  ["Total Salary ", "20000", "14,000", "₹18000", "", "", "", "12000"],
];

test("excel date numbers: 46235 is 1 Aug 2026; nonsense is rejected", () => {
  assert.equal(excelDay(46235), "2026-08-01");
  assert.equal(excelDay(46265), "2026-08-31");
  assert.equal(excelDay(5), null);
  assert.equal(excelDay(46235.5), null);
});

test("date cells: excel number, ISO, and day-first text", () => {
  assert.equal(parseDayCell("46235"), "2026-08-01");
  assert.equal(parseDayCell("2026-08-01"), "2026-08-01");
  assert.equal(parseDayCell("1/8/2026"), "2026-08-01");
  assert.equal(parseDayCell("31-12-2026"), "2026-12-31");
  assert.equal(parseDayCell("31/02/2026"), null);
  assert.equal(parseDayCell("Total Salary"), null);
});

test("marks: letters and words, blank means nothing written, unknown is reported as null", () => {
  assert.equal(parseMark("P"), "present");
  assert.equal(parseMark(" present "), "present");
  assert.equal(parseMark("H"), "half");
  assert.equal(parseMark("0.5"), "half");
  assert.equal(parseMark("A"), "absent");
  assert.equal(parseMark("L"), "leave");
  assert.equal(parseMark(""), "");
  assert.equal(parseMark("   "), "");
  assert.equal(parseMark("holiday??"), null);
});

test("people, warehouses, paid flags and salaries come from the headings and the Total Salary row", () => {
  const r = parseTeamSheet(sheet());
  assert.deepEqual(r.errors, []);
  assert.deepEqual(
    r.people.map((p) => [p.name, p.warehouse, p.salary, p.paid]),
    [
      ["Asha Rao", "Northville", 20000, true],
      ["Bilal", "Northville", 14000, false],
      ["Chitra", "Southtown", 18000, false],
      ["Dev", "Southtown", null, true],
      ["Esha", "Eastport", 12000, false],
    ],
  );
  assert.equal(r.marks.length, 0, "a sheet with no marks still gives the people");
});

test("a gap column ends a warehouse, so a person after it needs a name above", () => {
  const rows = sheet();
  rows[0][5] = ""; // no label above the gap, and the person after the gap
  rows[1][6] = "Farid";
  const r = parseTeamSheet(rows);
  assert.ok(r.errors.some((e) => e.includes("Farid") && e.includes("no warehouse")));
});

test("attendance marks are read per person per date", () => {
  const r = parseTeamSheet(sheet([["P", "A", "H", "L", "", "", "P"], ["P", "", "", "", "", "", "wat"]]));
  assert.equal(r.unknownMarks, 1);
  const by = (name: string) => {
    const col = r.people.find((p) => p.name === name)!.col;
    return r.marks.filter((m) => m.col === col).map((m) => `${m.day} ${m.status}`);
  };
  assert.deepEqual(by("Asha Rao"), ["2026-08-01 present", "2026-08-02 present"]);
  assert.deepEqual(by("Bilal"), ["2026-08-01 absent"]);
  assert.deepEqual(by("Chitra"), ["2026-08-01 half"]);
  assert.deepEqual(by("Dev"), ["2026-08-01 leave"]);
  assert.deepEqual(by("Esha"), ["2026-08-01 present"]);
});

test("a sheet without the Date heading is refused with a clear message", () => {
  const r = parseTeamSheet([["Name", "x"]]);
  assert.equal(r.people.length, 0);
  assert.match(r.errors[0], /Date/);
});

test("warehouse names: case does not matter, and Mumbai means Bhiwandi", () => {
  const wh = [{ id: "1", name: "Bhiwandi" }, { id: "2", name: "Delhi" }];
  assert.equal(matchWarehouse("  delhi ", wh)?.id, "2");
  assert.equal(matchWarehouse("Mumbai", wh)?.id, "1");
  assert.equal(matchWarehouse("Pune", wh), null);
});
