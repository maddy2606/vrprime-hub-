// Imports Flipkart settlement reports from disk into the database, the same way the Money page's Upload button does.
//
//   node scripts/money-import.mts "<file.xlsx>" ["<file2.xlsx>" ...]
//
// Uses the service-role key from .env.local (never printed). The files stay on this machine.
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { importReport } from "../src/lib/money/import.ts";
import { databaseSink } from "../src/lib/money/sink.ts";

function readEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(path.join(import.meta.dirname, "..", ".env.local"), "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  return env;
}

const env = readEnv();
if (process.env.SUPABASE_SECRET_KEY) env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local");
  process.exit(1);
}
const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

for (const file of process.argv.slice(2)) {
  const started = Date.now();
  console.log(`\n== ${path.basename(file)}`);
  const result = await importReport(
    fs.createReadStream(file) as unknown as AsyncIterable<Uint8Array>,
    path.basename(file),
    databaseSink(client as never),
    { csv: file.toLowerCase().endsWith(".csv"), onProgress: (p) => process.stdout.write(`\r${p.sheet}: ${p.rows} rows`) },
  );
  const { data: up } = await client.from("money_uploads").select("*").eq("id", result.uploadId).single();
  console.log(`\n${JSON.stringify({ kind: result.kind, upload: up && { rows_seen: up.rows_seen, rows_added: up.rows_added, rows_dup: up.rows_dup, rows_updated: up.rows_updated, other_added: up.other_added, period_from: up.period_from, period_to: up.period_to, total_net: up.total_net }, flipkart: (result.summary as { flipkart?: unknown }).flipkart, sheets: (result.summary as { sheets?: unknown }).sheets, skus_filled: result.finish.skus_filled }, null, 1)}`);
  console.log(`took ${Math.round((Date.now() - started) / 1000)} s`);
}
