"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { useToast } from "@/components/toast";
import { buttonClass } from "@/components/ui";
import { formatNumber } from "@/lib/format";
import { uploadMasterSkus, type MasterUploadResult } from "@/server/actions/settings";

/** Owner only: replace the master product mapping from a CSV (master_name, channel_sku). */
export function MasterSkuUpload({ products, skus }: { products: number; skus: number }) {
  const id = useId();
  const router = useRouter();
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<MasterUploadResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const upload = () =>
    startTransition(async () => {
      if (!file) return;
      setProblem(null);
      setResult(null);
      const outcome = await uploadMasterSkus(await file.text());
      toast.result(outcome);
      if (outcome.ok && outcome.data) {
        setResult(outcome.data);
        router.refresh();
      } else if (!outcome.ok) setProblem(outcome.message);
    });

  return (
    <div className="mb-6 sp-card p-4">
      <p className="text-base font-extrabold">Master SKU list</p>
      <p className="mt-1 text-sm text-muted">
        Groups channel SKUs under one product for the Forecasting tab. Now: {formatNumber(products)} products, {formatNumber(skus)} SKUs. Upload a CSV with the
        columns <span className="font-mono">master_name</span> and <span className="font-mono">channel_sku</span>; it <b>replaces</b> the whole list (SKUs not
        in the file are removed). SKUs are kept exactly as written; each SKU can belong to one product only.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="sr-only">
          Master SKU CSV file
        </label>
        <input
          id={id}
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setResult(null);
            setProblem(null);
          }}
          className="min-w-0 max-w-full text-sm text-muted file:mr-3 file:min-h-11 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:text-sm file:font-bold file:text-ink"
        />
        <button type="button" disabled={!file || pending} onClick={upload} className={buttonClass("primary")}>
          {pending ? "Uploading…" : "Upload master SKU list"}
        </button>
      </div>
      {result ? (
        <p role="status" className="mt-3 rounded-lg bg-ok-soft px-3 py-2 text-sm font-semibold text-ok">
          Replaced from {formatNumber(result.rows)} rows: {formatNumber(result.added)} added, {formatNumber(result.changed)} changed (moved to another product),{" "}
          {formatNumber(result.removed)} removed, {formatNumber(result.unchanged)} unchanged. {formatNumber(result.products)} products now.
        </p>
      ) : null}
      {problem ? (
        <p role="alert" className="mt-3 rounded-lg bg-bad-soft px-3 py-2 text-sm font-semibold text-bad">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
