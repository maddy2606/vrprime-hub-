// The VR Prime Inventory API (the in-house barcode scanner software), read only. Three calls, as in the API guide:
//   POST /auth/login/                 { username, password } -> { access }
//   GET  /warehouses/                 -> [{ id, name }]
//   GET  /products/?month=YYYY-MM     -> [{ sku, name, piecesByWarehouse: { "<warehouse id>": pieces } }]
// Nothing here ever changes anything in VR Prime. Plain TypeScript (no Deno APIs) so `node --test` can run it with a fake
// server. The password and the token never appear in an error message.

export type VrPrimeWarehouse = { id: string; name: string };
export type VrPrimeProduct = { sku: string; name: string; piecesByWarehouse: Record<string, number> };
export type StockRow = { code: string; name: string; wid: string; pieces: number };

type Fetch = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export const DEFAULT_BASE_URL = "https://api.vrprime.in/api";

/** A failure with a message safe to show and save (it never holds the password or a token). */
export class VrPrimeError extends Error {}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export function createVrPrimeClient(options: {
  username: string;
  password: string;
  baseUrl?: string;
  fetch?: Fetch;
  /** Per call, in milliseconds. */
  timeoutMs?: number;
}) {
  const base = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const doFetch: Fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? 20_000;
  let token: string | null = null;

  const scrub = (input: unknown): string => {
    let text = String(input ?? "");
    for (const secret of [options.password, token ?? ""]) if (secret && secret.length >= 4) text = text.split(secret).join("[redacted]");
    return text
      .replace(/Bearer\s+[^\s"'`,;)]+/gi, "[redacted]")
      .replace(/("?(?:access|refresh|token|password)"?\s*[:=]\s*)"[^"]*"/gi, '$1"[redacted]"')
      .slice(0, 300);
  };

  async function call(path: string, init: { method: string; body?: string; auth?: boolean }): Promise<unknown> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (init.body) headers["Content-Type"] = "application/json";
    if (init.auth) headers.Authorization = `Bearer ${token}`;
    let reply;
    try {
      reply = await doFetch(`${base}${path}`, { method: init.method, headers, body: init.body, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      throw new VrPrimeError(`Could not reach VR Prime (${scrub(error instanceof Error ? error.message : error)})`);
    }
    const text = await reply.text();
    if (!reply.ok) {
      if (reply.status === 401 || reply.status === 403) {
        throw new VrPrimeError(init.auth ? "VR Prime refused the session (HTTP " + reply.status + ")" : "VR Prime rejected the username or password");
      }
      throw new VrPrimeError(`VR Prime answered HTTP ${reply.status}: ${scrub(text)}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new VrPrimeError("VR Prime did not send JSON");
    }
  }

  /** The result list of a reply that is either a plain list or a page ({ results, next }). */
  const listOf = (body: unknown): unknown[] =>
    Array.isArray(body) ? body : body && typeof body === "object" && Array.isArray((body as { results?: unknown }).results) ? (body as { results: unknown[] }).results : [];

  return {
    async login(): Promise<void> {
      const body = (await call("/auth/login/", { method: "POST", body: JSON.stringify({ username: options.username, password: options.password }) })) as { access?: unknown };
      if (typeof body?.access !== "string" || !body.access) throw new VrPrimeError("VR Prime did not return a token");
      token = body.access;
    },

    async warehouses(): Promise<VrPrimeWarehouse[]> {
      const out: VrPrimeWarehouse[] = [];
      for (const w of listOf(await call("/warehouses/", { method: "GET", auth: true }))) {
        const r = w as { id?: unknown; name?: unknown };
        if ((typeof r.id === "number" || typeof r.id === "string") && typeof r.name === "string" && r.name.trim()) out.push({ id: String(r.id), name: r.name.trim() });
      }
      if (out.length === 0) throw new VrPrimeError("VR Prime listed no warehouses");
      return out;
    },

    /** Every Master SKU, following pages if the API pages its answer. */
    async products(month: string): Promise<VrPrimeProduct[]> {
      const out: VrPrimeProduct[] = [];
      let path: string | null = `/products/?month=${encodeURIComponent(month)}`;
      for (let page = 0; path && page < 50; page++) {
        const body = await call(path, { method: "GET", auth: true });
        for (const item of listOf(body)) {
          const r = item as { sku?: unknown; name?: unknown; piecesByWarehouse?: unknown };
          if (typeof r.sku !== "string" || !r.sku.trim()) continue;
          const by: Record<string, number> = {};
          if (r.piecesByWarehouse && typeof r.piecesByWarehouse === "object") {
            for (const [id, v] of Object.entries(r.piecesByWarehouse as Record<string, unknown>)) {
              const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
              if (!Number.isFinite(n)) throw new VrPrimeError(`${r.sku.trim()} has a stock number that is not understood`);
              by[id] = n;
            }
          }
          out.push({ sku: r.sku.trim(), name: typeof r.name === "string" && r.name.trim() ? r.name.trim() : r.sku.trim(), piecesByWarehouse: by });
        }
        const next = body && typeof body === "object" ? (body as { next?: unknown }).next : null;
        // A "next" link is followed only on the same API: never to some other address.
        path = typeof next === "string" && next.startsWith(base) ? next.slice(base.length) : null;
      }
      if (out.length === 0) throw new VrPrimeError("VR Prime listed no products");
      return out;
    },
  };
}

/**
 * Turns the API's answer into stock rows for the database: one row per product and per app warehouse (a missing count is
 * 0, so a product that ran out shows as 0, not as unchanged). Warehouses are matched by name. Stock in a warehouse the
 * app does not have is an error, so pieces are never silently lost; negative stock counts as 0.
 */
export function toStockRows(
  products: VrPrimeProduct[],
  apiWarehouses: VrPrimeWarehouse[],
  appWarehouses: { id: string; name: string }[],
): { rows: StockRow[]; errors: string[] } {
  const errors: string[] = [];
  const byName = new Map(appWarehouses.map((w) => [norm(w.name), w.id]));
  const map = new Map<string, string>(); // API warehouse id -> app warehouse id
  const unknown = new Set<string>();
  for (const w of apiWarehouses) {
    const id = byName.get(norm(w.name));
    if (id) map.set(w.id, id);
  }
  const used = new Set<string>();
  const rows: StockRow[] = [];
  const seen = new Set<string>();
  for (const p of products) {
    const key = norm(p.sku);
    if (seen.has(key)) {
      errors.push(`${p.sku} is listed twice`);
      continue;
    }
    seen.add(key);
    for (const [apiId, pieces] of Object.entries(p.piecesByWarehouse)) {
      if (!map.has(apiId) && pieces > 0) {
        const w = apiWarehouses.find((x) => x.id === apiId);
        unknown.add(w ? w.name : `warehouse ${apiId}`);
      }
    }
    for (const [apiId, appId] of map) {
      used.add(appId);
      rows.push({ code: p.sku, name: p.name, wid: appId, pieces: Math.max(0, Math.round(p.piecesByWarehouse[apiId] ?? 0)) });
    }
  }
  if (unknown.size) errors.push(`VR Prime has warehouses with stock that the app does not know: ${[...unknown].sort().join(", ")}`);
  if (used.size === 0) errors.push("None of VR Prime's warehouses match the app's");
  return { rows, errors };
}
