// Read-only client for the Flipkart Seller API.
//
// Only three requests exist here, and `assertReadOnly` refuses anything else before it
// leaves the machine:
//   GET  /oauth-service/oauth/token        get an access token
//   POST /sellers/listings/v3/search       list SKUs (a search, it changes nothing)
//   GET  /sellers/listings/v3/{skus}       read listing details, at most 10 SKUs at a time
//
// Written with web-standard APIs only (fetch, URL, btoa), so it runs in Supabase Edge
// Functions (Deno) and in Node for the tests.
//
// Politeness: at least `pauseMs` (350 ms) between calls; 429 and 5xx answers are retried with
// exponential backoff (1 s, 2 s, 4 s, 8 s, 16 s: at most 5 retries); a 401 refreshes the
// token once. Secrets and tokens are scrubbed from every error message.

export const MAX_SKUS_PER_CALL = 10;

const DEFAULT_BASE_URL = "https://api.flipkart.net";
const TOKEN_PATH = "/oauth-service/oauth/token";
const TOKEN_QUERY = "?grant_type=client_credentials&scope=Seller_Api";
const SEARCH_PATH = "/sellers/listings/v3/search";
const DETAILS_PREFIX = "/sellers/listings/v3/";
const MAX_SEARCH_PAGES = 500;

export class FlipkartError extends Error {
  status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "FlipkartError";
    this.status = status;
  }
}

/** Throws unless the request is one of the three read-only calls above. */
export function assertReadOnly(method: string, pathAndQuery: string): void {
  const m = method.toUpperCase();
  const path = pathAndQuery.split("?")[0];
  const isToken = m === "GET" && path === TOKEN_PATH;
  const isSearch = m === "POST" && path === SEARCH_PATH;
  const isDetails =
    m === "GET" &&
    path.startsWith(DETAILS_PREFIX) &&
    /^[^/]+$/.test(path.slice(DETAILS_PREFIX.length)) &&
    path.slice(DETAILS_PREFIX.length) !== "search";
  if (!isToken && !isSearch && !isDetails) {
    throw new FlipkartError(`Blocked: ${m} ${path} is not one of the read-only calls this app is allowed to make`);
  }
}

export type FlipkartOptions = {
  appId: string;
  appSecret: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  pauseMs?: number;
  maxRetries?: number;
  timeoutMs?: number;
  log?: (message: string) => void;
};

export type FlipkartApi = {
  /** Every SKU Flipkart lists for this seller. */
  listAllSkus(): Promise<{ skus: string[]; pages: number }>;
  /** Details for up to 10 SKUs. `missing` are the ones Flipkart gave nothing for. */
  getListings(skus: string[]): Promise<{ available: Record<string, unknown>; missing: string[] }>;
  stats(): { calls: number; retries: number; tokenRefreshes: number };
};

type Reply = { status: number; text: string; json: unknown; retryAfterMs: number | null };

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createFlipkartClient(options: FlipkartOptions): FlipkartApi {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const pauseMs = options.pauseMs ?? 350;
  const maxRetries = options.maxRetries ?? 5;
  const timeoutMs = options.timeoutMs ?? 25_000;
  const log = options.log ?? (() => {});
  const basic = btoa(`${options.appId}:${options.appSecret}`);

  let token: string | null = null;
  let lastEnd = 0;
  const stats = { calls: 0, retries: 0, tokenRefreshes: 0 };

  /** Removes our secrets, the token and anything shaped like a credential from text. */
  function scrub(input: unknown): string {
    let text = String(input ?? "");
    for (const secret of [options.appSecret, options.appId, basic, token]) {
      if (secret && secret.length >= 6) text = text.split(secret).join("[redacted]");
    }
    return text
      .replace(/Basic\s+[A-Za-z0-9+/=_-]{8,}/gi, "[redacted]")
      .replace(/Bearer\s+[^\s"'`,;)]+/gi, "[redacted]")
      .replace(/("?(?:access_token|refresh_token)"?\s*[:=]\s*)"[^"]*"/gi, '$1"[redacted]"');
  }

  const describe = (reply: Reply) => `HTTP ${reply.status}: ${scrub(reply.text).slice(0, 300)}`;

  async function pace(): Promise<void> {
    const wait = lastEnd + pauseMs - now();
    if (wait > 0) await sleep(wait);
  }

  async function fetchToken(): Promise<string> {
    const reply = await send("GET", TOKEN_PATH + TOKEN_QUERY, { auth: "basic" });
    if (reply.status === 401 || reply.status === 403) {
      throw new FlipkartError("Flipkart rejected the app ID or secret. Check FLIPKART_APP_ID and FLIPKART_APP_SECRET.", reply.status);
    }
    const value = isObject(reply.json) ? reply.json.access_token : null;
    if (reply.status < 200 || reply.status >= 300 || typeof value !== "string" || !value) {
      throw new FlipkartError(`Flipkart did not give an access token (${describe(reply)})`, reply.status);
    }
    return value;
  }

  async function send(
    method: "GET" | "POST",
    pathAndQuery: string,
    opts: { auth: "basic" | "bearer"; body?: unknown },
  ): Promise<Reply> {
    assertReadOnly(method, pathAndQuery);
    let attempt = 0;
    let refreshed = false;
    for (;;) {
      if (opts.auth === "bearer" && !token) token = await fetchToken();
      await pace();

      let reply: Reply | null = null;
      let networkError: string | null = null;
      try {
        const headers: Record<string, string> = {
          Accept: "application/json",
          Authorization: opts.auth === "basic" ? `Basic ${basic}` : `Bearer ${token}`,
        };
        if (opts.body !== undefined) headers["Content-Type"] = "application/json";
        stats.calls += 1;
        const res = await doFetch(baseUrl + pathAndQuery, {
          method,
          headers,
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const text = await res.text();
        const retryAfter = Number(res.headers.get("retry-after"));
        reply = {
          status: res.status,
          text,
          json: parseJson(text),
          retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 60_000) : null,
        };
      } catch (error) {
        networkError = scrub(error instanceof Error ? error.message : error);
      }
      lastEnd = now();

      if (reply && reply.status === 401 && opts.auth === "bearer" && !refreshed) {
        refreshed = true;
        stats.tokenRefreshes += 1;
        log("Flipkart said the token expired (401): getting a new one");
        token = null;
        continue;
      }

      const retryable = networkError !== null || (reply !== null && (reply.status === 429 || reply.status >= 500));
      if (!retryable && reply) return reply;

      if (attempt >= maxRetries) {
        throw new FlipkartError(
          networkError !== null
            ? `Could not reach Flipkart after ${attempt + 1} tries (${networkError})`
            : `Flipkart kept failing after ${attempt + 1} tries (${describe(reply as Reply)})`,
          reply?.status ?? null,
        );
      }
      const backoff = Math.min(30_000, 1000 * 2 ** attempt);
      const wait = Math.max(backoff, reply?.retryAfterMs ?? 0);
      attempt += 1;
      stats.retries += 1;
      log(`Flipkart ${networkError !== null ? "did not answer" : `answered ${reply?.status}`}: waiting ${Math.round(wait / 1000)}s, then retry ${attempt} of ${maxRetries}`);
      await sleep(wait);
    }
  }

  async function listAllSkus(): Promise<{ skus: string[]; pages: number }> {
    const seen = new Set<string>();
    const skus: string[] = [];
    let pageId: string | null = null;
    let pages = 0;
    let withFilters = true;

    for (;;) {
      if (pages >= MAX_SEARCH_PAGES) throw new FlipkartError("Flipkart's listing search did not end after 500 pages");
      const body = withFilters ? { filters: {}, page_id: pageId } : { page_id: pageId };
      const reply = await send("POST", SEARCH_PATH, { auth: "bearer", body });

      if (reply.status === 400 && withFilters) {
        // Some accounts reject the empty filters. Say what Flipkart said, then try the plain form.
        log(`Flipkart rejected the listing search body (${describe(reply)}). Trying { "page_id": ... } only.`);
        withFilters = false;
        continue;
      }
      pages += 1;
      if (reply.status < 200 || reply.status >= 300) {
        throw new FlipkartError(`Listing search failed (${describe(reply)})`, reply.status);
      }
      const data = isObject(reply.json) ? reply.json : {};
      const listings = Array.isArray(data.listings) ? data.listings : [];
      for (const entry of listings) {
        const sku = isObject(entry) ? entry.sku_id : null;
        if (typeof sku === "string" && sku.trim() && !seen.has(sku)) {
          seen.add(sku);
          skus.push(sku);
        }
      }
      if (data.has_more !== true) return { skus, pages };
      const next = data.next_page_id;
      if (typeof next !== "string" || !next || next === pageId) {
        throw new FlipkartError("Flipkart said there are more listings but gave no next page");
      }
      pageId = next;
    }
  }

  async function getListings(requested: string[]): Promise<{ available: Record<string, unknown>; missing: string[] }> {
    if (requested.length > MAX_SKUS_PER_CALL) {
      throw new FlipkartError(`At most ${MAX_SKUS_PER_CALL} SKUs can be read in one call`);
    }
    // "search" is the name of a different endpoint, so it can never be asked for as a SKU.
    const skus = requested.filter((sku) => sku !== "search" && sku.trim() !== "");
    const available: Record<string, unknown> = {};
    if (skus.length) {
      const reply = await send("GET", DETAILS_PREFIX + skus.map(encodeURIComponent).join(","), { auth: "bearer" });
      if (reply.status === 400 && skus.length > 1) {
        // One odd SKU can make Flipkart refuse the whole batch: read them one by one instead.
        log(`Flipkart refused a batch of ${skus.length} (${describe(reply)}). Reading them one at a time.`);
        for (const sku of skus) {
          const one = await getListings([sku]);
          Object.assign(available, one.available);
        }
      } else if (reply.status === 400 || reply.status === 404) {
        log(`Flipkart has no details for ${skus.join(", ").slice(0, 120)} (${describe(reply)})`);
      } else if (reply.status < 200 || reply.status >= 300) {
        throw new FlipkartError(`Reading listing details failed (${describe(reply)})`, reply.status);
      } else if (isObject(reply.json) && isObject(reply.json.available)) {
        Object.assign(available, reply.json.available);
      } else {
        log(`Flipkart's answer for ${skus.length} SKUs had no "available" list`);
      }
    }
    return { available, missing: requested.filter((sku) => !(sku in available)) };
  }

  return { listAllSkus, getListings, stats: () => ({ ...stats }) };
}
