// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import type { FlipkartApi } from "./flipkart.ts";
import { processRun, type RunnerDeps, type RunRow, type RunStore } from "./runner.ts";
import type { NormalizedListing } from "./rules.ts";

/** An in-memory stand-in for the database side of a sync. */
function fakeStore() {
  const run: RunRow & { lease: boolean; failed: string | null; finished: boolean } = {
    id: "run-1",
    status: "queued",
    stage: null,
    skus: [],
    total: 0,
    cursor: 0,
    lease: false,
    failed: null,
    finished: false,
  };
  const saved: NormalizedListing[] = [];
  const totals = { skipped: 0, missing: 0 };
  const events: string[] = [];
  const store: RunStore = {
    async loadRun() {
      return { id: run.id, status: run.status, stage: run.stage, skus: [...run.skus], total: run.total, cursor: run.cursor };
    },
    async acquireLease() {
      if (run.lease) return false;
      run.lease = true;
      return true;
    },
    async renewLease() {},
    async releaseLease() {
      run.lease = false;
      events.push("release");
    },
    async begin(_id, skus) {
      run.status = "running";
      run.stage = "details";
      run.skus = skus;
      run.total = skus.length;
      run.cursor = 0;
      events.push("begin");
    },
    async applyBatch(_id, items, advance, skipped, missing) {
      saved.push(...items);
      run.cursor += advance;
      totals.skipped += skipped;
      totals.missing += missing;
      events.push(`batch:${advance}`);
    },
    async finish() {
      run.finished = true;
      run.status = "done";
      run.lease = false;
      return { ok: true };
    },
    async fail(_id, message) {
      run.failed = message;
      run.status = "failed";
      run.lease = false;
    },
  };
  return { store, run, saved, totals, events };
}

/** A fake Flipkart with `count` SKUs; every 5th one is FBF. */
function fakeFlipkart(count: number, opts: { failAtBatch?: number; secret?: string } = {}) {
  const skus = Array.from({ length: count }, (_, i) => `SKU-${i + 1}`);
  let listCalls = 0;
  let batches = 0;
  const api: FlipkartApi = {
    async listAllSkus() {
      listCalls += 1;
      return { skus, pages: 1 };
    },
    async getListings(requested) {
      batches += 1;
      if (opts.failAtBatch === batches) throw new Error(`Flipkart exploded with ${opts.secret ?? "nothing secret"}`);
      const available: Record<string, unknown> = {};
      for (const sku of requested) {
        const n = Number(sku.split("-")[1]);
        available[sku] = { listing_status: "ACTIVE", fulfillment_profile: n % 5 === 0 ? "FBF" : "NON_FBF", locations: [] };
      }
      return { available, missing: [] };
    },
    stats: () => ({ calls: 0, retries: 0, tokenRefreshes: 0 }),
  };
  return { api, listCalls: () => listCalls, batches: () => batches };
}

function deps(over: Partial<RunnerDeps> & Pick<RunnerDeps, "store" | "flipkart">): RunnerDeps {
  return {
    now: () => 0,
    budgetMs: 100_000,
    chain: async () => {},
    log: () => {},
    scrub: (value) => String(value).replaceAll("hunter2", "[redacted]"),
    ...over,
  };
}

test("a sync reads every SKU in batches of 10, skips FBF, and finishes", async () => {
  const { store, run, saved, totals, events } = fakeStore();
  const fk = fakeFlipkart(25);
  const outcome = await processRun("run-1", deps({ store, flipkart: fk.api }));
  assert.equal(outcome, "done");
  assert.equal(run.finished, true);
  assert.deepEqual(events, ["begin", "batch:10", "batch:10", "batch:5"]);
  assert.equal(saved.length, 20);
  assert.equal(totals.skipped, 5);
  assert.equal(fk.listCalls(), 1);
});

test("runs out of time, hands over, and the next worker carries on from the cursor", async () => {
  const { store, run, saved, events } = fakeStore();
  const fk = fakeFlipkart(45);
  let clock = 0;
  let chained = 0;
  const base = {
    store,
    flipkart: fk.api,
    now: () => clock,
    budgetMs: 100_000,
    chain: async () => {
      chained += 1;
    },
  };
  // Each batch "takes" 60 s, so the budget is gone after two batches.
  const slow: RunnerDeps["flipkart"] = {
    ...fk.api,
    async getListings(requested) {
      clock += 60_000;
      return fk.api.getListings(requested);
    },
  };

  const first = await processRun("run-1", deps({ ...base, flipkart: slow }));
  assert.equal(first, "continued");
  assert.equal(chained, 1);
  assert.equal(run.cursor, 20);
  assert.equal(run.lease, false, "the lease is let go so the next worker can take it");

  clock = 0;
  const second = await processRun("run-1", deps({ ...base, flipkart: slow }));
  assert.equal(second, "continued");
  assert.equal(run.cursor, 40);

  clock = 0;
  const third = await processRun("run-1", deps({ ...base, flipkart: slow }));
  assert.equal(third, "done");
  assert.equal(run.cursor, 45);
  assert.equal(fk.listCalls(), 1, "the SKU list is read once, not again on every hand-over");
  assert.equal(events.filter((e) => e === "begin").length, 1);
  assert.equal(saved.length, 36);
});

test("a worker that is told to continue after a crash starts from the saved cursor", async () => {
  const { store, run } = fakeStore();
  run.status = "running";
  run.stage = "details";
  run.skus = Array.from({ length: 30 }, (_, i) => `SKU-${i + 1}`);
  run.total = 30;
  run.cursor = 20;
  const fk = fakeFlipkart(30);
  const outcome = await processRun("run-1", deps({ store, flipkart: fk.api }));
  assert.equal(outcome, "done");
  assert.equal(fk.listCalls(), 0, "it must not read the list again");
  assert.equal(fk.batches(), 1, "only the 10 SKUs that were left");
});

test("a second worker for the same sync does nothing", async () => {
  const { store, run } = fakeStore();
  run.lease = true;
  const fk = fakeFlipkart(10);
  const outcome = await processRun("run-1", deps({ store, flipkart: fk.api }));
  assert.equal(outcome, "skipped");
  assert.equal(fk.listCalls(), 0);
});

test("a sync that is already finished is left alone", async () => {
  const { store, run } = fakeStore();
  run.status = "done";
  const fk = fakeFlipkart(10);
  assert.equal(await processRun("run-1", deps({ store, flipkart: fk.api })), "skipped");
});

test("missing Flipkart secrets fail the sync with a message that says what to set", async () => {
  const { store, run } = fakeStore();
  const outcome = await processRun("run-1", deps({ store, flipkart: null }));
  assert.equal(outcome, "failed");
  assert.match(run.failed ?? "", /FLIPKART_APP_ID and FLIPKART_APP_SECRET/);
});

test("an error from Flipkart fails the sync and secrets never reach the saved message", async () => {
  const { store, run } = fakeStore();
  const fk = fakeFlipkart(30, { failAtBatch: 2, secret: "hunter2" });
  const outcome = await processRun("run-1", deps({ store, flipkart: fk.api }));
  assert.equal(outcome, "failed");
  assert.match(run.failed ?? "", /Flipkart exploded/);
  assert.ok(!(run.failed ?? "").includes("hunter2"));
});

test("a sync the database refuses to call good is reported as failed", async () => {
  const { store } = fakeStore();
  store.finish = async () => ({ ok: false, error: "Flipkart gave details for only 3 of 10 listings" });
  const fk = fakeFlipkart(10);
  assert.equal(await processRun("run-1", deps({ store, flipkart: fk.api })), "failed");
});
