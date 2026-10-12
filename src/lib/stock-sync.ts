// What the page shows about the sync itself. Plain values, shared by server and client code.
import type { StockRun } from "@/lib/types";

export type SyncSummary = {
  id: string;
  status: StockRun["status"];
  trigger: StockRun["trigger"];
  /** Listings Flipkart told us about, and how many of them have been looked at so far. */
  total: number;
  cursor: number;
  processed: number;
  skippedFbf: number;
  missing: number;
  snapshotDate: string | null;
  finishedAt: string | null;
  createdAt: string;
  /** What went wrong. Only filled in for people who can run a sync. */
  error: string | null;
};

export const SYNC_COLUMNS =
  "id, status, trigger, total, cursor, processed, skipped_fbf, missing, snapshot_date, finished_at, created_at, error";

export type SyncRow = Pick<
  StockRun,
  "id" | "status" | "trigger" | "total" | "cursor" | "processed" | "skipped_fbf" | "missing" | "snapshot_date" | "finished_at" | "created_at" | "error"
>;

export function toSummary(row: SyncRow, canSeeError: boolean): SyncSummary {
  return {
    id: row.id,
    status: row.status,
    trigger: row.trigger,
    total: row.total,
    cursor: row.cursor,
    processed: row.processed,
    skippedFbf: row.skipped_fbf,
    missing: row.missing,
    snapshotDate: row.snapshot_date,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    error: canSeeError ? row.error : null,
  };
}

export function isRunning(status: SyncSummary["status"] | undefined | null): boolean {
  return status === "queued" || status === "running";
}
