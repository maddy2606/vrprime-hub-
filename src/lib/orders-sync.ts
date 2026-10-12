// What the Flipkart page shows about the order syncs. Plain values, shared by server and client code.
import type { OrderRun } from "@/lib/types";

export type RunSummary = {
  id: string;
  kind: OrderRun["kind"];
  status: OrderRun["status"];
  trigger: OrderRun["trigger"];
  step: number;
  /** How many parts the run has (the pending sweep reads each state at each warehouse). */
  parts: number;
  pages: number;
  coverageFrom: string | null;
  createdAt: string;
  finishedAt: string | null;
  /** Only filled in for people who can run a sync. */
  error: string | null;
};

export const RUN_COLUMNS = "id, kind, status, trigger, step, parts, pages, coverage_from, created_at, finished_at, error";

export type RunRowRaw = Pick<OrderRun, "id" | "kind" | "status" | "trigger" | "step" | "parts" | "pages" | "coverage_from" | "created_at" | "finished_at" | "error">;

export function toRun(row: RunRowRaw, canSeeError: boolean): RunSummary {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    trigger: row.trigger,
    step: row.step,
    parts: row.parts,
    pages: row.pages,
    coverageFrom: row.coverage_from,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    error: canSeeError ? row.error : null,
  };
}

/** Working right now (a paused run is waiting for another sync or for the night). */
export function isRunActive(status: RunSummary["status"] | undefined | null): boolean {
  return status === "queued" || status === "running";
}

/** The latest pending sweep, daily or upcoming run, and the last ones that finished. */
export type OrderSyncState = {
  latest: RunSummary | null;
  lastPending: RunSummary | null;
  lastDaily: RunSummary | null;
  /** The last full read of every pending order, however far ahead (nightly). */
  lastUpcoming: RunSummary | null;
  /** The one-time 30-day backfill, if it has been started. */
  backfill: RunSummary | null;
};

