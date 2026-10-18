import assert from "node:assert/strict";
import { test } from "node:test";
import { createVrPrimeClient, toStockRows, VrPrimeError, type VrPrimeProduct } from "./vrprime.ts";

// A stand-in for api.vrprime.in: made-up logins, made-up stock. Nothing here is real.
type Handler = (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } | undefined) => { status: number; body: unknown };

function fakeApi(handler: Handler) {
  const calls: { url: string; method: string; auth?: string; body?: string }[] = [];
  const fetch = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    calls.push({ url, method: init?.method ?? "GET", auth: init?.headers?.Authorization, body: init?.body });
    const r = handler(url, init);
    const text = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => text };
  };
  return { fetch, calls };
}

const BASE = "https://api.example.test/api";
const ok: Handler = (url, init) => {
  if (url === `${BASE}/auth/login/`) {
    const b = JSON.parse(init!.body!);
    return b.password === "s3cret-pass" ? { status: 200, body: { access: "tok-abc-123", refresh: "r", user: {} } } : { status: 401, body: { detail: "No active account for s3cret-pass-wrong" } };
  }
  if (init?.headers?.Authorization !== "Bearer tok-abc-123") return { status: 401, body: { detail: "no" } };
  if (url === `${BASE}/warehouses/`) return { status: 200, body: [{ id: 1, name: "Bhiwandi" }, { id: 2, name: "Delhi" }] };
  if (url === `${BASE}/products/?month=2026-10`) {
    return {
      status: 200,
      body: [
        { sku: "LINT-1", name: "Lint Remover", piecesByWarehouse: { "1": 22853, "2": 2300 }, pieces: 25153 },
        { sku: "RAT-2", name: "Rat Spray", piecesByWarehouse: { "1": "40" } },
      ],
    };
  }
  return { status: 404, body: "nope" };
};

const client = (api: ReturnType<typeof fakeApi>, password = "s3cret-pass") => createVrPrimeClient({ username: "u", password, baseUrl: BASE, fetch: api.fetch });

test("log in, then warehouses and products, with the token on the calls that need it", async () => {
  const api = fakeApi(ok);
  const c = client(api);
  await c.login();
  assert.deepEqual(await c.warehouses(), [{ id: "1", name: "Bhiwandi" }, { id: "2", name: "Delhi" }]);
  const products = await c.products("2026-10");
  assert.deepEqual(products[0], { sku: "LINT-1", name: "Lint Remover", piecesByWarehouse: { "1": 22853, "2": 2300 } });
  assert.deepEqual(products[1].piecesByWarehouse, { "1": 40 }, "a stock count sent as text is read as a number");
  assert.equal(api.calls[0].auth, undefined, "the login carries no token");
  assert.ok(api.calls.slice(1).every((x) => x.auth === "Bearer tok-abc-123"));
  assert.ok(api.calls.every((x) => x.method !== "PUT" && x.method !== "DELETE" && x.method !== "PATCH"), "read only");
});

test("a wrong password says so, without repeating the password", async () => {
  const api = fakeApi(ok);
  await assert.rejects(client(api, "s3cret-pass-wrong").login(), (e: unknown) => {
    assert.ok(e instanceof VrPrimeError);
    assert.match(e.message, /rejected the username or password/);
    assert.ok(!e.message.includes("s3cret-pass"));
    return true;
  });
});

test("a server error is reported with the token and password scrubbed", async () => {
  const api = fakeApi((url) => (url.endsWith("/auth/login/") ? { status: 200, body: { access: "tok-abc-123" } } : { status: 500, body: `crash with tok-abc-123 and s3cret-pass and Bearer tok-abc-123` }));
  const c = client(api);
  await c.login();
  await assert.rejects(c.warehouses(), (e: unknown) => {
    const m = (e as Error).message;
    assert.match(m, /HTTP 500/);
    assert.ok(!m.includes("tok-abc-123") && !m.includes("s3cret-pass"), m);
    return true;
  });
});

test("a network failure is a clear message", async () => {
  const c = createVrPrimeClient({ username: "u", password: "pw-long", baseUrl: BASE, fetch: async () => { throw new Error("getaddrinfo ENOTFOUND"); } });
  await assert.rejects(c.login(), /Could not reach VR Prime/);
});

test("paged answers are followed, but only on the same API", async () => {
  const api = fakeApi((url) => {
    if (url.endsWith("/auth/login/")) return { status: 200, body: { access: "t" } };
    if (url === `${BASE}/products/?month=2026-10`) return { status: 200, body: { results: [{ sku: "A", name: "A", piecesByWarehouse: {} }], next: `${BASE}/products/?month=2026-10&page=2` } };
    if (url === `${BASE}/products/?month=2026-10&page=2`) return { status: 200, body: { results: [{ sku: "B", name: "B", piecesByWarehouse: {} }], next: "https://evil.example/steal" } };
    return { status: 404, body: "" };
  });
  const c = client(api);
  await c.login();
  const list = await c.products("2026-10");
  assert.deepEqual(list.map((p) => p.sku), ["A", "B"]);
  assert.ok(api.calls.every((x) => x.url.startsWith(BASE)), "never followed to another address");
});

test("an empty product list is an error, not an empty stock", async () => {
  const api = fakeApi((url) => (url.endsWith("/auth/login/") ? { status: 200, body: { access: "t" } } : { status: 200, body: [] }));
  const c = client(api);
  await c.login();
  await assert.rejects(c.products("2026-10"), /no products/);
});

const APP = [{ id: "uuid-bhi", name: "Bhiwandi" }, { id: "uuid-del", name: "Delhi" }, { id: "uuid-blr", name: "Bangalore" }];
const API_WH = [{ id: "1", name: "Bhiwandi" }, { id: "2", name: "delhi " }];
const P = (sku: string, by: Record<string, number>): VrPrimeProduct => ({ sku, name: `Name ${sku}`, piecesByWarehouse: by });

test("rows: one per product and mapped warehouse, a missing count is 0, matched by name", () => {
  const r = toStockRows([P("A", { "1": 10, "2": 5 }), P("B", { "1": 7 })], API_WH, APP);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.rows.map((x) => [x.code, x.wid, x.pieces]), [["A", "uuid-bhi", 10], ["A", "uuid-del", 5], ["B", "uuid-bhi", 7], ["B", "uuid-del", 0]]);
});

test("rows: stock in a warehouse the app does not know is an error; an empty unknown warehouse is ignored", () => {
  const wh = [...API_WH, { id: "9", name: "Pune" }];
  const bad = toStockRows([P("A", { "1": 1, "9": 4 })], wh, APP);
  assert.match(bad.errors.join(), /do not know|does not know|app does not know: Pune/);
  const fine = toStockRows([P("A", { "1": 1, "9": 0 })], wh, APP);
  assert.deepEqual(fine.errors.filter((e) => /Pune/.test(e)), [], "Pune is listed but empty, so nothing is lost");
});

test("rows: negative or fractional stock is tidied, duplicates are reported, no match at all is an error", () => {
  const r = toStockRows([P("A", { "1": -3, "2": 4.6 }), P("a", { "1": 1 })], API_WH, APP);
  assert.deepEqual(r.rows.filter((x) => x.code === "A").map((x) => x.pieces), [0, 5]);
  assert.match(r.errors.join(), /listed twice/);
  const none = toStockRows([P("A", { "1": 1 })], [{ id: "1", name: "Nowhere" }], APP);
  assert.match(none.errors.join(), /None of VR Prime's warehouses match/);
});
