// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { assertReadOnly, createOrdersClient, FlipkartError, nextPath } from "./flipkart.ts";

type Call = { method: string; url: string; headers: Record<string, string>; body: unknown };
type Handler = (call: Call) => { status?: number; json?: unknown; text?: string; headers?: Record<string, string> };

const APP_ID = "FAKE-APP-ID-123";
const APP_SECRET = "fake-app-secret-abcdef-987654";

/** A fake Flipkart plus a fake clock: sleeping moves the clock, so nothing really waits. */
function setup(routes: Handler[]) {
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
    };
    calls.push(call);
    if (call.url.includes("/oauth-service/oauth/token")) {
      return new Response(JSON.stringify({ access_token: "fake-token-xyz" }), { status: 200 });
    }
    const handler = routes[Math.min(index, routes.length - 1)];
    index += 1;
    const r = handler(call);
    return new Response(r.text ?? JSON.stringify(r.json ?? {}), { status: r.status ?? 200, headers: r.headers });
  }) as typeof fetch;

  const client = createOrdersClient({
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

const FILTER = { type: "preDispatch", states: ["APPROVED"] };

test("reads shipments: Bearer token, the filter and sort in the body, and the next page with the /sellers prefix added", async () => {
  const { client, calls } = setup([
    () => ({ json: { hasMore: true, nextPageUrl: "/v3/shipments/filter?next_token=abc123", shipments: [{ shipmentId: "S1" }] } }),
    () => ({ json: { hasMore: false, shipments: [{ shipmentId: "S2" }] } }),
  ]);
  const first = await client.shipmentsPage({ filter: FILTER, sorted: true }, null);
  assert.deepEqual(first.shipments, [{ shipmentId: "S1" }]);
  assert.equal(first.next, "/sellers/v3/shipments/filter?next_token=abc123");
  const second = await client.shipmentsPage({ filter: FILTER, sorted: true }, first.next);
  assert.equal(second.next, null, "no more pages");

  const shipments = calls.filter((c) => !c.url.includes("oauth"));
  assert.equal(shipments[0].method, "POST");
  assert.equal(shipments[0].url, "https://flipkart.test/sellers/v3/shipments/filter/");
  assert.equal(shipments[0].headers.Authorization, "Bearer fake-token-xyz");
  assert.deepEqual(shipments[0].body, {
    filter: FILTER,
    pagination: { pageSize: 20 },
    sort: { field: "dispatchByDate", order: "asc" },
  });
  assert.equal(shipments[1].method, "GET", "the next page is fetched, not searched again");
  assert.equal(shipments[1].body, undefined);
  assert.equal(shipments[1].url, "https://flipkart.test/sellers/v3/shipments/filter?next_token=abc123");
});

test("the one state that fails with the sort is asked for without it", async () => {
  const { client, calls } = setup([() => ({ json: { hasMore: false, shipments: [] } })]);
  await client.shipmentsPage({ filter: { type: "preDispatch", states: ["PACKING_IN_PROGRESS"] }, sorted: false }, null);
  const body = calls.find((c) => c.url.includes("/shipments/filter"))?.body as Record<string, unknown>;
  assert.equal("sort" in body, false);
});

test("reads returns with the source and date, and follows nextUrl on Flipkart's host with /sellers added", async () => {
  const { client, calls } = setup([
    () => ({ json: { hasMore: true, nextUrl: "/returns/search/ZXlKbWFXeDBaWElpT2lKYj09?", returnItems: [{ orderItemId: "OI1" }] } }),
    () => ({ json: { hasMore: false, returnItems: [{ orderItemId: "OI2" }] } }),
  ]);
  const first = await client.returnsPage({ source: "courier_return", since: "createdAfter", at: "2026-09-12T00:00:00.000Z" }, null);
  assert.equal(first.items.length, 1);
  assert.equal(first.next, "/sellers/v2/returns/search/ZXlKbWFXeDBaWElpT2lKYj09");
  const second = await client.returnsPage({ source: "courier_return", since: "createdAfter", at: "x" }, first.next);
  assert.equal(second.next, null);
  const returns = calls.filter((c) => !c.url.includes("oauth"));
  assert.equal(returns[0].method, "GET");
  assert.equal(returns[0].url, "https://flipkart.test/sellers/v2/returns?source=courier_return&createdAfter=2026-09-12T00%3A00%3A00.000Z");
  assert.equal(returns[1].url, "https://flipkart.test/sellers/v2/returns/search/ZXlKbWFXeDBaWElpT2lKYj09");
});

test("says so when Flipkart claims there is more but gives no next page", async () => {
  const { client } = setup([() => ({ json: { hasMore: true, shipments: [] } })]);
  await assert.rejects(() => client.shipmentsPage({ filter: FILTER, sorted: true }, null), /no next page/);
});

test("retries 500s with growing waits, then gives up with a scrubbed message", async () => {
  const { client, sleeps, calls } = setup([() => ({ status: 500, text: `{"errors":[{"code":"DEPENDENT_SYSTEM_CALL_FAILED"}]} ${APP_SECRET}` })]);
  await assert.rejects(
    () => client.shipmentsPage({ filter: FILTER, sorted: true }, null),
    (error: unknown) => {
      assert.ok(error instanceof FlipkartError);
      assert.match(error.message, /kept failing after 6 tries/);
      assert.ok(!error.message.includes(APP_SECRET), "the secret must not leak into an error");
      return true;
    },
  );
  assert.deepEqual(sleeps.filter((s) => s >= 1000), [1000, 2000, 4000, 8000, 16000]);
  assert.equal(calls.filter((c) => c.url.includes("/shipments/filter")).length, 6);
});

test("honours Retry-After on a 429 and succeeds afterwards", async () => {
  const { client, sleeps } = setup([
    () => ({ status: 429, headers: { "retry-after": "7" }, text: "slow down" }),
    () => ({ json: { hasMore: false, shipments: [] } }),
  ]);
  const page = await client.shipmentsPage({ filter: FILTER, sorted: true }, null);
  assert.equal(page.next, null);
  assert.ok(sleeps.includes(7000));
});

test("refreshes the token once on a 401", async () => {
  const { client, calls } = setup([() => ({ status: 401, text: "expired" }), () => ({ json: { hasMore: false, shipments: [] } })]);
  await client.shipmentsPage({ filter: FILTER, sorted: true }, null);
  assert.equal(calls.filter((c) => c.url.includes("oauth")).length, 2);
  assert.equal(client.stats().tokenRefreshes, 1);
});

test("a 4xx answer is an error straight away, not retried", async () => {
  const { client, calls } = setup([() => ({ status: 422, text: '{"errors":["bad filter"]}' })]);
  await assert.rejects(() => client.shipmentsPage({ filter: FILTER, sorted: true }, null), /Reading shipments failed \(HTTP 422/);
  assert.equal(calls.filter((c) => c.url.includes("/shipments/filter")).length, 1);
});

test("paces calls: at least 350 ms between them", async () => {
  const { client, sleeps } = setup([() => ({ json: { hasMore: false, shipments: [] } })]);
  await client.shipmentsPage({ filter: FILTER, sorted: true }, null);
  await client.shipmentsPage({ filter: FILTER, sorted: true }, null);
  assert.ok(sleeps.some((s) => s > 0 && s <= 350), "a short pause between calls");
});

test("read-only by construction: only the allowed requests can be made", () => {
  assertReadOnly("GET", "/oauth-service/oauth/token?grant_type=client_credentials&scope=Seller_Api");
  assertReadOnly("POST", "/sellers/v3/shipments/filter/");
  assertReadOnly("GET", "/sellers/v3/shipments/filter?next_token=abc");
  assertReadOnly("GET", "/sellers/v2/returns?source=customer_return&createdAfter=x");
  assertReadOnly("GET", "/sellers/v2/returns/search/ZXlKbWFXeDBa+/==");

  for (const [method, path] of [
    ["POST", "/sellers/v3/shipments/dispatch"],
    ["POST", "/sellers/v3/shipments/ship"],
    ["POST", "/sellers/v3/shipments/cancel"],
    ["POST", "/sellers/v2/returns"],
    ["GET", "/sellers/v3/shipments"],
    ["DELETE", "/sellers/v3/shipments/filter/"],
    ["PUT", "/sellers/v3/shipments/filter/"],
    ["POST", "/sellers/listings/v3/update/price"],
    ["POST", "/sellers/listings/v3/update/inventory"],
    ["GET", "/sellers/v3/shipments/filter/"],
    ["POST", "/sellers/v3/shipments/filter"],
    ["POST", "/reports/sales_ledger"],
    ["GET", "/sellers/returns/search/ZXlKbWFXeDBa"],
  ]) {
    assert.throws(() => assertReadOnly(method, path), /Blocked/, `${method} ${path} must be refused`);
  }
});

test("a next-page address on another host is never followed", () => {
  assert.throws(() => nextPath("https://evil.example/v3/shipments/filter?next_token=abc", "https://api.flipkart.net"), /another host/);
  assert.equal(nextPath("https://api.flipkart.net/v3/shipments/filter?next_token=abc"), "/sellers/v3/shipments/filter?next_token=abc");
  assert.equal(nextPath("/sellers/v3/shipments/filter?next_token=abc"), "/sellers/v3/shipments/filter?next_token=abc");
});
