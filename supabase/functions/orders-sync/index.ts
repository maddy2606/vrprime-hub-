// Edge Function `orders-sync`: reads Flipkart orders and returns (read-only) and saves them.
//
// Called only by the database (pg_net), never by a browser:
//   { "job": "start",    "run_id": "<uuid>" }   begin a run (every 30 minutes by day, daily, nightly backfill, "Sync now")
//   { "job": "continue", "run_id": "<uuid>" }   carry on a run that handed over, paused or was cut off
//
// Every request must carry `x-internal-secret`, which this function checks with the database
// (the same arrangement as the `notify` and `stock-sync` functions), so verify_jwt is off. The call
// answers at once and the work carries on in the background.
//
// Secrets (Supabase > Edge Functions > Secrets): FLIPKART_APP_ID and FLIPKART_APP_SECRET, the same
// ones the stock sync uses. They are only used to ask Flipkart for a token; nothing here ever
// changes anything at Flipkart.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { createOrdersClient } from "./flipkart.ts";
import { isNightIST } from "./rules.ts";
import { processRun, type OrdersStore, type RunRow } from "./runner.ts";

// Hand over to a fresh invocation after this long. A Flipkart page can take up to 16 seconds, and
// a worker that is cut off is restarted by the watchdog from the last saved page, so this is cautious.
// ORDERS_SYNC_BUDGET_MS exists only so the hand-over can be rehearsed with a short budget.
const TIME_BUDGET_MS = Math.max(2_000, Number(Deno.env.get("ORDERS_SYNC_BUDGET_MS")) || 90_000);
const LEASE_MS = 180_000;
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

function makeStore(db: SupabaseClient): OrdersStore {
  const leaseUntil = (from = Date.now()) => new Date(from + LEASE_MS).toISOString();
  return {
    async loadRun(id): Promise<RunRow | null> {
      const { data, error } = await db.from("order_runs").select("id, kind, status, plan, step, next_path, notes").eq("id", id).maybeSingle();
      check("Reading the run", error);
      return data as RunRow | null;
    },
    async acquireLease(id) {
      const now = new Date().toISOString();
      // One atomic UPDATE: only succeeds if nobody holds a live lease. It also wakes a paused run.
      const { data, error } = await db
        .from("order_runs")
        .update({ lease_until: leaseUntil(), status: "running", updated_at: now })
        .eq("id", id)
        .in("status", ["queued", "running", "paused"])
        .or(`lease_until.is.null,lease_until.lt.${now}`)
        .select("id");
      check("Taking the run", error);
      return (data?.length ?? 0) === 1;
    },
    async renewLease(id) {
      const { error } = await db
        .from("order_runs")
        .update({ lease_until: leaseUntil(), updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("status", "running");
      check("Renewing the run", error);
    },
    async releaseLease(id) {
      const { error } = await db
        .from("order_runs")
        .update({ lease_until: null, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("status", "running");
      check("Releasing the run", error);
    },
    async applyPage(id, step, items, returns, next, seen) {
      const { error } = await db.rpc("orders_apply_page", {
        p_run: id,
        p_step: step,
        p_items: items,
        p_returns: returns,
        p_next: next,
        p_seen: seen,
      });
      check("Saving a page", error);
    },
    async finish(id) {
      const { data, error } = await db.rpc("orders_run_finish", { p_run: id });
      check("Finishing the run", error);
      return { ok: data?.ok === true, error: typeof data?.error === "string" ? data.error : undefined };
    },
    async fail(id, message) {
      const { error } = await db.rpc("orders_run_fail", { p_run: id, p_error: message });
      check("Recording the failure", error);
    },
    async pause(id, message) {
      const { error } = await db.rpc("orders_run_pause", { p_run: id, p_error: message });
      check("Pausing the run", error);
    },
    async otherSyncActive(id) {
      const { data, error } = await db.rpc("orders_other_sync_active", { p_run: id });
      check("Checking for other syncs", error);
      return data === true;
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
    const log = (message: string) => console.log(`[orders-sync ${runId.slice(0, 8)}] ${scrub(message)}`);

    const work = processRun(runId, {
      store: makeStore(db),
      flipkart: appId && appSecret ? createOrdersClient({ appId, appSecret, log, baseUrl: Deno.env.get("FLIPKART_BASE_URL")?.trim() || undefined }) : null,
      now: Date.now,
      budgetMs: TIME_BUDGET_MS,
      isNight: () => isNightIST(new Date()),
      log,
      scrub,
      chain: async (id) => {
        try {
          await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/orders-sync`, {
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

    // Answer now; the run carries on in the background.
    const edge = (globalThis as { EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void } }).EdgeRuntime;
    if (edge?.waitUntil) edge.waitUntil(work);
    else await work;
    return json({ ok: true, accepted: true }, 202);
  } catch (error) {
    console.error("orders-sync failed:", scrub(error instanceof Error ? error.message : error));
    return json({ ok: false, error: "failed to start" }, 500);
  }
});
