// The order sync itself, with no knowledge of Deno or Supabase: it is given a store (where the
// progress lives) and a Flipkart client, so the tests can run it against fakes.
//
// A run is a plan (a list of parts: "the APPROVED orders", "shipped orders on 5 Oct", "returns
// created in the last 30 days"...) plus a position: which part, and Flipkart's address for the
// next page of it. Each loop reads one page, saves it together with the new position in one
// database transaction, and carries on until the plan is done or the time budget is used up. Then
// it lets go of the run and asks for a fresh invocation to continue from the saved position. If a
// worker is cut off instead, its lease runs out and the database watchdog restarts the run from
// the saved position. Saving a page twice is harmless (orders are saved by their ID).
//
// Politeness: one run at a time. A run waits while a stock sync (or another order run) is working,
// and the long backfill also waits for the night (22:15 to 06:45 IST).

import type { OrdersApi } from "./flipkart.ts";
import { normalizeReturns, normalizeShipments, readTopic, requestFor, type OrderItemRow, type ReturnRow, type Topic } from "./rules.ts";

export type RunRow = {
  id: string;
  kind: string;
  status: string;
  plan: unknown[];
  step: number;
  next_path: string | null;
  /** notes.history: a run the owner asked for, which may run by day. */
  notes?: Record<string, unknown> | null;
};

export interface OrdersStore {
  loadRun(id: string): Promise<RunRow | null>;
  /** True when this worker now owns the run (nobody else holds a live lease). Wakes a paused run. */
  acquireLease(id: string): Promise<boolean>;
  renewLease(id: string): Promise<void>;
  releaseLease(id: string): Promise<void>;
  /** Saves one page and moves the run's position on, together. `next` null means this part is finished. */
  applyPage(id: string, step: number, items: OrderItemRow[], returns: ReturnRow[], next: string | null, seen: number): Promise<void>;
  finish(id: string): Promise<{ ok: boolean; error?: string }>;
  fail(id: string, message: string): Promise<void>;
  /** Sets the run aside, to be woken by the watchdog. */
  pause(id: string, message: string): Promise<void>;
  /** A stock sync, or another order run, is working right now. */
  otherSyncActive(id: string): Promise<boolean>;
}

export type RunnerDeps = {
  store: OrdersStore;
  /** null when the Flipkart secrets are not set. */
  flipkart: OrdersApi | null;
  now: () => number;
  /** How long this invocation may keep going before handing over. */
  budgetMs: number;
  /** Asks for another invocation to continue this run. Must not throw. */
  chain: (runId: string) => Promise<void>;
  /** True inside the nightly window. */
  isNight: () => boolean;
  log: (message: string) => void;
  /** Removes secrets from anything that is about to be saved or logged. */
  scrub: (value: unknown) => string;
};

export type RunOutcome = "done" | "failed" | "continued" | "paused" | "skipped";

/** Flipkart's own limit is 5,000 results per search; stop a little before it. */
export const RESULT_CAP_WARNING = 4900;

const NOT_RUNNING = /run is not running|run is at step/;

export async function processRun(runId: string, deps: RunnerDeps): Promise<RunOutcome> {
  const { store, log } = deps;

  if (!(await store.acquireLease(runId))) {
    log("Another worker already has this run");
    return "skipped";
  }

  let kind = "";
  try {
    const run = await store.loadRun(runId);
    if (!run || run.status === "done" || run.status === "failed") {
      log("This run is not active any more");
      return "skipped";
    }
    kind = run.kind;
    const flipkart = deps.flipkart;
    if (!flipkart) {
      await store.fail(runId, "Flipkart is not connected yet. Set FLIPKART_APP_ID and FLIPKART_APP_SECRET in Supabase (Edge Functions > Secrets).");
      return "failed";
    }

    const startedAt = deps.now();
    let step = run.step;
    let next = run.next_path;
    let lastPage = "";
    let readInPart = 0;

    while (step < run.plan.length) {
      if (run.kind === "backfill" && !run.notes?.history && !deps.isNight()) {
        log("The backfill only runs at night: going back to sleep");
        await store.pause(runId, "Waiting for the night (22:15 to 06:45 IST)");
        return "paused";
      }
      if (await store.otherSyncActive(runId)) {
        log("A stock sync or another order run is working: waiting");
        await store.pause(runId, "Waiting for another sync to finish");
        return "paused";
      }
      if (deps.now() - startedAt >= deps.budgetMs) {
        log(`Time budget used at part ${step + 1} of ${run.plan.length}: handing over`);
        await store.releaseLease(runId);
        await deps.chain(runId);
        return "continued";
      }

      const topic = readTopic(run.plan[step]);
      if (!topic) throw new Error(`Part ${step + 1} of the plan could not be read`);
      const page = await readPage(flipkart, topic, next);
      // Flipkart handing back the page it just gave means the paging is not advancing: stop rather than loop.
      if (next !== null && page.signature !== "" && page.signature === lastPage) {
        throw new Error("Flipkart returned the same page twice: the next-page address did not advance");
      }
      lastPage = page.signature;
      // Flipkart stops any search at 5,000 results without saying so. A part that gets near that is cut short,
      // so the run stops instead of treating a partial list as complete.
      readInPart += page.seen;
      if (readInPart >= RESULT_CAP_WARNING) {
        throw new Error(`Flipkart stops a search at 5,000 results and this part reached ${readInPart}: the date window needs to be narrower`);
      }
      await store.applyPage(runId, step, page.items, page.returns, page.next, page.seen);
      if (page.next === null) {
        step += 1;
        next = null;
        lastPage = "";
        readInPart = 0;
      } else {
        next = page.next;
      }
      await store.renewLease(runId);
    }

    const result = await store.finish(runId);
    log(result.ok ? `Run finished: ${run.plan.length} parts` : `Run rejected: ${result.error ?? "unknown reason"}`);
    return result.ok ? "done" : "failed";
  } catch (error) {
    const message = deps.scrub(error instanceof Error ? error.message : error);
    if (NOT_RUNNING.test(message)) {
      // A manual run took over, or somebody stopped this one: nothing to do.
      log("This run was paused or stopped while it was working");
      return "skipped";
    }
    log(`Run failed: ${message}`);
    try {
      // The long backfill is patient: it pauses on an error and the watchdog tries again a few times.
      if (kind === "backfill") await store.pause(runId, message);
      else await store.fail(runId, message);
    } catch (saveError) {
      log(`Could not record the failure: ${deps.scrub(saveError instanceof Error ? saveError.message : saveError)}`);
    }
    return kind === "backfill" ? "paused" : "failed";
  }
}

async function readPage(
  flipkart: OrdersApi,
  topic: Topic,
  next: string | null,
): Promise<{ items: OrderItemRow[]; returns: ReturnRow[]; next: string | null; seen: number; signature: string }> {
  const what = requestFor(topic);
  if (what.kind === "shipments") {
    const page = await flipkart.shipmentsPage(what.request, next);
    const { items, seen } = normalizeShipments(page.shipments);
    return { items, returns: [], next: page.next, seen, signature: signatureOf(items.map((i) => i.order_item_id)) };
  }
  const page = await flipkart.returnsPage(what.request, next);
  const returns = normalizeReturns(page.items);
  return { items: [], returns, next: page.next, seen: page.items.length, signature: signatureOf(returns.map((r) => `${r.return_id}/${r.order_item_id}`)) };
}

/** What a page contained, for noticing a page repeated: its first and last IDs and its size. */
function signatureOf(ids: string[]): string {
  return ids.length ? `${ids[0]}|${ids[ids.length - 1]}|${ids.length}` : "";
}
