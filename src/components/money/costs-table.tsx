"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { useToast } from "@/components/toast";
import { buttonClass } from "@/components/ui";
import { downloadCsv, toCsv } from "@/lib/csv";
import { COST_CSV_HEADERS } from "@/lib/money/costs";
import { deleteCost, importCosts, saveCost } from "@/server/actions/money";

export type CostRow = { sku: string; effective_from: string; purchase_cost: number; packaging_cost: number; freight: number };

type Draft = { sku: string; effective_from: string; purchase_cost: string; packaging_cost: string; freight: string };

const toDraft = (c: CostRow): Draft => ({
  sku: c.sku,
  effective_from: c.effective_from,
  purchase_cost: String(c.purchase_cost),
  packaging_cost: String(c.packaging_cost),
  freight: String(c.freight),
});

const decimal = (v: string) => v.replace(/[^0-9.]/g, "");

function Row({ initial, isNew, today, onDone }: { initial: Draft; isNew: boolean; today: string; onDone: () => void }) {
  const toast = useToast();
  const [d, setD] = useState(initial);
  const [pending, startTransition] = useTransition();
  const dirty = isNew || JSON.stringify(d) !== JSON.stringify(initial);
  const set = (k: keyof Draft, v: string) => setD((x) => ({ ...x, [k]: v }));

  const save = () =>
    startTransition(async () => {
      const result = await saveCost({ ...d, purchase_cost: d.purchase_cost || "0", packaging_cost: d.packaging_cost || "0", freight: d.freight || "0" });
      if (toast.result(result)) onDone();
    });

  const field = "input min-h-10 w-full py-1.5";
  return (
    <li className="rounded-xl border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        {isNew ? (
          <input aria-label="SKU" className={`${field} min-w-40 flex-1 font-mono`} placeholder="SKU" value={d.sku} onChange={(e) => set("sku", e.target.value)} maxLength={120} autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
        ) : (
          <span className="min-w-40 flex-1 break-all font-mono text-sm font-bold">{d.sku !== d.sku.trim() ? `"${d.sku}"` : d.sku}</span>
        )}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="text-xs font-semibold text-muted">
          Purchase (₹)
          <input className={field} inputMode="decimal" value={d.purchase_cost} onChange={(e) => set("purchase_cost", decimal(e.target.value))} />
        </label>
        <label className="text-xs font-semibold text-muted">
          Packaging (₹)
          <input className={field} inputMode="decimal" value={d.packaging_cost} onChange={(e) => set("packaging_cost", decimal(e.target.value))} />
        </label>
        <label className="text-xs font-semibold text-muted">
          Freight (₹, optional)
          <input className={field} inputMode="decimal" value={d.freight} onChange={(e) => set("freight", decimal(e.target.value))} />
        </label>
        <label className="text-xs font-semibold text-muted">
          Effective from
          <input type="date" className={field} value={d.effective_from} max="2100-01-01" onChange={(e) => set("effective_from", e.target.value || today)} disabled={!isNew} />
        </label>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" disabled={pending || !dirty || !d.sku || !d.purchase_cost} onClick={save} className={buttonClass("primary", "min-h-10 px-4")}>
          {pending ? "Saving…" : "Save"}
        </button>
        {!isNew ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (!window.confirm(`Remove the cost of ${d.sku} from ${d.effective_from}?`)) return;
              startTransition(async () => {
                if (toast.result(await deleteCost(d.sku, d.effective_from))) onDone();
              });
            }}
            className={buttonClass("danger", "min-h-10 px-4")}
          >
            Remove
          </button>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Cost per SKU: purchase, packaging and (optional) inbound freight, each from a date. A new cost with a later date
 * leaves earlier orders on the old cost. SKUs that sold but have no cost are listed first.
 */
export function CostsTable({ costs, missing, today }: { costs: CostRow[]; missing: string[]; today: string }) {
  const router = useRouter();
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [pending, startTransition] = useTransition();

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? costs.filter((c) => c.sku.toLowerCase().includes(needle)) : costs;
  }, [costs, q]);
  const refresh = () => {
    setAdding(null);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setAdding("")} className={buttonClass("primary", "min-h-11")}>
          + Add a cost
        </button>
        <button
          type="button"
          onClick={() =>
            downloadCsv(
              "vrprime-sku-costs.csv",
              toCsv(
                COST_CSV_HEADERS,
                costs.map((c) => [c.sku, c.purchase_cost, c.packaging_cost, c.freight, c.effective_from]),
              ),
            )
          }
          className={buttonClass("secondary", "min-h-11")}
        >
          Download CSV
        </button>
        <input
          ref={file}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            startTransition(async () => {
              const result = await importCosts(await f.text());
              if (toast.result(result)) router.refresh();
            });
          }}
        />
        <button type="button" disabled={pending} onClick={() => file.current?.click()} className={buttonClass("secondary", "min-h-11")}>
          {pending ? "Importing…" : "Import CSV"}
        </button>
      </div>
      <p className="text-xs text-muted">
        CSV columns: {COST_CSV_HEADERS.join(", ")}. effective_from can be left empty (today). The whole file is refused if one line is wrong.
      </p>

      {adding !== null ? (
        <ul>
          <Row key={adding} isNew today={today} initial={{ sku: adding, effective_from: today, purchase_cost: "", packaging_cost: "", freight: "" }} onDone={refresh} />
        </ul>
      ) : null}

      {missing.length ? (
        <section aria-label="Cost missing" className="rounded-xl border border-warn/50 bg-warn-soft p-3">
          <p className="text-sm font-extrabold text-warn">Cost missing ({missing.length})</p>
          <p className="mt-0.5 text-xs">These SKUs have sales in the settled reports but no cost, so their profit is not shown. Tap one to add its cost.</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {missing.map((sku) => (
              <button key={sku} type="button" onClick={() => setAdding(sku)} className="focus-ring min-h-9 rounded-full border border-warn/50 bg-surface px-3 font-mono text-xs font-bold">
                {sku}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <div>
        <label htmlFor="cost-search" className="sr-only">
          Search SKU
        </label>
        <input id="cost-search" type="search" className="input mb-2" placeholder="Search SKU" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        {shown.length ? (
          <ul className="flex flex-col gap-2">
            {shown.slice(0, 100).map((c) => (
              <Row key={`${c.sku}|${c.effective_from}`} isNew={false} today={today} initial={toDraft(c)} onDone={refresh} />
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-line bg-surface p-4 text-sm text-muted">{costs.length ? "No SKU matches." : "No costs yet. Add one, or import a CSV."}</p>
        )}
        {shown.length > 100 ? <p className="mt-2 text-xs text-muted">Showing 100 of {shown.length}. Search to narrow the list.</p> : null}
      </div>
    </div>
  );
}
