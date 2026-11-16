import assert from "node:assert/strict";
import { test } from "node:test";
import { barRuns, type OrderSyncState, type RunSummary } from "./orders-sync.ts";

function run(kind: RunSummary["kind"], status: RunSummary["status"]): RunSummary {
  return { id: `${kind}-${status}`, kind, status, trigger: "manual", step: 1, parts: 25, pages: 0, coverageFrom: null, createdAt: "2026-11-16T06:00:00Z", finishedAt: null, error: null };
}
const base: OrderSyncState = { latest: null, lastPending: null, lastDaily: null, lastUpcoming: null, backfill: null };

test("an order read running is not shown as a returns read", () => {
  const pending = run("pending", "running");
  const state = { ...base, latest: pending, latestOf: { pending, daily: run("daily", "done") } };
  assert.equal(barRuns(state, "daily").mine?.status, "done");
  assert.equal(barRuns(state, "daily").other?.kind, "pending");
  assert.equal(barRuns(state, "pending").mine?.status, "running");
  assert.equal(barRuns(state, "pending").other, null);
});

test("a failed morning read stays visible after later order reads", () => {
  const state = { ...base, latest: run("pending", "done"), latestOf: { pending: run("pending", "done"), daily: run("daily", "failed") } };
  assert.equal(barRuns(state, "daily").mine?.status, "failed");
  assert.equal(barRuns(state, "daily").other, null);
});

test("without per-kind runs it falls back to the newest run of the same kind", () => {
  assert.equal(barRuns({ ...base, latest: run("daily", "running") }, "daily").mine?.status, "running");
  assert.equal(barRuns({ ...base, latest: run("pending", "done") }, "daily").mine, null);
});
