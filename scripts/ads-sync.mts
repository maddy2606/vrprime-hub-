// Saves Seller Hub's PLA ads reports into the hub (Ads tracker and Ads Desk) from this PC. Run after downloading the
// reports from Seller Hub → Ads → Reports → Other Reports → PLA:
//
//   node scripts/ads-sync.mts                     the newest of each report in Downloads, from the last 12 hours
//   node scripts/ads-sync.mts --hours 48          look further back
//   node scripts/ads-sync.mts a.csv b.csv         these files
//   node scripts/ads-sync.mts --dry               read and report only, save nothing
//
// It reads every CSV, tells which report it is from its columns (Consolidated Daily, Consolidated FSN, Search Term,
// Keyword), and saves through the Supabase CLI where it is already signed in and linked (the vrprime-db-setup folder
// next to the repo, or SUPABASE_CLI_DIR), so no key is kept. A Search Term report is tens of megabytes: only its lines
// with a click, spend or sale are saved, added up per campaign and term.

import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { adsFileKind, readAdsCampaignReport, readAdsDailyReport, readAdsTermReport } from "../src/lib/ads-report.ts";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dry = args.includes("--dry");
const hoursAt = args.indexOf("--hours");
const hours = hoursAt >= 0 ? Number(args[hoursAt + 1]) || 12 : 12;
const named = args.filter((a, i) => !a.startsWith("--") && !(hoursAt >= 0 && i === hoursAt + 1));
const cliDir = process.env.SUPABASE_CLI_DIR || resolve(here, "..", "..", "vrprime-db-setup");

const run = promisify(execFile);
/** npx as Node ships it, next to node.exe. */
const NPX = join(dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
const tmp = mkdtempSync(join(tmpdir(), "vrprime-ads-"));

/** Runs one SQL statement on the live database through the signed-in CLI. The SQL goes in a file, so nothing is mangled. */
async function sql(text: string): Promise<void> {
  const file = join(tmp, `q-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(file, text);
  try {
    const { stdout, stderr } = await run(process.execPath, [NPX, "--yes", "supabase", "db", "query", "--linked", "--yes", "-o", "json", "-f", file], { cwd: cliDir, windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: 300_000 });
    if (/"_tag"\s*:\s*"Error"/.test(stdout)) throw new Error(stdout.slice(stdout.indexOf("{"), stdout.indexOf("{") + 600) || stderr.slice(0, 600));
  } finally {
    rmSync(file, { force: true });
  }
}

/** A JSON value as a Postgres jsonb literal, in dollar quotes with a tag that cannot be in the text. */
function jsonb(value: unknown): string {
  const text = JSON.stringify(value);
  let tag = "j";
  while (text.includes(`$${tag}$`)) tag += "x";
  return `$${tag}$${text}$${tag}$::jsonb`;
}

/** The files to read: the ones named, or the newest CSVs in Downloads from the last `hours` hours. */
function candidates(): string[] {
  if (named.length) return named.map((f) => resolve(f));
  const dir = join(homedir(), "Downloads");
  const since = Date.now() - hours * 3_600_000;
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".csv"))
    .map((f) => join(dir, f))
    .filter((f) => statSync(f).mtimeMs >= since)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    .slice(0, 40);
}

const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
let failed = false;
const seen = new Set<string>();
const done: string[] = [];

try {
  if (!dry && !existsSync(join(cliDir, "supabase"))) throw new Error(`The Supabase CLI folder was not found at ${cliDir}. Set SUPABASE_CLI_DIR.`);
  for (const file of candidates()) {
    const text = readFileSync(file, "utf8");
    const kind = adsFileKind(text);
    if (!kind) continue;
    try {
      if (kind === "daily") {
        const r = readAdsDailyReport(text);
        if (!r.ok) throw new Error(r.error);
        const { from, to, rows, spend } = r.report;
        const key = `daily ${from} ${to}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!dry) await sql(`select public.ads_save_daily('${from}', '${to}', ${jsonb(rows)});`);
        done.push(`Daily ${from} to ${to}: ${rupees(spend)}, ${rows.length} lines`);
      } else if (kind === "fsn") {
        const r = readAdsCampaignReport(text);
        if (!r.ok) throw new Error(r.error);
        const { from, to, rows, spend } = r.report;
        const key = `fsn ${from} ${to}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!dry) await sql(`select public.ads_tracker_save_scan('${from}', '${to}', 'Synced from this PC', ${jsonb(rows)}, null);`);
        done.push(`SKU (FSN) ${from} to ${to}: ${rupees(spend)}, ${rows.length} SKU and campaign pairs`);
      } else {
        const r = readAdsTermReport(text);
        if (!r.ok) throw new Error(r.error);
        const { from, to, rows, spend, lines } = r.report;
        const key = `${kind} ${from} ${to}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!dry) for (let i = 0; i < Math.max(1, rows.length); i += 4000) await sql(`select public.ads_save_terms('${kind}', '${from}', '${to}', ${jsonb(rows.slice(i, i + 4000))}, ${i > 0}, ${lines});`);
        done.push(`${kind === "st" ? "Search Term" : "Keyword"} ${from} to ${to}: ${rupees(spend)}, ${rows.length} terms kept of ${lines} lines`);
      }
    } catch (e) {
      failed = true;
      console.error(`FAILED ${file}: ${(e as Error).message}`);
    }
  }
  if (!done.length && !failed) console.log(named.length ? "None of those files is a Seller Hub ads report." : `No ads report CSVs found in Downloads from the last ${hours} hours.`);
  for (const line of done) console.log(`${dry ? "Read" : "Saved"}: ${line}`);
} catch (e) {
  failed = true;
  console.error((e as Error).message);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
