// Read-only client for the Flipkart order and returns APIs.
//
// Only these requests exist here, and `assertReadOnly` refuses anything else before it leaves
// the machine:
//   GET  /oauth-service/oauth/token            get an access token
//   POST /sellers/v3/shipments/filter/         search shipments (a search, it changes nothing)
//   GET  /sellers/v3/shipments/filter?next_token=...   the following pages (the address carries the whole search)
//   GET  /sellers/v2/returns                   list returns (courier_return or customer_return)
//   GET  /sellers/v2/returns/search/<token>    the following pages of a returns list
//
// Facts learned by testing against the real API (see README, Phase 4):
//   * shipments come 20 to a page at most; a page takes about 5 to 16 seconds
//   * a page of results ends with `hasMore` and `nextPageUrl`; that address lacks the /sellers
//     prefix, which is added here, and it is only ever followed on Flipkart's own host
//   * returns come 25 to a page, with `hasMore` and `nextUrl` ("/returns/search/<token>"); it is fetched under
//     /sellers/v2, found by testing: under /sellers alone Flipkart answers 500
//   * PACKING_IN_PROGRESS combined with the dispatchByDate sort answers 500, so that state is read unsorted
//   * postDispatch needs shipmentTypes ["NORMAL"]; the cancelled state is spelled "Cancelled"
//
// Written with web-standard APIs only (fetch, URL, btoa), so it runs in Supabase Edge Functions
// (Deno) and in Node for the tests.
//
// Politeness: at least `pauseMs` (350 ms) between calls; 429 and 5xx answers are retried with
// exponential backoff (1 s, 2 s, 4 s, 8 s, 16 s: at most 5 retries); a 401 refreshes the token
// once. Secrets and tokens are scrubbed from every error message.

const DEFAULT_BASE_URL = "https://api.flipkart.net";
const TOKEN_PATH = "/oauth-service/oauth/token";
const TOKEN_QUERY = "?grant_type=client_credentials&scope=Seller_Api";
const SHIPMENTS_FIRST = "/sellers/v3/shipments/filter/";
const RETURNS_FIRST = "/sellers/v2/returns";
export const SHIPMENTS_PAGE_SIZE = 20;

export class FlipkartError extends Error {
  status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "FlipkartError";
    this.status = status;
  }
}

/** Throws unless the request is one of the read-only calls above. */
export function assertReadOnly(method: string, pathAndQuery: string): void {
  const m = method.toUpperCase();
  const path = pathAndQuery.split("?")[0];
  const ok =
    (m === "GET" && path === TOKEN_PATH) ||
    (m === "POST" && path === SHIPMENTS_FIRST) ||
    (m === "GET" && path === "/sellers/v3/shipments/filter") ||
    (m === "GET" && path === RETURNS_FIRST) ||
    (m === "GET" && /^\/sellers\/v2\/returns\/search\/[A-Za-z0-9+/=_-]+$/.test(path));
  if (!ok) throw new FlipkartError(`Blocked: ${m} ${path} is not one of the read-only calls this app is allowed to make`);
}

/**
 * Turns the "next page" address Flipkart gives into the path and query to ask for. Flipkart leaves
 * out the /sellers prefix. Anything that points at another host is refused, so a tampered answer
 * can never send our token elsewhere.
 */
export function nextPath(url: string, baseUrl = DEFAULT_BASE_URL): string {
  let parsed: URL;
  try {
    parsed = new URL(url, baseUrl);
  } catch {
    throw new FlipkartError("Flipkart gave a next-page address that could not be read");
  }
  if (parsed.origin !== new URL(baseUrl).origin) {
    throw new FlipkartError("Flipkart gave a next-page address on another host: not followed");
  }
  const path = parsed.pathname.startsWith("/sellers/") ? parsed.pathname : `/sellers${parsed.pathname}`;
  const search = parsed.search === "?" ? "" : parsed.search;
  return path + search;
}

/** The next-page address of a returns list: Flipkart leaves out /sellers/v2. */
export function nextReturnsPath(url: string, baseUrl = DEFAULT_BASE_URL): string {
  const path = nextPath(url, baseUrl);
  return path.startsWith("/sellers/returns/") ? path.replace("/sellers/returns/", "/sellers/v2/returns/") : path;
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

export type ShipmentsRequest = {
  filter: Record<string, unknown>;
  /** false for the one state that answers 500 when sorted. */
  sorted: boolean;
};

export type ReturnsRequest = {
  source: "courier_return" | "customer_return";
  /** Which date to compare: created after, or modified after. */
  since: "createdAfter" | "modifiedAfter";
  at: string;
};

export type ShipmentsPage = { shipments: unknown[]; next: string | null };
export type ReturnsPage = { items: unknown[]; next: string | null };

export type OrdersApi = {
  /** One page of shipments. Pass back `next` from the page before to get the following one. */
  shipmentsPage(request: ShipmentsRequest, next: string | null): Promise<ShipmentsPage>;
  /** One page of returns. */
  returnsPage(request: ReturnsRequest, next: string | null): Promise<ReturnsPage>;
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

export function createOrdersClient(options: FlipkartOptions): OrdersApi {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const pauseMs = options.pauseMs ?? 350;
  const maxRetries = options.maxRetries ?? 5;
  const timeoutMs = options.timeoutMs ?? 40_000;
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

  /** What Flipkart said, cut short and without anything that could be a buyer's detail (we only ever show a few hundred characters). */
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

  async function shipmentsPage(request: ShipmentsRequest, next: string | null): Promise<ShipmentsPage> {
    const body: Record<string, unknown> = { filter: request.filter, pagination: { pageSize: SHIPMENTS_PAGE_SIZE } };
    if (request.sorted) body.sort = { field: "dispatchByDate", order: "asc" };
    // The first page is a search (POST). The address Flipkart gives for the next page carries the whole
    // search, so it is simply fetched (GET): posting the filter again only gives the first page back.
    const reply = next ? await send("GET", next, { auth: "bearer" }) : await send("POST", SHIPMENTS_FIRST, { auth: "bearer", body });
    if (reply.status < 200 || reply.status >= 300) {
      throw new FlipkartError(`Reading shipments failed (${describe(reply)})`, reply.status);
    }
    const data = isObject(reply.json) ? reply.json : {};
    const shipments = Array.isArray(data.shipments) ? data.shipments : [];
    const url = typeof data.nextPageUrl === "string" && data.nextPageUrl ? data.nextPageUrl : null;
    if (data.hasMore === true && !url) throw new FlipkartError("Flipkart said there are more shipments but gave no next page");
    return { shipments, next: data.hasMore === true && url ? nextPath(url, baseUrl) : null };
  }

  async function returnsPage(request: ReturnsRequest, next: string | null): Promise<ReturnsPage> {
    const first = `${RETURNS_FIRST}?source=${request.source}&${request.since}=${encodeURIComponent(request.at)}`;
    const reply = await send("GET", next ?? first, { auth: "bearer" });
    if (reply.status < 200 || reply.status >= 300) {
      throw new FlipkartError(`Reading returns failed (${describe(reply)})`, reply.status);
    }
    const data = isObject(reply.json) ? reply.json : {};
    const items = Array.isArray(data.returnItems) ? data.returnItems : [];
    const url = typeof data.nextUrl === "string" && data.nextUrl ? data.nextUrl : null;
    if (data.hasMore === true && !url) throw new FlipkartError("Flipkart said there are more returns but gave no next page");
    return { items, next: data.hasMore === true && url ? nextReturnsPath(url, baseUrl) : null };
  }

  return { shipmentsPage, returnsPage, stats: () => ({ ...stats }) };
}
