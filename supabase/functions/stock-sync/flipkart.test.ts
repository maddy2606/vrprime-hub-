// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { assertReadOnly, createFlipkartClient, FlipkartError, MAX_SKUS_PER_CALL } from "./flipkart.ts";

type Call = { method: string; url: string; headers: Record<string, string>; body: unknown; at: number };
type Handler = (call: Call) => { status?: number; json?: unknown; text?: string; headers?: Record<string, string> };

const APP_ID = "FAKE-APP-ID-123";
const APP_SECRET = "fake-app-secret-abcdef-987654";

/** A fake Flipkart plus a fake clock: sleeping moves the clock, so nothing really waits. */
function setup(routes: Handler[], options: { manualToken?: boolean } = {}) {
  let clock = 1_000_000;
  const sleeps: number[] = [];
  const calls: Call[] = [];
  const logs: string[] = [];
  let index = 0;
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      method: String(init?.method ?? "GET"),
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      at: clock,
    };
    calls.push(call);
    // By default the fake hands out a token by itself, so scripted answers are only for the real calls.
    if (!options.manualToken && call.url.includes("/oauth-service/oauth/token")) {
      return new Response(JSON.stringify({ access_token: "fake-token-xyz" }), { status: 200 });
    }
    const handler = routes[Math.min(index, routes.length - 1)];
    index += 1;
    const r = handler(call);
    return new Response(r.text ?? JSON.stringify(r.json ?? {}), { status: r.status ?? 200, headers: r.headers });
  }) as typeof fetch;

  const client = createFlipkartClient({
    appId: APP_ID,
    appSecret: APP_SECRET,
    baseUrl: "https://flipkart.test",
    fetch: fakeFetch,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    log: (m) => logs.push(m),
  });
  return { client, calls, sleeps, logs };
}

const token = (call: Call) =>
  call.url.includes("/oauth-service/oauth/token") ? { json: { access_token: "fake-token-xyz", expires_in: 100 } } : null;

test("lists SKUs across pages, with Basic auth for the token and Bearer for the rest", async () => {
  const { client, calls } = setup([
    (c) => token(c) ?? { json: { listings: [{ sku_id: "A" }, { sku_id: "B" }], next_page_id: "p2", has_more: true } },
    () => ({ json: { listings: [{ sku_id: "B" }, { sku_id: "C" }, { sku_id: 7 }], next_page_id: null, has_more: false } }),
  ]);
  const { skus, pages } = await client.listAllSkus();
  assert.deepEqual(skus, ["A", "B", "C"]);
  assert.equal(pages, 2);

  assert.equal(calls[0].method, "GET");
  assert.match(calls[0].url, /\/oauth-service\/oauth\/token\?grant_type=client_credentials&scope=Seller_Api$/);
  assert.equal(calls[0].headers.Authorization, `Basic ${btoa(`${APP_ID}:${APP_SECRET}`)}`);
  assert.equal(calls[1].method, "POST");
  assert.match(calls[1].url, /\/sellers\/listings\/v3\/search$/);
  assert.equal(calls[1].headers.Authorization, "Bearer fake-token-xyz");
  assert.deepEqual(calls[1].body, { filters: {}, page_id: null });
  assert.deepEqual(calls[2].body, { filters: {}, page_id: "p2" });
});

test("falls back to { page_id } when the search body is rejected, and reports what Flipkart said", async () => {
  const { client, calls, logs } = setup([
    (c) => token(c) ?? { status: 400, text: '{"error":"filters not allowed"}' },
    () => ({ json: { listings: [{ sku_id: "A" }], has_more: false } }),
  ]);
  const { skus } = await client.listAllSkus();
  assert.deepEqual(skus, ["A"]);
  assert.deepEqual(calls[1].body, { filters: {}, page_id: null });
  assert.deepEqual(calls[2].body, { page_id: null });
  assert.ok(logs.some((l) => l.includes("filters not allowed")), "the 400 body should be logged");
});

test("never calls the product search endpoint", async () => {
  const { client, calls } = setup([(c) => token(c) ?? { json: { listings: [], has_more: false } }]);
  await client.listAllSkus();
  await client.getListings(["A"]);
  assert.ok(calls.every((c) => !c.url.includes("/product/search")));
  assert.ok(calls.every((c) => c.method === "GET" || c.url.endsWith("/sellers/listings/v3/search")));
});

test("reads details with URL-encoded, comma-joined SKUs and reports the ones Flipkart skipped", async () => {
  const { client, calls } = setup([
    (c) => token(c) ?? { json: { available: { "A/1": { listing_id: "L1" }, "B C": { listing_id: "L2" } } } },
  ]);
  const result = await client.getListings(["A/1", "B C", "GONE"]);
  assert.deepEqual(Object.keys(result.available), ["A/1", "B C"]);
  assert.deepEqual(result.missing, ["GONE"]);
  assert.match(calls[1].url, /\/sellers\/listings\/v3\/A%2F1,B%20C,GONE$/);
});

test("refuses more than 10 SKUs in one call", async () => {
  const { client } = setup([() => ({})]);
  const many = Array.from({ length: MAX_SKUS_PER_CALL + 1 }, (_, i) => `S${i}`);
  await assert.rejects(client.getListings(many), /At most 10 SKUs/);
});

test("retries 429 and 5xx with exponential backoff, then succeeds", async () => {
  const { client, sleeps } = setup([
    () => ({ status: 429, text: "slow down" }),
    () => ({ status: 503, text: "busy" }),
    () => ({ status: 500, text: "oops" }),
    () => ({ json: { available: { A: {} } } }),
  ]);
  const result = await client.getListings(["A"]);
  assert.deepEqual(Object.keys(result.available), ["A"]);
  const backoffs = sleeps.filter((ms) => ms >= 1000);
  assert.deepEqual(backoffs, [1000, 2000, 4000]);
  assert.equal(client.stats().retries, 3);
});

test("gives up after 5 retries and says so, without leaking secrets", async () => {
  const { client, calls } = setup([
    () => ({ status: 502, text: `bad gateway for Bearer fake-token-xyz and ${APP_SECRET}` }),
  ]);
  await assert.rejects(
    client.getListings(["A"]),
    (error: unknown) => {
      assert.ok(error instanceof FlipkartError);
      assert.equal(error.status, 502);
      assert.match(error.message, /kept failing after 6 tries/);
      for (const secret of [APP_SECRET, "fake-token-xyz", btoa(`${APP_ID}:${APP_SECRET}`)]) {
        assert.ok(!error.message.includes(secret), `message must not contain ${secret}`);
      }
      return true;
    },
  );
  assert.equal(calls.filter((c) => c.url.includes("/sellers/listings/v3/A")).length, 6);
});

test("honours Retry-After when it is longer than the backoff", async () => {
  const { client, sleeps } = setup([
    () => ({ status: 429, headers: { "retry-after": "7" } }),
    () => ({ json: { available: {} } }),
  ]);
  await client.getListings(["A"]);
  assert.ok(sleeps.includes(7000));
});

test("a 401 gets a new token once and carries on", async () => {
  let tokens = 0;
  const { client, calls } = setup([
    (c) => {
      if (c.url.includes("/oauth-service")) {
        tokens += 1;
        return { json: { access_token: `token-${tokens}` } };
      }
      return c.headers.Authorization === "Bearer token-1" ? { status: 401, text: "expired" } : { json: { available: { A: {} } } };
    },
  ], { manualToken: true });
  const result = await client.getListings(["A"]);
  assert.deepEqual(Object.keys(result.available), ["A"]);
  assert.equal(tokens, 2);
  assert.equal(client.stats().tokenRefreshes, 1);
  assert.equal(calls.at(-1)?.headers.Authorization, "Bearer token-2");
});

test("a second 401 is not retried forever", async () => {
  const { client } = setup([(c) => token(c) ?? { status: 401, text: "no" }]);
  await assert.rejects(client.getListings(["A"]), /Reading listing details failed.*401/);
});

test("wrong app ID or secret gives a plain message", async () => {
  const { client } = setup([() => ({ status: 401, text: "bad credentials" })], { manualToken: true });
  await assert.rejects(client.getListings(["A"]), /rejected the app ID or secret/);
});

test("waits at least 350 ms between calls", async () => {
  const { client, calls } = setup([
    (c) => token(c) ?? { json: { available: {} } },
  ]);
  await client.getListings(["A"]);
  await client.getListings(["B"]);
  await client.getListings(["C"]);
  for (let i = 1; i < calls.length; i += 1) {
    assert.ok(calls[i].at - calls[i - 1].at >= 350, `calls ${i - 1} and ${i} were ${calls[i].at - calls[i - 1].at} ms apart`);
  }
});

test("one odd SKU that makes Flipkart refuse the batch is read on its own and skipped", async () => {
  const { client, calls, logs } = setup([
    (c) => {
      if (c.url.includes("/oauth-service")) return { json: { access_token: "t" } };
      if (c.url.endsWith("/v3/GOOD,BAD")) return { status: 400, text: "invalid sku" };
      if (c.url.endsWith("/v3/GOOD")) return { json: { available: { GOOD: { listing_id: "L" } } } };
      return { status: 400, text: "invalid sku" };
    },
  ]);
  const result = await client.getListings(["GOOD", "BAD"]);
  assert.deepEqual(Object.keys(result.available), ["GOOD"]);
  assert.deepEqual(result.missing, ["BAD"]);
  assert.ok(logs.some((l) => l.includes("one at a time")));
  assert.equal(calls.filter((c) => c.method === "GET" && c.url.includes("/v3/")).length, 3);
});

test("a SKU called 'search' is never requested, since that is another endpoint", async () => {
  const { client, calls } = setup([(c) => token(c) ?? { json: { available: { A: {} } } }]);
  const result = await client.getListings(["A", "search"]);
  assert.deepEqual(result.missing, ["search"]);
  assert.ok(calls.every((c) => !c.url.endsWith("/v3/search") || c.method === "POST"));
});

test("only the three read-only calls are allowed", () => {
  assertReadOnly("GET", "/oauth-service/oauth/token?grant_type=client_credentials&scope=Seller_Api");
  assertReadOnly("POST", "/sellers/listings/v3/search");
  assertReadOnly("GET", "/sellers/listings/v3/SKU1,SKU2");

  for (const [method, path] of [
    ["POST", "/sellers/listings/v3/product/search"],
    ["GET", "/sellers/listings/v3/search"],
    ["POST", "/sellers/listings/v3/SKU1"],
    ["PUT", "/sellers/listings/v3/SKU1"],
    ["DELETE", "/sellers/listings/v3/SKU1"],
    ["POST", "/sellers/listings/v3/update/inventory"],
    ["GET", "/sellers/orders/v2/search"],
    ["GET", "/sellers/listings/v3/a/b"],
  ]) {
    assert.throws(() => assertReadOnly(method, path), /Blocked/, `${method} ${path} must be blocked`);
  }
});
