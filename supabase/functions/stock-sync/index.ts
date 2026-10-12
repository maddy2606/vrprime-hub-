// Edge Function `stock-sync`: reads Flipkart stock (read-only) and saves a daily snapshot.
//
// Called only by the database (pg_net), never by a browser:
//   { "job": "start",    "run_id": "<uuid>" }   begin a sync (08:00 IST daily, or "Sync now")
//   { "job": "continue", "run_id": "<uuid>" }   carry on a sync that handed over or was cut off
//
// Every request must carry `x-internal-secret`, which this function checks with the database
// (the same arrangement as the `notify` function), so verify_jwt is off. The call answers at
// once and the work carries on in the background.
//
// Secrets (Supabase > Edge Functions > Secrets): FLIPKART_APP_ID and FLIPKART_APP_SECRET.
// They are used only to ask Flipkart for a token; nothing here ever changes anything at Flipkart.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { createFlipkartClient } from "./flipkart.ts";
import { processRun, type RunRow, type RunStore } from "./runner.ts";

// Hand over to a fresh invocation after this long, well inside the platform's wall-clock limit.
// STOCK_SYNC_BUDGET_MS exists only so the hand-over can be rehearsed with a short budget.
const TIME_BUDGET_MS = Math.max(2_000, Number(Deno.env.get("STOCK_SYNC_BUDGET_MS")) || 100_000);
const LEASE_MS = 120_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Keep keys and tokens out of logs, responses and saved errors.
// ---------------------------------------------------------------------------

const SECRET_ENV_NAMES = ["FLIPKART_APP_SECRET", "FLIPKART_APP_ID", "VAPID_PRIVATE_KEY"];

function scrub(input: unknown): string {
  let text = String(input ?? "");
  for (const name of SECRET_ENV_NAMES) {
    const value = Deno.env.get(name)?.trim();
    if (value && value.length >= 6) text = text.split(value).join("[redacted]");
  }
  return text
    .replace(/(["'`])[^"'`\n]*(?:sb_secret_|sb_publishable_|eyJ[\w-]{5,}|Bearer\s|Basic\s)[^"'`\n]*\1/gi, "[redacted]")
    .replace(/(?:Bearer|Basic)\s+[^\s"'`,;)]+/gi, "[redacted]")
    .replace(/sb_(?:secret|publishable)_[^\s"'`,;)]*/gi, "[redacted]")
    .replace(/eyJ[\w-]{5,}(?:\.[\w-]+){0,2}/g, "[redacted]");
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// ---------------------------------------------------------------------------
// The store: progress lives in the database
// ---------------------------------------------------------------------------

function secretKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    if (typeof keys.default === "string" && keys.default) return keys.default;
  } catch {
    // Fall back to the legacy key below.
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

function adminClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL") ?? "", secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function check(step: string, error: { message: string } | null): void {
  if (error) throw new Error(`${step}: ${error.message}`);
}

function makeStore(db: SupabaseClient): RunStore {
  const leaseUntil = (from = Date.now()) => new Date(from + LEASE_MS).toISOString();
  return {
    async loadRun(id): Promise<RunRow | null> {
      const { data, error } = await db
        .from("stock_runs")
        .select("id, status, stage, skus, total, cursor")
        .eq("id", id)
        .maybeSingle();
      check("Reading the sync", error);
      return data as RunRow | null;
    },
    async acquireLease(id) {
      const now = new Date().toISOString();
      // One atomic UPDATE: only succeeds if nobody holds a live lease.
      const { data, error } = await db
        .from("stock_runs")
        .update({ lease_until: leaseUntil(), updated_at: now })
        .eq("id", id)
        .in("status", ["queued", "running"])
        .or(`lease_until.is.null,lease_until.lt.${now}`)
        .select("id");
      check("Taking the sync", error);
      return (data?.length ?? 0) === 1;
    },
    async renewLease(id) {
      const { error } = await db
        .from("stock_runs")
        .update({ lease_until: leaseUntil(), updated_at: new Date().toISOString() })
        .eq("id", id);
      check("Renewing the sync", error);
    },
    async releaseLease(id) {
      const { error } = await db
        .from("stock_runs")
        .update({ lease_until: null, updated_at: new Date().toISOString() })
        .eq("id", id);
      check("Releasing the sync", error);
    },
    async begin(id, skus) {
      const { error } = await db.rpc("stock_run_begin", { p_run: id, p_skus: skus });
      check("Saving the SKU list", error);
    },
    async applyBatch(id, items, advance, skipped, missing) {
      const { error } = await db.rpc("stock_apply_batch", {
        p_run: id,
        p_items: items,
        p_advance: advance,
        p_skipped: skipped,
        p_missing: missing,
      });
      check("Saving a batch", error);
    },
    async finish(id) {
      const { data, error } = await db.rpc("stock_run_finish", { p_run: id });
      check("Finishing the sync", error);
      return { ok: data?.ok === true, error: typeof data?.error === "string" ? data.error : undefined };
    },
    async fail(id, message) {
      const { error } = await db.rpc("stock_run_fail", { p_run: id, p_error: message });
      check("Recording the failure", error);
    },
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  try {
    const db = adminClient();
    const secret = req.headers.get("x-internal-secret") ?? "";
    const { data: allowed, error: authError } = await db.rpc("check_internal_secret", { candidate: secret });
    if (authError) {
      console.error("Secret check failed:", scrub(authError.message));
      return json({ ok: false, error: "could not verify the request" }, 500);
    }
    if (allowed !== true) return json({ ok: false, error: "unauthorized" }, 401);

    const body = (await req.json().catch(() => null)) as { job?: unknown; run_id?: unknown } | null;
    const runId = typeof body?.run_id === "string" && UUID.test(body.run_id) ? body.run_id : null;
    if (!runId || (body?.job !== "start" && body?.job !== "continue")) {
      return json({ ok: false, error: "expected { job: start | continue, run_id }" }, 400);
    }

    const appId = Deno.env.get("FLIPKART_APP_ID")?.trim();
    const appSecret = Deno.env.get("FLIPKART_APP_SECRET")?.trim();
    const log = (message: string) => console.log(`[stock-sync ${runId.slice(0, 8)}] ${scrub(message)}`);

    const work = processRun(runId, {
      store: makeStore(db),
      // FLIPKART_BASE_URL is for rehearsing against a stand-in. Leave it unset: it then talks to Flipkart.
      flipkart:
        appId && appSecret
          ? createFlipkartClient({ appId, appSecret, log, baseUrl: Deno.env.get("FLIPKART_BASE_URL")?.trim() || undefined })
          : null,
      now: Date.now,
      budgetMs: TIME_BUDGET_MS,
      log,
      scrub,
      chain: async (id) => {
        try {
          await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/stock-sync`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-internal-secret": secret },
            body: JSON.stringify({ job: "continue", run_id: id }),
            signal: AbortSignal.timeout(15_000),
          });
        } catch (error) {
          // The watchdog restarts a run that nobody picks up, so this is not fatal.
          log(`Could not ask for the next part (${scrub(error instanceof Error ? error.message : error)})`);
        }
      },
    }).then((outcome) => log(`outcome: ${outcome}`));

    // Answer now; the sync carries on in the background.
    const edge = (globalThis as { EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void } }).EdgeRuntime;
    if (edge?.waitUntil) edge.waitUntil(work);
    else await work;
    return json({ ok: true, accepted: true }, 202);
  } catch (error) {
    console.error("stock-sync failed:", scrub(error instanceof Error ? error.message : error));
    return json({ ok: false, error: "failed to start" }, 500);
  }
});
