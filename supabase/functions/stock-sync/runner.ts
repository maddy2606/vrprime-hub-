// The sync itself, with no knowledge of Deno or Supabase: it is given a store (where the
// progress lives) and a Flipkart client, so the tests can run it against fakes.
//
// A sync is a list of SKUs plus a cursor. Each call looks at a few SKUs (10 per Flipkart
// call), saves them together with the new cursor in one database transaction, and carries
// on until it is done or its time budget is used up. When the budget is used up it lets go
// of the run and asks for a fresh invocation to continue from the cursor. If a worker is cut
// off instead, its lease runs out and the database watchdog restarts the run from the cursor.

import { MAX_SKUS_PER_CALL, type FlipkartApi } from "./flipkart.ts";
import { splitBatch, type NormalizedListing } from "./rules.ts";

export type RunRow = {
  id: string;
  status: string;
  stage: string | null;
  skus: string[];
  total: number;
  cursor: number;
};

export interface RunStore {
  loadRun(id: string): Promise<RunRow | null>;
  /** True when this worker now owns the run (nobody else holds a live lease). */
  acquireLease(id: string): Promise<boolean>;
  renewLease(id: string): Promise<void>;
  releaseLease(id: string): Promise<void>;
  /** Saves the SKU list Flipkart gave and moves the run to its details stage. */
  begin(id: string, skus: string[]): Promise<void>;
  /** Saves one batch and moves the cursor on, together. */
  applyBatch(id: string, items: NormalizedListing[], advance: number, skipped: number, missing: number): Promise<void>;
  finish(id: string): Promise<{ ok: boolean; error?: string }>;
  fail(id: string, message: string): Promise<void>;
}

export type RunnerDeps = {
  store: RunStore;
  /** null when the Flipkart secrets are not set. */
  flipkart: FlipkartApi | null;
  now: () => number;
  /** How long this invocation may keep going before handing over. */
  budgetMs: number;
  /** Asks for another invocation to continue this run. Must not throw. */
  chain: (runId: string) => Promise<void>;
  log: (message: string) => void;
  /** Removes secrets from anything that is about to be saved or logged. */
  scrub: (value: unknown) => string;
};

export type RunOutcome = "done" | "failed" | "continued" | "skipped";

export async function processRun(runId: string, deps: RunnerDeps): Promise<RunOutcome> {
  const { store, log } = deps;

  if (!(await store.acquireLease(runId))) {
    log("Another worker already has this sync");
    return "skipped";
  }

  try {
    let run = await store.loadRun(runId);
    if (!run || (run.status !== "queued" && run.status !== "running")) {
      log("This sync is not active any more");
      return "skipped";
    }
    const flipkart = deps.flipkart;
    if (!flipkart) {
      await store.fail(
        runId,
        "Flipkart is not connected yet. Set FLIPKART_APP_ID and FLIPKART_APP_SECRET in Supabase (Edge Functions > Secrets).",
      );
      return "failed";
    }

    if (run.stage !== "details") {
      const { skus, pages } = await flipkart.listAllSkus();
      log(`Flipkart lists ${skus.length} SKUs (${pages} ${pages === 1 ? "page" : "pages"})`);
      await store.begin(runId, skus);
      run = await store.loadRun(runId);
      if (!run) throw new Error("The sync disappeared while it was starting");
    }

    const startedAt = deps.now();
    let cursor = run.cursor;
    while (cursor < run.total) {
      if (deps.now() - startedAt >= deps.budgetMs) {
        log(`Time budget used at ${cursor} of ${run.total}: handing over`);
        await store.releaseLease(runId);
        await deps.chain(runId);
        return "continued";
      }
      const batch = run.skus.slice(cursor, cursor + MAX_SKUS_PER_CALL);
      const { available } = await flipkart.getListings(batch);
      const { items, fbf, missing } = splitBatch(batch, available);
      await store.applyBatch(runId, items, batch.length, fbf, missing);
      cursor += batch.length;
      await store.renewLease(runId);
    }

    const result = await store.finish(runId);
    log(result.ok ? `Sync finished: ${run.total} SKUs` : `Sync rejected: ${result.error ?? "unknown reason"}`);
    return result.ok ? "done" : "failed";
  } catch (error) {
    const message = deps.scrub(error instanceof Error ? error.message : error);
    log(`Sync failed: ${message}`);
    try {
      await store.fail(runId, message);
    } catch (saveError) {
      log(`Could not record the failure: ${deps.scrub(saveError instanceof Error ? saveError.message : saveError)}`);
    }
    return "failed";
  }
}
