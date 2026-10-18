// Edge Function `inventory-sync`: reads live stock from the VR Prime Inventory API (the in-house barcode scanner
// software), read only, and saves it as the stock in use. Forecasting's days of cover then use it.
//
// Called only by the database (pg_net), never by a browser: every 15 minutes (cron) and on "Sync now".
//   { "job": "sync" }
//
// Every request must carry `x-internal-secret`, which this function checks with the database (the same arrangement as
// `stock-sync` and `notify`), so verify_jwt is off. The call answers at once and the work carries on in the background.
//
// Secrets (Supabase > Edge Functions > Secrets): VRPRIME_API_USERNAME and VRPRIME_API_PASSWORD, a VR Prime login (a
// separate user made for this is best: Settings > Team in VR Prime). VRPRIME_API_BASE_URL exists only for rehearsals.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { createVrPrimeClient, toStockRows } from "./vrprime.ts";

const SECRET_ENV_NAMES = ["VRPRIME_API_PASSWORD", "VRPRIME_API_USERNAME"];

function scrub(input: unknown): string {
  let text = String(input ?? "");
  for (const name of SECRET_ENV_NAMES) {
    const value = Deno.env.get(name)?.trim();
    if (value && value.length >= 4) text = text.split(value).join("[redacted]");
  }
  return text
    .replace(/(?:Bearer|Basic)\s+[^\s"'`,;)]+/gi, "[redacted]")
    .replace(/sb_(?:secret|publishable)_[^\s"'`,;)]*/gi, "[redacted]")
    .replace(/eyJ[\w-]{5,}(?:\.[\w-]+){0,2}/g, "[redacted]");
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

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
  return createClient(Deno.env.get("SUPABASE_URL") ?? "", secretKey(), { auth: { persistSession: false, autoRefreshToken: false } });
}

/** The current month in India, as VR Prime wants it (YYYY-MM). */
const istMonth = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 7);

async function sync(db: SupabaseClient): Promise<string> {
  const username = Deno.env.get("VRPRIME_API_USERNAME")?.trim();
  const password = Deno.env.get("VRPRIME_API_PASSWORD")?.trim();
  if (!username || !password) throw new Error("The VR Prime login is not set up yet (add VRPRIME_API_USERNAME and VRPRIME_API_PASSWORD in Supabase > Edge Functions > Secrets)");

  const api = createVrPrimeClient({ username, password, baseUrl: Deno.env.get("VRPRIME_API_BASE_URL")?.trim() || undefined });
  await api.login();
  const [apiWarehouses, products] = await Promise.all([api.warehouses(), api.products(istMonth())]);

  const { data: appWarehouses, error: whError } = await db.from("warehouses").select("id, name");
  if (whError) throw new Error(`Reading the warehouses: ${whError.message}`);

  const { rows, errors } = toStockRows(products, apiWarehouses, appWarehouses ?? []);
  if (errors.length) throw new Error(errors.slice(0, 3).join("; "));

  const { data, error } = await db.rpc("inventory_sync_save", { p_rows: rows });
  if (error) throw new Error(`Saving the stock: ${error.message}`);
  return `saved ${data?.products ?? "?"} products, ${data?.pieces ?? "?"} pieces`;
}

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

    const work = sync(db)
      .then((summary) => console.log(`[inventory-sync] ${summary}`))
      .catch(async (error) => {
        const message = scrub(error instanceof Error ? error.message : error);
        console.error(`[inventory-sync] failed: ${message}`);
        // The stock keeps its last good numbers; the page says the latest sync failed.
        await db.rpc("inventory_sync_fail", { p_error: message });
      });

    // Answer now; the sync carries on in the background.
    const edge = (globalThis as { EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void } }).EdgeRuntime;
    if (edge?.waitUntil) edge.waitUntil(work);
    else await work;
    return json({ ok: true, accepted: true }, 202);
  } catch (error) {
    console.error("inventory-sync failed:", scrub(error instanceof Error ? error.message : error));
    return json({ ok: false, error: "failed to start" }, 500);
  }
});
