// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMasterGroups } from "./forecast.ts";
import { inventoryByProduct, parseInventoryReport, reportMonth } from "./inventory-report.ts";
import { masterLookup } from "./master-csv.ts";

const WH = [
  { id: "w-bhi", name: "Bhiwandi" },
  { id: "w-del", name: "Delhi" },
];
const HEAD = ["SKU", "Product", "Unit", "Total Stock", "Loose", "Returns", "Total Pieces", "Bhiwandi W1", "Bhiwandi Current", "Bhiwandi Loose", "Bhiwandi Returns", "Delhi Current", "Delhi Loose", "Delhi Returns"];

test("pieces per warehouse = cartons x pieces per carton + loose + returns, adding up to Total Pieces", () => {
  const { lines, errors } = parseInventoryReport(
    [
      HEAD,
      ["REMOVER-LINT", "Lint Remover", "Carton", "263", "0", "27", "26327", "235", "224", "0", "27", "39", "0", "0"],
      ["FAN-NECK", "Neck Fan", "Carton", "262", "10", "71", "10561", "84", "85", "10", "71", "177", "0", "0"],
      ["PERFUME-CAR", "Car Perfume", "pc", "0", "0", "2", "2", "0", "0", "0", "2", "0", "0", "0"],
      ["", "", "", "", "", "", "", "", "", "", "", "", "", ""],
    ],
    WH,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(
    lines.map((l) => `${l.code}@${l.wid}=${l.pieces}`),
    ["REMOVER-LINT@w-bhi=22427", "REMOVER-LINT@w-del=3900", "FAN-NECK@w-bhi=3481", "FAN-NECK@w-del=7080", "PERFUME-CAR@w-bhi=2", "PERFUME-CAR@w-del=0"],
  );
});

test("the report is checked: right sheet, known warehouses, totals that add up", () => {
  assert.match(parseInventoryReport([["Metric", "Value"]], WH).errors[0], /Products sheet/);
  assert.match(parseInventoryReport([[...HEAD, "Pune Current"]], WH).errors[0], /pune/);
  const off = parseInventoryReport([HEAD, ["X", "X", "Carton", "10", "0", "0", "1000", "0", "5", "0", "0", "4", "0", "0"]], WH);
  assert.match(off.errors[0], /add up to 900 pieces, not the 1000/);
  assert.equal(off.lines.length, 0, "a product that does not add up is not taken at all");
  assert.equal(reportMonth([["VR Prime — Inventory Report"], ["Month", "2026-10"]]), "2026-10");
});

test("report products join master products by code, else by name in any case", () => {
  const { byProduct, unmatched } = inventoryByProduct(
    [
      { code: "LIZARD-NEW", name: "New Lizard", wid: "w-bhi", pieces: 10 },
      { code: "BERRY-CARPERF", name: "Berry Car Perfume", wid: "w-del", pieces: 7 },
      { code: "GONE", name: "Not a master", wid: "w-del", pieces: 3 },
      { code: "EMPTY", name: "Nothing left", wid: "w-del", pieces: 0 },
    ],
    [
      { name: "Lizard (new)", code: "lizard-new" },
      { name: "berry car perfume", code: null },
    ],
  );
  assert.equal(byProduct.get("Lizard (new)")?.get("w-bhi"), 10);
  assert.equal(byProduct.get("berry car perfume")?.get("w-del"), 7);
  assert.deepEqual(unmatched, ["Not a master"], "products with no stock are not worth flagging");
});

test("Forecasting with the inventory report: product stock from the report, SKUs show sales only", () => {
  const l = masterLookup([{ master: "Lint Remover", sku: "LINT1" }, { master: "Lint Remover", sku: "LINT2", units: 2 }, { master: "Berry", sku: "B1" }, { master: "Musk", sku: "M1" }]);
  const raw = [
    { sku: "LINT1", wid: "w-bhi", title: null, disp: 70, stock: 999 },
    { sku: "LINT2", wid: "w-del", title: null, disp: 35, stock: 999 },
    { sku: "OTHER", wid: "w-del", title: null, disp: 7, stock: 999 },
  ];
  const inv = new Map([
    ["Lint Remover", new Map([["w-bhi", 1400], ["w-del", 700]])],
    ["Berry", new Map([["w-del", 500]])],
    ["Musk", new Map([["w-del", 300]])],
  ]);
  const kits = [{ name: "Car Perfume", parts: [{ name: "Berry", qty: 1 }, { name: "Musk", qty: 1 }] }];
  const { groups, unmapped } = buildMasterGroups(raw, 7, l, null, new Set(), kits, inv);
  const lint = groups.find((g) => g.name === "Lint Remover")!;
  assert.deepEqual([lint.total.stock, lint.total.rate, lint.total.cover], [2100, 20, 105], "2100 pieces at (70 + 35x2)/7 = 20 a day");
  assert.ok(lint.children.every((c) => c.noStock && c.stock === 0 && c.cover === null), "no Flipkart stock on the SKUs");
  assert.deepEqual([unmapped[0].noStock, unmapped[0].cover], [true, null]);
  assert.equal(groups.find((g) => g.name === "Berry")?.total.stock, 500, "in stock, never sold on Flipkart: still listed");
  assert.equal(groups.find((g) => g.name === "Car Perfume")?.total.stock, 300, "the combo: Musk runs out first");
  const delhi = buildMasterGroups(raw, 7, l, "w-del", new Set(), [], inv).groups.find((g) => g.name === "Lint Remover")!;
  assert.deepEqual([delhi.total.stock, delhi.total.rate], [700, 10], "one warehouse: its stock and its sales");
});
