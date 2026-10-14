"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { InfoTip } from "@/components/flipkart/kit";
import { useToast } from "@/components/toast";
import { buttonClass } from "@/components/ui";
import { daysBetween } from "@/lib/stock-analysis";
import { formatDate, formatDateTime } from "@/lib/format";
import { isRunActive, type OrderSyncState, type RunSummary } from "@/lib/orders-sync";
import { redactSecrets } from "@/lib/redact";
import { getOrdersSyncStatus, startOrdersSync } from "@/server/actions/orders";

type Props = {
  state: OrderSyncState;
  canSync: boolean;
  /**
   * The Orders tab syncs pending orders (or, on Upcoming, every upcoming order however far ahead);
   * the Returns tab syncs shipped, cancelled and returns.
   */
  kind: "pending" | "daily" | "upcoming";
  today: string;
};

const POLL_MS = 4000;

const TITLE: Record<Props["kind"], string> = {
  pending: "Orders",
  upcoming: "All upcoming orders",
  daily: "Returns and cancellations",
};

const HOW_OFTEN: Record<Props["kind"], string> = {
  pending: "Orders due in the next 2 days are read every 30 minutes from 7 AM to 10 PM.",
  upcoming: "Every pending order, however far ahead, is read each night at 10:30 PM (it takes about half an hour), along with orders in transit.",
  daily: "Shipped orders, cancellations and returns are read every morning at about 9 AM.",
};

/** Says when the numbers are from, shows progress while a sync runs, and has the Sync now button. */
export function OrdersSyncBar({ state: initial, canSync, kind, today }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [state, setState] = useState(initial);
  const [pending, startTransition] = useTransition();
  const wasRunning = useRef(isRunActive(initial.latest?.status));

  const latest = state.latest;
  const running = isRunActive(latest?.status);
  const parts = Math.max(1, latest?.parts ?? 1);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(async () => {
      const next = await getOrdersSyncStatus();
      if (!next) return;
      setState(next);
      if (!isRunActive(next.latest?.status)) {
        window.clearInterval(timer);
        if (wasRunning.current) {
          wasRunning.current = false;
          if (next.latest?.status === "done") toast.show("Orders are up to date");
          else toast.show("The sync did not finish", "bad");
          router.refresh();
        }
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [running, router, toast]);

  const start = () =>
    startTransition(async () => {
      const result = await startOrdersSync(kind);
      toast.result(result);
      if (result.ok && result.data) {
        wasRunning.current = true;
        setState((s) => ({ ...s, latest: result.data?.run ?? s.latest }));
      }
    });

  const last: RunSummary | null = kind === "pending" ? state.lastPending : kind === "upcoming" ? state.lastUpcoming : state.lastDaily;
  const failed = latest?.status === "failed" && (!last || latest.createdAt > (last.finishedAt ?? ""));
  const waiting = latest?.status === "paused";
  const backfill = state.backfill;
  const daysLoaded = backfill?.coverageFrom ? Math.min(30, daysBetween(backfill.coverageFrom, today) + 1) : 0;

  return (
    <div className="mb-4 sp-card px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-40">
          {running ? (
            <>
              <p className="text-sm font-bold">Reading Flipkart: part {Math.min(parts, (latest?.step ?? 0) + 1)} of {parts}…</p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(((latest?.step ?? 0) / parts) * 100)} aria-label="Sync progress">
                <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.round(((latest?.step ?? 0) / parts) * 100)}%` }} />
              </div>
            </>
          ) : last?.finishedAt ? (
            <>
              <div className="flex items-center gap-1">
                <p className="text-sm font-bold">{TITLE[kind]} read {formatDateTime(last.finishedAt)}</p>
                <InfoTip label="How often this is read">
                  {HOW_OFTEN[kind]}
                  {kind === "pending" ? (state.lastUpcoming?.finishedAt ? ` All upcoming orders last read ${formatDateTime(state.lastUpcoming.finishedAt)}.` : " All upcoming orders are read every night at 10:30 PM.") : ""}
                  {waiting ? " A new read is waiting for another sync to finish." : ""}
                </InfoTip>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1">
                <p className="text-sm font-bold">{kind === "upcoming" ? "All upcoming orders not read yet" : "Not read from Flipkart yet"}</p>
                <InfoTip label="How often this is read">{HOW_OFTEN[kind]}</InfoTip>
              </div>
            </>
          )}
        </div>
        {canSync ? (
          <button type="button" onClick={start} disabled={running || pending} className={buttonClass("secondary", "shrink-0")}>
            {running || pending ? "Syncing…" : kind === "upcoming" ? "Read all upcoming" : "Sync now"}
          </button>
        ) : null}
      </div>

      {failed ? (
        <p role="alert" className="mt-3 rounded-lg bg-bad-soft px-3 py-2 text-sm font-semibold text-bad">
          {canSync ? `The last sync did not finish${latest?.error ? `: ${redactSecrets(latest.error)}` : "."}` : "The last sync did not finish, so these numbers may be out of date. Tell the owner."}
        </p>
      ) : null}

      {backfill && backfill.status !== "done" ? (
        <p className="mt-3 rounded-lg bg-info-soft px-3 py-2 text-xs font-semibold text-info">
          {backfill.status === "failed"
            ? `Loading the last 30 days of shipped orders stopped${canSync && backfill.error ? `: ${redactSecrets(backfill.error)}` : ""}. It starts again tonight.`
            : `Loading the last 30 days of shipped orders, one night at a time (after 10:15 PM): ${daysLoaded} of 30 days so far${backfill.coverageFrom ? `, back to ${formatDate(backfill.coverageFrom, today)}` : ""}. Return rates and sales-based "running out soon" use it.`}
        </p>
      ) : null}
      {!backfill ? (
        <p className="mt-3 rounded-lg bg-info-soft px-3 py-2 text-xs font-semibold text-info">
          The last 30 days of shipped orders will load tonight after 10:15 PM. Until then, return rates and sales-based “running out soon” are not shown.
        </p>
      ) : null}
    </div>
  );
}
