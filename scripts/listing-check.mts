// The Listing check (graphite-spec 12.3), run on the owner's PC by Windows Task Scheduler (see install-listing-check.ps1).
// Flipkart blocks the website's server but answers a home connection, so each active Review tracker link's product page
// is read here: can it be bought, and at what price. The result is saved through public.listing_check_save as today's
// check. Flipkart is only read, never written. When a site refuses, its links are left "not_read" for this run, rather
// than being asked again and again; a "not_read" never replaces a row already saved today.
//
//   node scripts/listing-check.mts            read every link and save
//   node scripts/listing-check.mts --dry-run  read and print, save nothing
//   node scripts/listing-check.mts --dry-run --links links.json   the same, with the links from a file (no settings)
//
// Settings, from a .env file next to this script (the installed copy) or else the repo's .env.local, one of:
//   SUPABASE_CLI_DIR             a folder where the Supabase CLI is signed in and linked to the project: saves through
//                                `supabase db query --linked`, so no key is kept for the check at all
//   NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY   saves through Supabase's REST API with the secret key

import { execFile } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const here = dirname(fileURLToPath(import.meta.url));
// The installed copy has listing-check.ts beside it; in the repo it is in src/lib.
const lib = existsSync(join(here, "listing-check.ts")) ? join(here, "listing-check.ts") : join(here, "..", "src", "lib", "listing-check.ts");
const { readListing } = (await import(pathToFileURL(lib).href)) as typeof import("../src/lib/listing-check.ts");

type Status = "buyable" | "out_of_stock" | "unavailable" | "not_read";
type Reading = { status: Status; price: number | null };

const dryRun = process.argv.includes("--dry-run");
const LOG = join(here, "listing-check.log");

/** Where the links come from and today's check goes: the signed-in Supabase CLI, or the REST API with the secret key. */
type Store = { links: () => Promise<Link[]>; save: (day: string, rows: { row_no: number; status: Status; price: number | null }[]) => Promise<unknown> };

function store(): Store {
  const file = [join(here, ".env"), join(here, "..", ".env.local")].find((f) => existsSync(f));
  const env: Record<string, string> = {};
  for (const line of file ? readFileSync(file, "utf8").split(/\r?\n/) : []) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  const cli = process.env.SUPABASE_CLI_DIR ?? env.SUPABASE_CLI_DIR;
  if (cli) return cliStore(cli);
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SECRET_KEY ?? "";
  if (!url || !key) throw new Error("Set SUPABASE_CLI_DIR, or NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (.env next to the script, or the repo's .env.local).");
  return restStore({ url, key });
}

/** One line in the log next to the script, which keeps its last 200 lines. */
function log(text: string) {
  const line = `${new Date().toISOString()} ${text}`;
  console.log(line);
  try {
    appendFileSync(LOG, `${line}\n`);
    const lines = readFileSync(LOG, "utf8").trimEnd().split("\n");
    if (lines.length > 200) writeFileSync(LOG, `${lines.slice(-200).join("\n")}\n`);
  } catch {
    // A log that can't be written never stops the check.
  }
}

// ---- Supabase through the signed-in CLI (no key kept) ------------------------------------------------------------------

const run = promisify(execFile);
/** npx as Node ships it, next to node.exe. */
const NPX = join(dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");

function cliStore(dir: string): Store {
  // The SQL goes in a file; npx runs through this same Node, with no shell in between to mangle the arguments.
  const query = async <T,>(sql: string): Promise<T[]> => {
    const file = join(here, `query-${process.pid}.sql`);
    writeFileSync(file, sql);
    try {
      const { stdout } = await run(process.execPath, [NPX, "--yes", "supabase", "db", "query", "--linked", "-o", "json", "-f", file], { cwd: dir, windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 120_000 });
      const at = stdout.indexOf("{");
      if (at < 0) throw new Error(`The Supabase CLI gave no answer: ${stdout.slice(0, 200)}`);
      return (JSON.parse(stdout.slice(at)) as { rows?: T[] }).rows ?? [];
    } finally {
      rmSync(file, { force: true });
    }
  };
  return {
    links: () => query<Link>("select row_no, sku, url from public.review_links where active order by row_no;"),
    // Every value is a whole number, a fixed status word or a number, so nothing typed by a person is quoted in. The CLI
    // signs in as the database owner, so the session first says it is the service role, which listing_check_save allows.
    save: (day, rows) => {
      const json = JSON.stringify(rows.map((r) => ({ row_no: Math.trunc(r.row_no), status: r.status, price: r.price === null ? null : Number(r.price) })));
      return query(`select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select public.listing_check_save('${day}'::date, '${json.replace(/'/g, "''")}'::jsonb);`);
    },
  };
}

// ---- Supabase through its REST API, with the secret key ----------------------------------------------------------------

function restStore(s: { url: string; key: string }): Store {
  const rest = async <T,>(path: string, init: RequestInit & { prefer?: string } = {}): Promise<T> => {
    const res = await fetch(`${s.url}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: s.key, authorization: `Bearer ${s.key}`, "content-type": "application/json", ...(init.prefer ? { prefer: init.prefer } : {}) },
      signal: AbortSignal.timeout(30_000),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`Supabase answered ${res.status} for ${path.split("?")[0]}: ${body.slice(0, 200)}`);
    return (body ? JSON.parse(body) : null) as T;
  };
  return {
    links: () => rest<Link[]>("review_links?select=row_no,sku,url&active=eq.true&order=row_no"),
    save: (day, rows) => rest("rpc/listing_check_save", { method: "POST", body: JSON.stringify({ p_day: day, p_rows: rows }) }),
  };
}

// ---- Reading the pages (as the review counter does) --------------------------------------------------------------------

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-IN,en;q=0.9",
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sites that turned the check away twice this run: their remaining links are not asked again. */
const refused = new Set<string>();
/** Sites that asked the check to slow down once: it waited as asked before going on. */
const slowed = new Set<string>();

/**
 * One page. When a site refuses (429, or 529 and other 5xx), the check waits as long as the site asks (Retry-After,
 * else a minute) and goes on; a second refusal stops that site for the rest of the run.
 */
async function page(url: string): Promise<{ status: number; html: string } | null> {
  const host = new URL(url).host;
  if (refused.has(host)) return null;
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: "follow", signal: AbortSignal.timeout(20_000) });
    const html = await res.text();
    if (res.status === 429 || res.status >= 500) {
      if (slowed.has(host)) refused.add(host);
      else {
        slowed.add(host);
        const after = Number(res.headers.get("retry-after"));
        await wait(Number.isFinite(after) && after > 0 && after <= 300 ? after * 1000 : 60_000);
      }
    }
    return { status: res.status, html };
  } catch {
    return null;
  }
}

type Link = { row_no: number; sku: string; url: string };

/** The listing's own product page (not its reviews page). A 404 is a page that loads with no product. */
async function readingFor(link: Link): Promise<Reading> {
  const p = await page(link.url);
  if (!p) return { status: "not_read", price: null };
  if (p.status === 404 || p.status === 410) return { status: "unavailable", price: null };
  if (p.status !== 200) return { status: "not_read", price: null };
  return readListing(p.html);
}

// ---- The run ----------------------------------------------------------------------------------------------------------

async function main() {
  // A dry run can take the links from a JSON file instead ([{row_no, sku, url}]), so reading can be tried without the key.
  const from = process.argv.indexOf("--links");
  const s = dryRun && from > 0 ? null : store();
  const links = s ? await s.links() : (JSON.parse(readFileSync(process.argv[from + 1], "utf8")) as Link[]);
  if (!links.length) throw new Error("There are no links to check.");

  // One page at a time, 2 seconds apart: it runs in the background, so it can be gentle with both sites.
  const started = Date.now();
  const readings = new Map<number, Reading>();
  for (const link of links) {
    readings.set(link.row_no, await readingFor(link));
    await wait(2_000);
  }
  const count = (st: Status) => links.filter((l) => readings.get(l.row_no)?.status === st).length;
  const byHost = (host: string) => links.filter((l) => l.url.includes(host));
  const tally = (ls: Link[]) => `${ls.filter((l) => readings.get(l.row_no)?.status !== "not_read").length}/${ls.length}`;
  const summary = `read ${links.length - count("not_read")} of ${links.length} in ${Math.round((Date.now() - started) / 1000)}s (Flipkart ${tally(byHost("flipkart.com"))}, Shopsy ${tally(byHost("shopsy.in"))}): ${count("buyable")} buyable, ${count("out_of_stock")} out of stock, ${count("unavailable")} unavailable, ${count("not_read")} not read`;
  if (dryRun) {
    for (const l of links) {
      const r = readings.get(l.row_no)!;
      console.log(`${String(l.row_no).padStart(3)}  ${r.status.padEnd(12)}  ${String(r.price ?? "—").padStart(7)}  ${l.url.split("/")[2]}`);
    }
    return log(`Dry run, nothing saved: ${summary}`);
  }
  if (!s) throw new Error("No settings to save with.");
  if (count("not_read") === links.length) throw new Error(`No link could be read, so nothing was saved: ${summary}`);

  // Today's check (India date): made if missing; a not_read never replaces a row already saved today.
  const day = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  await s.save(day, links.map((l) => ({ row_no: l.row_no, ...readings.get(l.row_no)! })));
  log(`Saved ${day}: ${summary}`);
}

main().catch((e: unknown) => {
  log(`Failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
