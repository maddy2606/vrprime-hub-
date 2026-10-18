"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { useToast } from "@/components/toast";
import { buttonClass } from "@/components/ui";
import type { CapacitySettings } from "@/lib/capacity";
import { formatINR, formatNumber } from "@/lib/format";
import { matchWarehouse, parseTeamSheet } from "@/lib/team-sheet";
import { importTeamSheet, saveTeamSettings } from "@/server/actions/team";

type Warehouse = { id: string; name: string };

type Preview = {
  fileName: string;
  people: { name: string; warehouseId: string; warehouseName: string; salary: number | null }[];
  marks: { name: string; warehouseId: string; day: string; status: "present" | "half" | "absent" | "leave" }[];
  unmatched: string[];
  unknownMarks: number;
};

/**
 * Owner tools: read the staff sheet and show what it holds before saving anything, and the planning numbers. The sheet is
 * read here in the browser; names and salaries are saved to the database and never leave it.
 */
export function TeamTools({ warehouses, settings }: { warehouses: Warehouse[]; settings: CapacitySettings }) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [low, setLow] = useState(String(settings.low));
  const [high, setHigh] = useState(String(settings.high));
  const [lead, setLead] = useState(String(settings.leadDays));

  const readFile = (file: File | undefined) => {
    if (!file) return;
    startTransition(async () => {
      try {
        const { readSheets } = await import("@/lib/read-table");
        const sheets = await readSheets(file);
        let first: ReturnType<typeof parseTeamSheet> | null = null;
        let chosen: ReturnType<typeof parseTeamSheet> | null = null;
        for (const rows of sheets.values()) {
          const parsed = parseTeamSheet(rows);
          first ??= parsed;
          if (parsed.people.length > 0) {
            chosen = parsed;
            break;
          }
        }
        if (!chosen) {
          toast.show(first?.errors[0] ?? "That file has no sheet with people in it.", "bad");
          return;
        }
        const unmatched = new Set<string>();
        const people: Preview["people"] = [];
        const byCol = new Map<number, { name: string; warehouseId: string }>();
        for (const p of chosen.people) {
          const w = matchWarehouse(p.warehouse, warehouses);
          if (!w) {
            unmatched.add(p.warehouse);
            continue;
          }
          people.push({ name: p.name, warehouseId: w.id, warehouseName: w.name, salary: p.salary });
          byCol.set(p.col, { name: p.name, warehouseId: w.id });
        }
        const marks: Preview["marks"] = chosen.marks.flatMap((m) => {
          const who = byCol.get(m.col);
          return who ? [{ name: who.name, warehouseId: who.warehouseId, day: m.day, status: m.status }] : [];
        });
        setPreview({ fileName: file.name, people, marks, unmatched: [...unmatched], unknownMarks: chosen.unknownMarks });
      } catch {
        toast.show("That file could not be read. Save it as .xlsx and try again.", "bad");
      } finally {
        if (fileRef.current) fileRef.current.value = "";
      }
    });
  };

  const save = () => {
    if (!preview || preview.unmatched.length > 0) return;
    startTransition(async () => {
      const result = await importTeamSheet(
        preview.people.map((p) => ({ name: p.name, warehouseId: p.warehouseId, salary: p.salary })),
        preview.marks,
      );
      if (toast.result(result)) {
        setPreview(null);
        router.refresh();
      }
    });
  };

  const saveSettings = () => {
    startTransition(async () => {
      if (toast.result(await saveTeamSettings(Number(low), Number(high), Number(lead)))) router.refresh();
    });
  };

  const byWarehouse = preview ? Object.entries(Object.groupBy(preview.people, (p) => p.warehouseName)) : [];
  const total = preview ? preview.people.reduce((n, p) => n + (p.salary ?? 0), 0) : 0;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-sm font-bold">Import the staff sheet</h3>
        <p className="mb-3 mt-0.5 text-xs text-muted">
          Adds or updates people, their warehouse and monthly salary, and any attendance marks in the sheet (P, H, A, L). Nobody is removed. &quot;Mumbai&quot; is read as Bhiwandi.
        </p>
        <input ref={fileRef} type="file" accept=".xlsx" className="sr-only" aria-label="Staff Excel sheet" onChange={(e) => readFile(e.target.files?.[0])} />
        <button type="button" disabled={pending} onClick={() => fileRef.current?.click()} className={buttonClass("outline")}>
          Choose the Excel file
        </button>

        {preview ? (
          <div className="mt-4 rounded-xl border border-line p-3" role="status">
            <p className="text-sm font-bold">
              {preview.fileName}: {preview.people.length} people in {byWarehouse.length} warehouses
              {preview.marks.length ? `, ${formatNumber(preview.marks.length)} attendance marks` : ", no attendance marks yet"}
            </p>
            {total > 0 ? <p className="text-xs text-muted">Monthly salaries add up to {formatINR(total)}</p> : null}
            <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
              {byWarehouse.map(([name, list]) => (
                <li key={name}>
                  <span className="font-bold">{name}:</span> <span className="text-muted">{list?.map((p) => p.name).join(", ")}</span>
                </li>
              ))}
            </ul>
            {preview.unmatched.length ? (
              <p className="mt-2 rounded-lg bg-bad-soft px-3 py-2 text-sm font-bold text-bad">
                Nothing can be saved yet: no warehouse called {preview.unmatched.join(", ")} in this app. Rename it in the sheet and choose the file again.
              </p>
            ) : null}
            {preview.unknownMarks ? <p className="mt-2 text-xs text-muted">{preview.unknownMarks} marks were not understood and are skipped. Use P, H, A or L.</p> : null}
            <div className="mt-3 flex gap-2">
              <button type="button" disabled={pending || preview.unmatched.length > 0} onClick={save} className={buttonClass("primary", "px-5")}>
                Save {preview.people.length} people
              </button>
              <button type="button" disabled={pending} onClick={() => setPreview(null)} className={buttonClass("outline")}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <form
        className="border-t border-line-soft pt-5"
        onSubmit={(e) => {
          e.preventDefault();
          saveSettings();
        }}
      >
        <h3 className="text-sm font-bold">Planning numbers</h3>
        <p className="mb-3 mt-0.5 text-xs text-muted">Used for every warehouse. The page counts capacity at the comfortable number and warns when the day goes past it.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm font-bold">
            Orders a person packs comfortably
            <input className="input mt-1" inputMode="numeric" value={low} onChange={(e) => setLow(e.target.value)} />
          </label>
          <label className="text-sm font-bold">
            The most a person can pack
            <input className="input mt-1" inputMode="numeric" value={high} onChange={(e) => setHigh(e.target.value)} />
          </label>
          <label className="text-sm font-bold">
            Days to find a new person
            <input className="input mt-1" inputMode="numeric" value={lead} onChange={(e) => setLead(e.target.value)} />
          </label>
        </div>
        <button type="submit" disabled={pending} className={buttonClass("outline", "mt-3")}>
          Save planning numbers
        </button>
      </form>
    </div>
  );
}
