"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { buttonClass } from "@/components/ui";
import { formatDate, formatINR, formatNumber } from "@/lib/format";
import { importReport, type ImportResult } from "@/lib/money/import";
import { databaseSink } from "@/lib/money/sink";
import { ReportError } from "@/lib/money/columns";
import { safeError } from "@/lib/redact";
import { createClient } from "@/lib/supabase/client";

type Done = {
  kind: "settled" | "pnl";
  filename: string;
  rows_seen: number;
  rows_added: number;
  rows_dup: number;
  rows_updated: number;
  other_added: number;
  period_from: string | null;
  period_to: string | null;
  total_net: number | null;
  flipkart: Record<string, number | string | null> | null;
  hasWeightColumns: boolean;
};

async function* chunksOf(file: File): AsyncGenerator<Uint8Array> {
  const reader = file.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    yield value;
  }
}

/**
 * Reads the report in this browser (the files are far bigger than a web request can carry), checks its columns,
 * and saves the rows to the database 1,000 at a time. Nothing is saved from a file whose columns are wrong.
 */
export function UploadReport() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done[]>([]);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    setProgress("Opening the file…");
    const supabase = createClient();
    try {
      const csv = /\.csv$/i.test(file.name);
      const result: ImportResult = await importReport(chunksOf(file), file.name, databaseSink(supabase as never), {
        csv,
        onProgress: (p) => setProgress(`Reading ${p.sheet}: ${formatNumber(p.rows)} rows saved`),
      });
      const { data } = await supabase.from("money_uploads" as never).select("*").eq("id", result.uploadId).single();
      const up = (data ?? {}) as Record<string, unknown>;
      setDone((list) => [
        {
          kind: result.kind,
          filename: file.name,
          rows_seen: Number(up.rows_seen ?? result.rowsRead),
          rows_added: Number(up.rows_added ?? 0),
          rows_dup: Number(up.rows_dup ?? 0),
          rows_updated: Number(up.rows_updated ?? 0),
          other_added: Number(up.other_added ?? 0),
          period_from: (up.period_from as string | null) ?? result.finish.from,
          period_to: (up.period_to as string | null) ?? result.finish.to,
          total_net: up.total_net === null || up.total_net === undefined ? result.finish.total : Number(up.total_net),
          flipkart: (result.summary as { flipkart?: Record<string, number | string | null> }).flipkart ?? null,
          hasWeightColumns: result.hasWeightColumns,
        },
        ...list,
      ]);
      router.refresh();
    } catch (e) {
      setError(e instanceof ReportError ? e.message : `The upload stopped: ${safeError(e)}`);
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="sp-card p-4">
        <p className="text-base font-extrabold">Upload report</p>
        <p className="mt-1 text-sm text-muted">
          In Seller Hub go to Payments, then Reports, and download <b>Settled Transactions</b> and the <b>Profit and Loss Report</b> (up to 30 days each).
          Choose the .xlsx file here. The type is detected from its sheets. A report loaded twice, or two reports that overlap, never count a line twice.
        </p>
        <input
          ref={input}
          type="file"
          accept=".xlsx,.csv"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void upload(file);
          }}
        />
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className={buttonClass("primary", "mt-3 w-full sm:w-auto")}>
          {busy ? "Uploading…" : "Choose a file"}
        </button>
        {busy ? (
          <p role="status" className="mt-3 text-sm font-semibold">
            {progress}. Keep this tab open until it finishes: a large report takes a few minutes.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-3 rounded-lg border border-bad/40 bg-bad-soft p-3 text-sm font-semibold text-bad">
            {error}
          </p>
        ) : null}
      </div>

      {done.map((d, i) => (
        <div key={`${d.filename}-${i}`} className="rounded-xl border border-ok/40 bg-ok-soft p-4">
          <p className="text-sm font-extrabold text-ok">
            {d.kind === "settled" ? "Settled Transactions" : "Profit and Loss Report"} uploaded
          </p>
          <p className="mt-0.5 break-all text-xs text-muted">{d.filename}</p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Rows added</dt>
            <dd className="font-bold">{formatNumber(d.rows_added)}</dd>
            <dt className="text-muted">Duplicates skipped</dt>
            <dd className="font-bold">{formatNumber(d.rows_dup)}</dd>
            {d.kind === "pnl" ? (
              <>
                <dt className="text-muted">Orders updated</dt>
                <dd className="font-bold">{formatNumber(d.rows_updated)}</dd>
              </>
            ) : (
              <>
                <dt className="text-muted">Other sheet rows (ads, storage ...)</dt>
                <dd className="font-bold">{formatNumber(d.other_added)}</dd>
              </>
            )}
            <dt className="text-muted">{d.kind === "settled" ? "Settled between" : "Orders received"}</dt>
            <dd className="font-bold">
              {d.period_from && d.period_to ? `${formatDate(d.period_from)} to ${formatDate(d.period_to)}` : "-"}
            </dd>
            <dt className="text-muted">{d.kind === "settled" ? "Total net (orders)" : "Amount settled (orders)"}</dt>
            <dd className="font-bold">{d.total_net === null ? "-" : formatINR(d.total_net)}</dd>
            {d.flipkart && d.kind === "settled" && typeof d.flipkart.flipkart_net === "number" ? (
              <>
                <dt className="text-muted">Seller Hub shows (all sheets)</dt>
                <dd className="font-bold">{formatINR(d.flipkart.flipkart_net)}</dd>
              </>
            ) : null}
            {d.flipkart && d.kind === "pnl" && typeof d.flipkart.bank_settlement === "number" ? (
              <>
                <dt className="text-muted">Seller Hub projected settlement</dt>
                <dd className="font-bold">{formatINR(d.flipkart.bank_settlement)}</dd>
              </>
            ) : null}
          </dl>
          {d.kind === "settled" ? (
            <p className="mt-2 text-xs text-muted">
              The orders total plus the ads, storage, Google ads and other sheets adds up to the figure in Seller Hub.
              {d.hasWeightColumns ? "" : " This report has no weight or slab columns, so the weight overcharge check has nothing to read."}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
