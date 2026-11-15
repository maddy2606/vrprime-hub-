// Fake Business page figures for the local preview only (/dev/preview?view=business, btargets, bdead). Not used in production.
import { readWeekFigures, type WeekFigures } from "@/lib/business";
import { classifyDeadStock, type DeadRow } from "@/lib/dead-stock";
import { FAKE_WAREHOUSES } from "@/lib/dev-fixtures";

const PRODUCTS = ["Lizard repellent", "Pest repellent spray", "Car rat repellent", "Rat repellent spray", "Bed bug spray", "Car perfume berry", "Car perfume musk", "Mosquito spray"];

export function fakeBusinessWeek(adsReadTo: string): { cur: WeekFigures; prev: WeekFigures } {
  const cur = [182, 96, 64, 51, 12, 22, 9, 30];
  const prev = [150, 104, 48, 70, 4, 21, 3, 31];
  const by = (u: number[]) => u.map((units, i) => ({ id: `p${i}`, name: PRODUCTS[i], units }));
  return {
    cur: readWeekFigures({ orders: 412, units: 466, sales: 168_420, cancelled: 18, returns_customer: 11, returns_courier: 7, dispatched_units: 451, late: 3, ad_spend: 14_280.5, ads_read_to: adsReadTo, by_product: by(cur) }),
    prev: readWeekFigures({ orders: 368, units: 431, sales: 151_900, cancelled: 22, returns_customer: 9, returns_courier: 7, dispatched_units: 440, late: 5, ad_spend: 12_960, ads_read_to: adsReadTo, by_product: by(prev) }),
  };
}

export function fakeDeadRows(): DeadRow[] {
  const w = FAKE_WAREHOUSES;
  return classifyDeadStock([
    { name: "Car perfume musk", code: "VRP-CPM", stock: 640, dispatched: 0, cover: null, byWarehouse: [{ wid: w[0].id, pieces: 400 }, { wid: w[1].id, pieces: 240 }], cost: 38 },
    { name: "Ant chalk", code: "VRP-ANT", stock: 210, dispatched: 0, cover: null, byWarehouse: [{ wid: w[2].id, pieces: 210 }], cost: null },
    { name: "Mosquito spray 500ml", code: "VRP-MS5", stock: 1200, dispatched: 300, cover: 120, byWarehouse: [{ wid: w[0].id, pieces: 700 }, { wid: w[3].id, pieces: 500 }], cost: 64 },
    { name: "Bed bug spray 1L", code: "VRP-BB1", stock: 95, dispatched: 0, cover: null, byWarehouse: [{ wid: w[1].id, pieces: 95 }], cost: 110 },
    { name: "Lizard repellent", code: "VRP-LIZ", stock: 300, dispatched: 900, cover: 10, byWarehouse: [{ wid: w[0].id, pieces: 300 }], cost: 52 },
  ]);
}
