"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { CloseIcon } from "@/components/icons";
import { Caption, InfoTip, SearchField, Toolbar } from "@/components/flipkart/kit";
import { useToast } from "@/components/toast";
import { buttonClass, EmptyState } from "@/components/ui";
import { downloadCsv, toCsv } from "@/lib/csv";
import { formatNumber } from "@/lib/format";
import { masterLookup, parseMasterTable, splitCsv, suggestMaster, type MasterRow } from "@/lib/master-csv";
import type { ActionResult } from "@/lib/types";
import { createMaster, excludeSku, importMasters, linkSku, restoreSku, unlinkSku } from "@/server/actions/masters";
import { uploadMasterSkus } from "@/server/actions/settings";

type Product = { id: string; code: string | null; name: string };
type Link = { sku: string; masterId: string; units: number };

type Props = {
  products: Product[];
  links: Link[];
  removed: string[];
  /** Every Flipkart listing: SKU and title. */
  listings: { sku: string; title: string | null }[];
  /** Units dispatched per SKU over the last 14 days. */
  sold: Record<string, number>;
  /** The owner may replace the whole list (Upload CSV). */
  canReplace: boolean;
};

const label = (p: Product) => (p.code ? `${p.code} — ${p.name}` : p.name);

/** Reads the first sheet of an .xlsx file (or a .csv) as rows of cells. */
async function readTable(file: File): Promise<string[][]> {
  if (!/\.xlsx$/i.test(file.name)) return splitCsv(await file.text());
  const { readWorkbook } = await import("@/lib/money/xlsx-stream");
  async function* chunks(): AsyncGenerator<Uint8Array> {
    const reader = file.stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  }
  const index = (letters: string) => [...letters].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;
  const out: string[][] = [];
  let first: string | null = null;
  for await (const row of readWorkbook(chunks())) {
    first ??= row.sheet;
    if (row.sheet !== first) break;
    const cells: string[] = [];
    for (const [col, text] of Object.entries(row.cells)) cells[index(col)] = text;
    out.push(Array.from(cells, (c) => c ?? ""));
  }
  return out.filter((r) => r.some((c) => c.trim() !== ""));
}

export function MastersTab({ products, links, removed, listings, sold, canReplace }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState("");
  const listId = useId();
  const masterListId = useId();
  const importRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const rows: MasterRow[] = useMemo(
    () => links.flatMap((l) => (byId.get(l.masterId) ? [{ master: byId.get(l.masterId)!.name, sku: l.sku, units: l.units }] : [])),
    [links, byId],
  );
  const lookup = useMemo(() => masterLookup(rows), [rows]);
  const removedSet = useMemo(() => new Set(removed), [removed]);
  const titleOf = useMemo(() => new Map(listings.map((l) => [l.sku, l.title])), [listings]);
  const linksOf = useMemo(() => {
    const m = new Map<string, Link[]>();
    for (const l of links) m.set(l.masterId, [...(m.get(l.masterId) ?? []), l]);
    for (const list of m.values()) list.sort((a, b) => a.sku.localeCompare(b.sku, "en", { sensitivity: "base" }));
    return m;
  }, [links]);
  const notLinked = useMemo(
    () => listings.filter((l) => !lookup(l.sku) && !removedSet.has(l.sku)).sort((a, b) => (sold[b.sku] ?? 0) - (sold[a.sku] ?? 0) || a.sku.localeCompare(b.sku)),
    [listings, lookup, removedSet, sold],
  );
  const byLabel = useMemo(() => new Map(products.flatMap((p) => [[label(p).toLowerCase(), p.id], [p.name.toLowerCase(), p.id], ...(p.code ? [[p.code.toLowerCase(), p.id]] : [])] as [string, string][])), [products]);
  const masterIdOf = (text: string) => byLabel.get(text.trim().toLowerCase()) ?? null;

  const needle = q.trim().toLowerCase();
  const shownProducts = products
    .filter((p) => !needle || `${p.code ?? ""} ${p.name}`.toLowerCase().includes(needle) || (linksOf.get(p.id) ?? []).some((l) => l.sku.toLowerCase().includes(needle)))
    .sort((a, b) => (a.code ?? a.name).localeCompare(b.code ?? b.name, "en", { numeric: true, sensitivity: "base" }));
  const shownNotLinked = needle ? notLinked.filter((l) => `${l.sku} ${l.title ?? ""}`.toLowerCase().includes(needle)) : notLinked;

  const run = (action: () => Promise<ActionResult<unknown>>, after?: () => void) =>
    startTransition(async () => {
      const result = await action();
      if (toast.result(result as ActionResult)) {
        after?.();
        router.refresh();
      }
    });

  const exportCsv = () =>
    downloadCsv(
      "vrprime-master-skus.csv",
      toCsv(
        ["master_code", "master_name", "channel_sku", "units_per_order"],
        [...links]
          .map((l) => ({ l, p: byId.get(l.masterId) }))
          .filter((x) => x.p)
          .sort((a, b) => (a.p!.code ?? a.p!.name).localeCompare(b.p!.code ?? b.p!.name) || a.l.sku.localeCompare(b.l.sku))
          .map(({ l, p }) => [p!.code, p!.name, l.sku, l.units]),
      ),
    );

  const onImport = (file: File | undefined) => {
    if (!file) return;
    startTransition(async () => {
      try {
        const table = await readTable(file);
        const { rows: parsed, errors } = parseMasterTable(table, false);
        if (errors.length) {
          toast.show(`Nothing was imported. ${errors.slice(0, 2).join(" ")}`, "bad");
          return;
        }
        if (toast.result(await importMasters(parsed))) router.refresh();
      } catch {
        toast.show("That file could not be read. Save it as .xlsx or .csv and try again.", "bad");
      } finally {
        if (importRef.current) importRef.current.value = "";
      }
    });
  };

  const onUpload = (file: File | undefined) => {
    if (!file) return;
    if (!window.confirm("Upload CSV REPLACES the whole master SKU list: SKUs not in the file are unlinked. Continue?")) {
      if (uploadRef.current) uploadRef.current.value = "";
      return;
    }
    startTransition(async () => {
      const result = await uploadMasterSkus(await file.text());
      if (toast.result(result)) router.refresh();
      if (uploadRef.current) uploadRef.current.value = "";
    });
  };

  return (
    <>
      <Toolbar>
        <SearchField value={q} onChange={setQ} placeholder="Search Master SKU or Flipkart SKU" />
        <input ref={importRef} type="file" accept=".xlsx,.csv" className="sr-only" aria-label="Master SKU Excel file" onChange={(e) => onImport(e.target.files?.[0])} />
        <button type="button" disabled={pending} onClick={() => importRef.current?.click()} className={buttonClass("secondary")}>
          Import Master SKU Excel
        </button>
        <button type="button" disabled={pending} onClick={exportCsv} className={buttonClass("secondary")}>
          Download CSV
        </button>
        {canReplace ? (
          <>
            <input ref={uploadRef} type="file" accept=".csv" className="sr-only" aria-label="Master SKU CSV to replace the list" onChange={(e) => onUpload(e.target.files?.[0])} />
            <button type="button" disabled={pending} onClick={() => uploadRef.current?.click()} className={buttonClass("secondary")}>
              Upload CSV
            </button>
          </>
        ) : null}
        <InfoTip>
          <b>Import Master SKU Excel</b> (.xlsx or .csv) adds or updates master SKUs from columns master_code and master_name, and links SKUs if the file
          has channel_sku (and units_per_order); nothing is removed. <b>Download CSV</b> gives the list as it is now. <b>Upload CSV</b> (owner) REPLACES the
          whole list with the file: master_name, channel_sku, and optionally units_per_order and master_code.
        </InfoTip>
      </Toolbar>
      <Caption>
        Forecasting combines each master SKU&apos;s Flipkart SKUs. Units per order: a 2pc listing counts 2 (shown ×2). Removed SKUs are left out of the checks.
      </Caption>

      <datalist id={listId}>
        {notLinked.map((l) => (
          <option key={l.sku} value={l.sku}>
            {l.title ?? ""}
          </option>
        ))}
      </datalist>
      <datalist id={masterListId}>
        {products.map((p) => (
          <option key={p.id} value={label(p)} />
        ))}
      </datalist>

      <Section title="Master SKUs and their Flipkart SKUs" count={shownProducts.length}>
        <NewMaster pending={pending} onSave={(code, name, clear) => run(() => createMaster(code, name), clear)} />
        {shownProducts.length === 0 ? (
          <EmptyState title="No master SKU matches" body="Try another part of the code, name or SKU, or clear the search." />
        ) : (
          <ul className="divide-y divide-line">
            {shownProducts.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 py-3 lg:flex-row lg:items-start">
                <div className="min-w-0 lg:w-48 lg:shrink-0">
                  {p.code ? <p className="break-all font-mono text-[13px] font-bold">{p.code}</p> : null}
                  <p className={p.code ? "text-xs text-muted" : "text-sm font-bold"}>{p.name}</p>
                </div>
                <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                  {(linksOf.get(p.id) ?? []).length === 0 ? <span className="text-xs text-muted">No Flipkart SKUs linked</span> : null}
                  {(linksOf.get(p.id) ?? []).map((l) => (
                    <span key={l.sku} className="inline-flex max-w-full items-center gap-1 rounded-full bg-surface2 py-0.5 pl-2.5 pr-1 text-xs font-semibold">
                      <span className="break-all font-mono">{l.sku}</span>
                      {l.units > 1 ? <span className="font-mono text-accent-text">×{l.units}</span> : null}
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => run(() => unlinkSku(l.sku))}
                        aria-label={`Unlink ${l.sku}`}
                        className="focus-ring flex h-6 w-6 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-ink"
                      >
                        <CloseIcon className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
                <AddSku listId={listId} pending={pending} onAdd={(sku, units, clear) => run(() => linkSku(sku, p.id, units), clear)} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Not linked yet" count={shownNotLinked.length}>
        <p className="mb-3 text-xs text-muted">
          Pick the Master SKU (and how many units one order uses), then Save. Suggestions are filled in from similar SKUs; check them before saving. Remove
          takes a SKU out of the checks and this list. These are left out of the product totals until linked (Forecasting lists them under Unmapped).
        </p>
        {shownNotLinked.length === 0 ? (
          <EmptyState title="Every Flipkart SKU is linked" body="Nothing is waiting to be linked, or nothing matches the search." />
        ) : (
          <div className="flex flex-col divide-y divide-line">
            {shownNotLinked.map((l) => (
              <NotLinkedRow
                key={l.sku}
                sku={l.sku}
                title={titleOf.get(l.sku) ?? null}
                sold={sold[l.sku] ?? 0}
                suggestion={(() => {
                  const name = suggestMaster(l.sku, rows);
                  const p = name ? products.find((x) => x.name === name) : undefined;
                  return p ? label(p) : "";
                })()}
                listId={masterListId}
                pending={pending}
                onSave={(text, units) => {
                  const id = masterIdOf(text);
                  if (!id) {
                    toast.show("Pick a master SKU from the list.", "bad");
                    return;
                  }
                  run(() => linkSku(l.sku, id, units));
                }}
                onRemove={() => run(() => excludeSku(l.sku))}
              />
            ))}
          </div>
        )}
      </Section>

      <details className="mb-6 sp-card p-4">
        <summary className="cursor-pointer text-base font-extrabold">
          Removed ({formatNumber(removed.length)}) <span className="text-xs font-semibold text-muted">never checked or listed; click × to put one back under Not linked yet</span>
        </summary>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {removed.length === 0 ? <span className="text-xs text-muted">Nothing removed.</span> : null}
          {removed.map((sku) => (
            <span key={sku} className="inline-flex items-center gap-1 rounded-full bg-surface2 py-0.5 pl-2.5 pr-1 text-xs font-semibold">
              <span className="break-all font-mono">{sku}</span>
              <button type="button" disabled={pending} onClick={() => run(() => restoreSku(sku))} aria-label={`Put ${sku} back`} className="focus-ring flex h-6 w-6 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-ink">
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      </details>
    </>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="mb-6 sp-card p-4">
      <h2 className="mb-3 text-base font-extrabold">
        {title} <span className="font-mono text-sm font-semibold text-muted">({formatNumber(count)})</span>
      </h2>
      {children}
    </section>
  );
}

function AddSku({ listId, pending, onAdd }: { listId: string; pending: boolean; onAdd: (sku: string, units: number, clear: () => void) => void }) {
  const [sku, setSku] = useState("");
  const [units, setUnits] = useState("1");
  const id = useId();
  return (
    <form
      className="flex w-full gap-1.5 lg:w-auto lg:shrink-0"
      onSubmit={(e) => {
        e.preventDefault();
        onAdd(sku, Number(units), () => {
          setSku("");
          setUnits("1");
        });
      }}
    >
      <label htmlFor={`${id}-sku`} className="sr-only">
        Add Flipkart SKU
      </label>
      <input id={`${id}-sku`} list={listId} value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Add Flipkart SKU" className="input min-w-0 flex-1 text-sm lg:w-44 lg:flex-none" autoComplete="off" />
      <label htmlFor={`${id}-units`} className="sr-only">
        Units per order
      </label>
      <input id={`${id}-units`} type="number" min={1} max={1000} step={1} inputMode="numeric" value={units} onChange={(e) => setUnits(e.target.value)} className="input w-16 text-sm" />
      <button type="submit" disabled={pending || !sku.trim()} className={buttonClass("secondary")}>
        Add
      </button>
    </form>
  );
}

function NewMaster({ pending, onSave }: { pending: boolean; onSave: (code: string, name: string, clear: () => void) => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const id = useId();
  return (
    <form
      className="mb-2 flex flex-wrap gap-1.5 border-b border-line pb-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(code, name, () => {
          setCode("");
          setName("");
        });
      }}
    >
      <label htmlFor={`${id}-code`} className="sr-only">
        New master SKU code
      </label>
      <input id={`${id}-code`} value={code} onChange={(e) => setCode(e.target.value)} placeholder="New master SKU code (optional)" className="input min-w-0 basis-full text-sm sm:basis-auto sm:flex-1 sm:max-w-56" autoComplete="off" />
      <label htmlFor={`${id}-name`} className="sr-only">
        New master SKU name
      </label>
      <input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="input min-w-0 basis-full text-sm sm:basis-auto sm:flex-1 sm:max-w-72" autoComplete="off" />
      <button type="submit" disabled={pending || !name.trim()} className={buttonClass("secondary")}>
        Add master SKU
      </button>
    </form>
  );
}

function NotLinkedRow({
  sku,
  title,
  sold,
  suggestion,
  listId,
  pending,
  onSave,
  onRemove,
}: {
  sku: string;
  title: string | null;
  sold: number;
  suggestion: string;
  listId: string;
  pending: boolean;
  onSave: (master: string, units: number) => void;
  onRemove: () => void;
}) {
  const [master, setMaster] = useState(suggestion);
  const [units, setUnits] = useState("1");
  const id = useId();
  return (
    <div className="flex flex-col gap-2 py-3 lg:flex-row lg:items-center">
      <div className="min-w-0 lg:w-36 lg:shrink-0">
        <p className="break-all font-mono text-[13px] font-bold">{sku}</p>
      </div>
      <p className="min-w-0 flex-1 text-sm leading-snug">{title ?? <span className="text-muted">No title</span>}</p>
      <p className="font-mono text-sm tabular-nums lg:w-24 lg:text-right">
        <span className="text-xs text-muted lg:hidden">Sold (14 days) </span>
        {formatNumber(sold)}
      </p>
      <div className="flex flex-wrap gap-1.5 lg:flex-nowrap">
        <label htmlFor={`${id}-m`} className="sr-only">
          Master SKU for {sku}
        </label>
        <input
          id={`${id}-m`}
          list={listId}
          value={master}
          onChange={(e) => setMaster(e.target.value)}
          placeholder="Pick Master SKU"
          className={`input min-w-0 basis-full text-sm sm:basis-auto sm:flex-1 lg:w-56 lg:flex-none ${suggestion && master === suggestion ? "border-accent" : ""}`}
          autoComplete="off"
        />
        <label htmlFor={`${id}-u`} className="sr-only">
          Units per order for {sku}
        </label>
        <input id={`${id}-u`} type="number" min={1} max={1000} step={1} inputMode="numeric" value={units} onChange={(e) => setUnits(e.target.value)} className="input w-16 text-sm" />
        <button type="button" disabled={pending || !master.trim()} onClick={() => onSave(master, Number(units))} className={buttonClass("primary")}>
          Save
        </button>
        <button type="button" disabled={pending} onClick={onRemove} className={buttonClass("secondary")}>
          Remove
        </button>
      </div>
    </div>
  );
}
