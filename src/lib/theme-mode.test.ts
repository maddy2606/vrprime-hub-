import assert from "node:assert/strict";
import { test } from "node:test";
import { readThemeMode } from "./theme-mode.ts";
import { warehouseColor, WAREHOUSE_SERIES } from "./theme.ts";

test("the theme cookie: light and dark are kept, everything else is Auto", () => {
  assert.equal(readThemeMode("light"), "light");
  assert.equal(readThemeMode("dark"), "dark");
  for (const v of [undefined, null, "", "auto", "Dark", "blue", "light "]) assert.equal(readThemeMode(v), "auto", String(v));
});

test("a warehouse keeps its colour wherever it sits in the list", () => {
  assert.equal(warehouseColor("Bhiwandi", 0), WAREHOUSE_SERIES[1]);
  assert.equal(warehouseColor("  LUCKNOW ", 0), WAREHOUSE_SERIES[4]);
  assert.equal(warehouseColor("Delhi", 1), warehouseColor("Delhi", 3), "a person who sees fewer warehouses still sees each in its usual colour");
  assert.equal(warehouseColor("Pune", 2), WAREHOUSE_SERIES[2], "an unknown warehouse falls back to its place in the list");
  assert.equal(warehouseColor("Pune", 7), WAREHOUSE_SERIES[2], "past five it wraps rather than failing");
});

test("the chart colours are CSS variables, so they follow the mode", () => {
  for (const c of WAREHOUSE_SERIES) assert.match(c, /^var\(--wh-[1-5]\)$/);
});
