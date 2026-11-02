// The Review tracker's counter, run on the owner's PC by Windows Task Scheduler (see install-review-counter.ps1).
// Flipkart blocks the website's server but answers a home connection, so the written reviews are read here and
// saved straight into Supabase as today's check, the same way the site saves them (saveCounts in
// src/server/review-sync.ts): a link not read keeps the count today's check already has, and nothing is saved when no
// link could be read. Shopsy turns automated requests away (it answers 529); when a site refuses, its links are left
// "not read" for this run and keep their last count, rather than being asked again and again.
//
//   node scripts/review-counter.mts            read every link and save
//   node scripts/review-counter.mts --dry-run  read and print, save nothing
//   node scripts/review-counter.mts --dry-run --links links.json   the same, with the links from a file (no settings)
//
// Settings, from a .env file next to this script (the installed copy) or else the repo's .env.local, one of:
//   SUPABASE_CLI_DIR             a folder where the Supabase CLI is signed in and linked to the project: saves through
//                                `supabase db query --linked`, so no key is kept for the counter at all
//   NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY   saves through Supabase's REST API with the secret key

import { execFile } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const here = dirname(fileURLToPath(import.meta.url));
// The installed copy has review-count.ts beside it; in the repo it is in src/lib.
const lib = existsSync(join(here, "review-count.ts")) ? join(here, "review-count.ts") : join(here, "..", "src", "lib", "review-count.ts");
const { isUnratedProductPage, readReviewCount, reviewsPageUrl } = (await import(pathToFileURL(lib).href)) as typeof import("../src/lib/review-count.ts");

const dryRun = process.argv.includes("--dry-run");
const NOTE = "Counted on the PC (every 5 days)";
const LOG = join(here, "review-counter.log");

/** Where the links come from and today's check goes: the signed-in Supabase CLI, or the REST API with the secret key. */
type Store = { links: () => Promise<Link[]>; save: (day: string, all: number[], counts: Map<number, number | null>) => Promise<void> };

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
    // A log that can't be written never stops the count.
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
    // One statement: today's check made, or its note marked "(updated)"; a new check gets every link (null where not
    // read), an existing one only the links read now. Every value is a number or a fixed text, so nothing is quoted in.
    save: async (day, all, counts) => {
      const values = all.map((r) => `(${Math.trunc(r)}, ${counts.get(r) == null ? "null" : Math.trunc(counts.get(r)!)}::integer)`).join(", ");
      await query(`with chk as (
  insert into public.review_checks (checked_on, note) values ('${day}', '${NOTE}')
  on conflict (checked_on) do update set note = '${NOTE} (updated)'
  returning id, (xmax <> 0) as existed
)
insert into public.review_counts (check_id, row_no, reviews)
select chk.id, v.row_no, v.reviews from chk, (values ${values}) as v(row_no, reviews)
where v.reviews is not null or not chk.existed
on conflict (check_id, row_no) do update set reviews = excluded.reviews;`);
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
    save: async (day, all, counts) => {
      const existing = await rest<{ id: string }[]>(`review_checks?select=id&checked_on=eq.${day}`);
      const checkId = existing[0]?.id ?? (await rest<{ id: string }[]>("review_checks?select=id", { method: "POST", prefer: "return=representation", body: JSON.stringify({ checked_on: day, note: NOTE }) }))[0].id;
      const rows = (existing.length ? all.filter((r) => counts.get(r) != null) : all).map((r) => ({ check_id: checkId, row_no: r, reviews: counts.get(r) ?? null }));
      await rest("review_counts?on_conflict=check_id,row_no", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: JSON.stringify(rows) });
      if (existing.length) await rest(`review_checks?id=eq.${checkId}`, { method: "PATCH", prefer: "return=minimal", body: JSON.stringify({ note: `${NOTE} (updated)` }) });
    },
  };
}

// ---- Reading the pages (as the site's Sync does) ------------------------------------------------------------------------

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-IN,en;q=0.9",
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sites that turned the counter away twice this run: their remaining links are not asked again. */
const refused = new Set<string>();
/** Sites that asked the counter to slow down once: it waited as asked before going on. */
const slowed = new Set<string>();

/**
 * One page. When a site refuses (429, or 529 and other 5xx), the counter waits as long as the site asks (Retry-After,
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

/** The product page prints the counts; the reviews page is the fallback when it doesn't. */
async function countFor(link: Link): Promise<number | null> {
  const product = await page(link.url);
  const n = product?.status === 200 ? readReviewCount(product.html) : null;
  if (n != null) return n;
  const reviews = await page(reviewsPageUrl(link.url));
  if (reviews?.status === 200 && readReviewCount(reviews.html) != null) return readReviewCount(reviews.html);
  return product?.status === 200 && isUnratedProductPage(product.html, link.sku) ? 0 : null;
}

// ---- The run ----------------------------------------------------------------------------------------------------------

async function main() {
  // A dry run can take the links from a JSON file instead ([{row_no, sku, url}]), so reading can be tried without the key.
  const from = process.argv.indexOf("--links");
  const s = dryRun && from > 0 ? null : store();
  const links = s ? await s.links() : (JSON.parse(readFileSync(process.argv[from + 1], "utf8")) as Link[]);
  if (!links.length) throw new Error("There are no links to check.");

  // One page at a time, 3 seconds apart: it runs in the background, so it can be gentle with both sites.
  const started = Date.now();
  const counts = new Map<number, number | null>();
  const queue = [...links];
  await Promise.all(
    Array.from({ length: 1 }, async () => {
      for (let link = queue.shift(); link; link = queue.shift()) {
        counts.set(link.row_no, await countFor(link));
        await wait(3_000);
      }
    }),
  );
  const read = links.filter((l) => counts.get(l.row_no) != null).map((l) => l.row_no);
  const missed = links.filter((l) => counts.get(l.row_no) == null).map((l) => l.row_no);
  const byHost = (host: string) => links.filter((l) => l.url.includes(host));
  const tally = (ls: Link[]) => `${ls.filter((l) => counts.get(l.row_no) != null).length}/${ls.length}`;
  const summary = `read ${read.length} of ${links.length} in ${Math.round((Date.now() - started) / 1000)}s (Flipkart ${tally(byHost("flipkart.com"))}, Shopsy ${tally(byHost("shopsy.in"))})${missed.length ? `; not read: rows ${missed.join(", ")}` : ""}`;
  if (dryRun) {
    for (const l of links) console.log(`${String(l.row_no).padStart(3)}  ${String(counts.get(l.row_no) ?? "—").padStart(5)}  ${l.url.split("/")[2]}`);
    return log(`Dry run, nothing saved: ${summary}`);
  }
  if (!s) throw new Error("No settings to save with.");
  if (!read.length) throw new Error(`No link could be read, so nothing was saved: ${summary}`);

  // Today's check (India date): made if missing; if it is there, only the links read now change.
  const day = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  await s.save(day, links.map((l) => l.row_no), counts);
  log(`Saved ${day}: ${summary}`);
}

main().catch((e: unknown) => {
  log(`Failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
