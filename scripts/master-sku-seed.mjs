// Prints the seed SQL for the master SKU mapping from a CSV (master_name, channel_sku):
//   node scripts/master-sku-seed.mjs supabase/seed-data/master_sku_mapping.csv
// SKUs and names are kept exactly as written, spaces included. Later changes go through the
// owner's "Upload master SKU list" on the Settings page, not through new seed files.
import { readFileSync } from "node:fs";
import { parseMasterCsv } from "../src/lib/master-csv.ts";

const file = process.argv[2];
if (!file) throw new Error("usage: node scripts/master-sku-seed.mjs <csv>");
const { rows, errors } = parseMasterCsv(readFileSync(file, "utf8"));
if (errors.length) throw new Error(errors.join("\n"));

const q = (s) => `'${s.replace(/'/g, "''")}'`;
const names = [...new Set(rows.map((r) => r.master))];
console.log(`insert into public.master_products (name) values\n  ${names.map((n) => `(${q(n)})`).join(",\n  ")}\non conflict (name) do nothing;\n`);
console.log(
  `insert into public.sku_master (channel_sku, master_id)\nselect v.sku, m.id from (values\n  ${rows.map((r) => `(${q(r.sku)}, ${q(r.master)})`).join(",\n  ")}\n) as v(sku, master)\njoin public.master_products m on m.name = v.master\non conflict (channel_sku) do update set master_id = excluded.master_id, updated_at = now();`,
);
