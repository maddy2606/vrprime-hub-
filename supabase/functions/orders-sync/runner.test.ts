// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import type { OrdersApi, ReturnsRequest, ShipmentsRequest } from "./flipkart.ts";
import type { OrderItemRow, ReturnRow } from "./rules.ts";
import { processRun, type OrdersStore, type RunnerDeps, type RunRow } from "./runner.ts";

const ISO = { from: "2026-10-05T00:00:00.000Z", to: "2026-10-06T00:00:00.000Z" };

/** An in-memory stand-in for the database side of a run. */
function fakeStore(plan: unknown[], kind = "pending", opts: { other?: () => boolean } = {}) {
  const run = { id: "run-1", kind, status: "queued", plan, step: 0, next_path: null as string | null, lease: false, failed: null as string | null, paused: null as string | null, finished: false };
  const pages: { step: number; items: OrderItemRow[]; returns: ReturnRow[]; next: string | null }[] = [];
  const events: string[] = [];
  const store: OrdersStore = {
    async loadRun(): Promise<RunRow> {
      return { id: run.id, kind: run.kind, status: run.status, plan: run.plan, step: run.step, next_path: run.next_path };
    },
    async acquireLease() {
      if (run.lease || !["queued", "running", "paused"].includes(run.status)) return false;
      run.lease = true;
      run.status = "running";
      return true;
    },
    async renewLease() {},
    async releaseLease() {
      run.lease = false;
      events.push("release");
    },
    async applyPage(_id, step, items, returns, next) {
      if (step !== run.step) throw new Error(`run is at step ${run.step}, not ${step}`);
      pages.push({ step, items, returns, next });
      if (next === null) {
        run.step += 1;
        run.next_path = null;
      } else {
        run.next_path = next;
      }
    },
    async finish() {
      run.finished = true;
      run.status = "done";
      run.lease = false;
      return { ok: run.step >= run.plan.length };
    },
    async fail(_id, message) {
      run.failed = message;
      run.status = "failed";
      run.lease = false;
    },
    async pause(_id, message) {
      run.paused = message;
      run.status = "paused";
      run.lease = false;
    },
    async otherSyncActive() {
      return opts.other?.() ?? false;
    },
  };
  return { store, run, pages, events };
}

/** A fake Flipkart that serves `perTopic` pages for every part it is asked about. */
function fakeFlipkart(pagesPerPart: number, opts: { failOn?: number; message?: string } = {}) {
  const asked: string[] = [];
  let n = 0;
  const flipkart: OrdersApi = {
    async shipmentsPage(request: ShipmentsRequest, next) {
      n += 1;
      if (opts.failOn === n) throw new Error(opts.message ?? "Flipkart kept failing");
      const page = next ? Number(next.split("=")[1]) : 1;
      asked.push(`${JSON.stringify(request.filter)}#${page}`);
      return {
        shipments: [{ shipmentId: `S${n}`, locationId: "LOC1", hold: false, orderItems: [{ orderItemId: `OI${n}`, orderId: `OD${n}`, sku: "SKU", quantity: 1, status: "APPROVED" }] }],
        next: page < pagesPerPart ? `/sellers/v3/shipments/filter?page=${page + 1}` : null,
      };
    },
    async returnsPage(request: ReturnsRequest, next) {
      n += 1;
      const page = next ? Number(next.split("=")[1]) : 1;
      asked.push(`returns:${request.source}#${page}`);
      return { items: [{ orderItemId: `OI-R${n}`, returnId: `R${n}`, comments: "SECRET" }], next: page < pagesPerPart ? `/sellers/returns/search/x?page=${page + 1}` : null };
    },
    stats: () => ({ calls: n, retries: 0, tokenRefreshes: 0 }),
  };
  return { flipkart, asked };
}

function deps(over: Partial<RunnerDeps> & Pick<RunnerDeps, "store" | "flipkart">): { d: RunnerDeps; logs: string[]; chained: string[] } {
  const logs: string[] = [];
  const chained: string[] = [];
  let clock = 0;
  const d: RunnerDeps = {
    now: () => (clock += 10),
    budgetMs: 1_000_000,
    chain: async (id) => {
      chained.push(id);
    },
    isNight: () => true,
    log: (m) => logs.push(m),
    scrub: (v) => String(v).replace(/SECRET-VALUE/g, "[redacted]"),
    ...over,
  };
  return { d, logs, chained };
}

const PENDING_PLAN = [
  { t: "pre", state: "APPROVED" },
  { t: "pre", state: "PACKING_IN_PROGRESS" },
];

test("reads every page of every part, saving each page with the position, then finishes", async () => {
  const { store, run, pages } = fakeStore(PENDING_PLAN);
  const { flipkart, asked } = fakeFlipkart(3);
  const { d } = deps({ store, flipkart });
  assert.equal(await processRun("run-1", d), "done");
  assert.equal(pages.length, 6, "3 pages for each of the 2 parts");
  assert.deepEqual(pages.map((p) => p.step), [0, 0, 0, 1, 1, 1]);
  assert.deepEqual(pages.map((p) => p.next === null), [false, false, true, false, false, true]);
  assert.equal(asked.length, 6);
  assert.ok(asked[0].includes('"APPROVED"') && asked[3].includes('"PACKING_IN_PROGRESS"'));
  assert.equal(run.status, "done");
  assert.equal(run.finished, true);
});

test("hands over when the time budget is used, and the next worker carries on from the saved position", async () => {
  const { store, run, pages, events } = fakeStore(PENDING_PLAN);
  const { flipkart } = fakeFlipkart(3);
  let clock = 0;
  const { d, chained } = deps({ store, flipkart, now: () => (clock += 100), budgetMs: 350 });
  assert.equal(await processRun("run-1", d), "continued");
  assert.ok(events.includes("release"));
  assert.deepEqual(chained, ["run-1"], "it asks for another invocation");
  const first = pages.length;
  assert.ok(first > 0 && first < 6, "it stopped part way");

  // The fresh worker (with plenty of time) finishes without reading any page twice.
  const { d: d2 } = deps({ store, flipkart });
  assert.equal(await processRun("run-1", d2), "done");
  assert.equal(pages.length, 6);
  assert.equal(run.status, "done");
  assert.deepEqual(
    pages.map((p) => `${p.step}`),
    ["0", "0", "0", "1", "1", "1"],
  );
});

test("a worker cut off in the middle is restarted from the last saved page", async () => {
  const { store, run, pages } = fakeStore(PENDING_PLAN);
  const { flipkart } = fakeFlipkart(3, { failOn: 3 });
  // The first worker dies on its third page (simulated as an error that is not recorded as a failure).
  const { d } = deps({ store, flipkart });
  const outcome = await processRun("run-1", d);
  assert.equal(outcome, "failed", "a non-backfill run records the failure");
  assert.equal(pages.length, 2);
  assert.equal(run.next_path, "/sellers/v3/shipments/filter?page=3");
});

test("a run another worker holds is left alone", async () => {
  const { store, run } = fakeStore(PENDING_PLAN);
  run.lease = true;
  const { flipkart } = fakeFlipkart(1);
  const { d } = deps({ store, flipkart });
  assert.equal(await processRun("run-1", d), "skipped");
});

test("a finished run is not started again", async () => {
  const { store, run } = fakeStore(PENDING_PLAN);
  run.status = "done";
  const { flipkart } = fakeFlipkart(1);
  const { d } = deps({ store, flipkart });
  assert.equal(await processRun("run-1", d), "skipped");
});

test("without the Flipkart secrets the run fails with a clear message", async () => {
  const { store, run } = fakeStore(PENDING_PLAN);
  const { d } = deps({ store, flipkart: null });
  assert.equal(await processRun("run-1", d), "failed");
  assert.match(run.failed ?? "", /not connected yet/);
});

test("a failed pending run records a scrubbed error", async () => {
  const { store, run } = fakeStore(PENDING_PLAN);
  const { flipkart } = fakeFlipkart(2, { failOn: 1, message: "boom SECRET-VALUE here" });
  const { d } = deps({ store, flipkart });
  assert.equal(await processRun("run-1", d), "failed");
  assert.equal(run.failed, "boom [redacted] here");
});

test("waits (pauses, does not fail) while a stock sync or another order run is working", async () => {
  const { store, run, pages } = fakeStore(PENDING_PLAN);
  const { flipkart } = fakeFlipkart(2);
  const { d } = deps({ store, flipkart });
  let busy = true;
  const waiting = { ...d, store: { ...store, otherSyncActive: async () => busy } };
  assert.equal(await processRun("run-1", waiting), "paused");
  assert.equal(run.status, "paused");
  assert.equal(pages.length, 0, "nothing was read from Flipkart while the other sync was working");
  busy = false;
  assert.equal(await processRun("run-1", waiting), "done", "and it carries on once the other sync is over");
});

test("the backfill only works at night, and goes back to sleep at dawn", async () => {
  const plan = [
    { t: "post", ...ISO },
    { t: "post", from: "2026-10-04T00:00:00.000Z", to: ISO.from },
  ];
  const { store, run, pages } = fakeStore(plan, "backfill");
  const { flipkart } = fakeFlipkart(2);
  const { d } = deps({ store, flipkart, isNight: () => false });
  assert.equal(await processRun("run-1", d), "paused");
  assert.equal(pages.length, 0);
  assert.match(run.paused ?? "", /night/);

  let reads = 0;
  const dawn = deps({ store, flipkart, isNight: () => reads++ < 2 }).d;
  assert.equal(await processRun("run-1", dawn), "paused", "it stops when the night ends");
  assert.equal(pages.length, 2, "two pages were read while it was dark");

  const { d: night } = deps({ store, flipkart, isNight: () => true });
  assert.equal(await processRun("run-1", night), "done", "the next night it finishes from where it stopped");
  assert.equal(pages.length, 4);
});

test("the backfill pauses on a Flipkart error instead of failing", async () => {
  const { store, run } = fakeStore([{ t: "post", ...ISO }], "backfill");
  const { flipkart } = fakeFlipkart(2, { failOn: 1 });
  const { d } = deps({ store, flipkart });
  assert.equal(await processRun("run-1", d), "paused");
  assert.equal(run.status, "paused");
  assert.equal(run.failed, null);
});

test("returns are read and saved with their own list, and a page saved for the wrong part is not an error here", async () => {
  const plan = [
    { t: "returns", source: "courier_return", since: "createdAfter", at: ISO.from },
    { t: "returns", source: "customer_return", since: "createdAfter", at: ISO.from },
  ];
  const { store, pages } = fakeStore(plan, "daily");
  const { flipkart, asked } = fakeFlipkart(2);
  const { d } = deps({ store, flipkart });
  assert.equal(await processRun("run-1", d), "done");
  assert.deepEqual(asked, ["returns:courier_return#1", "returns:courier_return#2", "returns:customer_return#1", "returns:customer_return#2"]);
  assert.equal(pages[0].items.length, 0);
  assert.equal(pages[0].returns.length, 1);
  assert.ok(!JSON.stringify(pages).includes("SECRET"), "the buyer's comment is never passed on");
});

test("a run that was paused or replaced while working is dropped quietly", async () => {
  const { store } = fakeStore(PENDING_PLAN);
  const { flipkart } = fakeFlipkart(2);
  const { d, logs } = deps({ store, flipkart });
  const taken = { ...d, store: { ...store, applyPage: async () => { throw new Error("run is not running"); } } };
  assert.equal(await processRun("run-1", taken), "skipped");
  assert.ok(logs.some((l) => l.includes("paused or stopped")));
});

test("a plan part that cannot be read stops the run", async () => {
  const { store, run } = fakeStore([{ t: "mystery" }]);
  const { flipkart } = fakeFlipkart(1);
  const { d } = deps({ store, flipkart });
  assert.equal(await processRun("run-1", d), "failed");
  assert.match(run.failed ?? "", /could not be read/);
});

test("stops, instead of looping, when Flipkart keeps handing back the same page", async () => {
  const { store, run, pages } = fakeStore([{ t: "pre", state: "APPROVED" }]);
  const stuck: OrdersApi = {
    async shipmentsPage() {
      return { shipments: [{ shipmentId: "S", orderItems: [{ orderItemId: "SAME", orderId: "O", sku: "A" }] }], next: "/sellers/v3/shipments/filter?next_token=same" };
    },
    async returnsPage() {
      return { items: [], next: null };
    },
    stats: () => ({ calls: 0, retries: 0, tokenRefreshes: 0 }),
  };
  const { d } = deps({ store, flipkart: stuck });
  assert.equal(await processRun("run-1", d), "failed");
  assert.match(run.failed ?? "", /same page twice/);
  assert.equal(pages.length, 1, "it noticed on the second page, before saving it");
});

test("stops, instead of saving a cut-short list as complete, when a part reaches Flipkart's 5,000 result limit", async () => {
  const { store, run } = fakeStore([{ t: "pre", state: "APPROVED" }]);
  let n = 0;
  const big: OrdersApi = {
    async shipmentsPage() {
      n += 1;
      return {
        shipments: Array.from({ length: 20 }, (_, i) => ({ shipmentId: `S${n}-${i}`, orderItems: [{ orderItemId: `OI-${n}-${i}`, orderId: `O-${n}-${i}`, sku: "A" }] })),
        next: `/sellers/v3/shipments/filter?next_token=${n}`,
      };
    },
    async returnsPage() {
      return { items: [], next: null };
    },
    stats: () => ({ calls: n, retries: 0, tokenRefreshes: 0 }),
  };
  const { d } = deps({ store, flipkart: big });
  assert.equal(await processRun("run-1", d), "failed");
  assert.match(run.failed ?? "", /stops a search at 5,000 results/);
  assert.ok(n <= 246, "it did not carry on past the limit");
});
