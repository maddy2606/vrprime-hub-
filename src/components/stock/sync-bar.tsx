"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { useToast } from "@/components/toast";
import { buttonClass } from "@/components/ui";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { redactSecrets } from "@/lib/redact";
import { isRunning, type SyncSummary } from "@/lib/stock-sync";
import { getStockSyncStatus, startStockSync } from "@/server/actions/stock";

type Props = {
  latest: SyncSummary | null;
  lastDone: SyncSummary | null;
  /** The day the numbers on screen are from, and the one they are compared with. */
  snapshotDate: string | null;
  previousDate: string | null;
  canSync: boolean;
};

const POLL_MS = 3000;

/** Says when the numbers are from, shows progress while a sync runs, and has the Sync now button. */
export function SyncBar({ latest: initialLatest, lastDone: initialDone, snapshotDate, previousDate, canSync }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [latest, setLatest] = useState(initialLatest);
  const [lastDone, setLastDone] = useState(initialDone);
  const [pending, startTransition] = useTransition();
  const wasRunning = useRef(isRunning(initialLatest?.status));

  const running = isRunning(latest?.status);

  // While a sync is running, ask how it is getting on. When it ends, reload the numbers.
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(async () => {
      const status = await getStockSyncStatus();
      if (!status) return;
      setLatest(status.latest);
      setLastDone(status.lastDone);
      if (!isRunning(status.latest?.status)) {
        window.clearInterval(timer);
        if (wasRunning.current) {
          wasRunning.current = false;
          if (status.latest?.status === "done") toast.show("Stock is up to date");
          else toast.show("The sync did not finish", "bad");
          router.refresh();
        }
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [running, router, toast]);

  const start = () =>
    startTransition(async () => {
      const result = await startStockSync();
      toast.result(result);
      if (result.ok && result.data) {
        wasRunning.current = true;
        setLatest(result.data.run);
      }
    });

  const failed = latest?.status === "failed" && (!lastDone || latest.createdAt > (lastDone.finishedAt ?? ""));
  const listings = lastDone ? Math.max(0, lastDone.total - lastDone.skippedFbf - lastDone.missing) : 0;
  const progress = latest && latest.total > 0 ? Math.min(100, Math.round((latest.cursor / latest.total) * 100)) : 0;

  return (
    <div className="mb-4 rounded-xl border border-line bg-surface px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-40">
          {running ? (
            <>
              <p className="text-sm font-bold">
                {latest && latest.total > 0
                  ? `Reading Flipkart: ${formatNumber(latest.cursor)} of ${formatNumber(latest.total)} listings`
                  : "Asking Flipkart for the list of products…"}
              </p>
              <div
                className="mt-2 h-2 overflow-hidden rounded-full bg-surface2"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
                aria-label="Sync progress"
              >
                <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress}%` }} />
              </div>
            </>
          ) : lastDone?.finishedAt ? (
            <>
              <p className="text-sm font-bold">Synced {formatDateTime(lastDone.finishedAt)}</p>
              <p className="mt-0.5 text-xs text-muted">
                {formatNumber(listings)} listings
                {lastDone.skippedFbf ? ` · ${formatNumber(lastDone.skippedFbf)} FBF skipped` : " · no FBF listings skipped"}
                {lastDone.missing ? ` · ${formatNumber(lastDone.missing)} without details` : ""}
                {snapshotDate && previousDate ? ` · change is since ${formatDate(previousDate)}` : ""}
                {snapshotDate && !previousDate ? " · no earlier day to compare with yet" : ""}
              </p>
            </>
          ) : (
            <p className="text-sm font-bold">Not synced yet</p>
          )}
        </div>
        {canSync ? (
          <button type="button" onClick={start} disabled={running || pending} className={buttonClass("secondary", "shrink-0")}>
            {running || pending ? "Syncing…" : "Sync now"}
          </button>
        ) : null}
      </div>

      {failed ? (
        <p role="alert" className="mt-3 rounded-lg bg-bad-soft px-3 py-2 text-sm font-semibold text-bad">
          {canSync
            ? `The last sync did not finish${latest?.error ? `: ${redactSecrets(latest.error)}` : "."}`
            : "The last sync did not finish, so these numbers may be out of date. Tell the owner."}
        </p>
      ) : null}
    </div>
  );
}
