// Reads a report file and hands its rows, 1,000 at a time, to a sink that saves them. The same code runs in the
// browser (the Upload report button) and in Node (the import script), so what is tested is what the owner uses.
import { headerMapOf, ReportError } from "./columns.ts";
import { isPnlGroupRow, pnlHeaderNames, pnlOrder, readPnlSummary, resolvePnl, type PnlColumns, type PnlOrder, type PnlSummary } from "./pnl.ts";
import {
  isSettledHeader,
  KeyCounter,
  OTHER_SHEET_NAMES,
  OTHER_SHEETS,
  OtherSheetReader,
  readSettledSummary,
  resolveSettled,
  settledLine,
  type OtherLine,
  type SettledColumns,
  type SettledLine,
  type SettledSummary,
} from "./settled.ts";
import { readCsv, readWorkbook, type SheetCells, type SheetRow } from "./xlsx-stream.ts";

export const BATCH_SIZE = 1000;

export type ReportKind = "settled" | "pnl";

export type FinishInfo = { from: string | null; to: string | null; total: number | null; skus_filled: number };

/** Where rows go. In the app this is a set of database calls; in tests it is a fake. */
export type Sink = {
  begin(kind: ReportKind, filename: string): Promise<string>;
  addSettled(upload: string, rows: SettledLine[]): Promise<void>;
  addOther(upload: string, rows: OtherLine[]): Promise<void>;
  addPnl(upload: string, rows: PnlOrder[]): Promise<void>;
  finish(upload: string, summary: Record<string, unknown>): Promise<FinishInfo>;
  fail(upload: string, message: string): Promise<void>;
};

export type Progress = { sheet: string; rows: number };

export type ImportResult = {
  uploadId: string;
  kind: ReportKind;
  finish: FinishInfo;
  summary: Record<string, unknown>;
  rowsRead: number;
  otherRowsRead: number;
  hasWeightColumns: boolean;
};

const WANTED = new Set(["Orders", "Orders P&L", "Summary of report", "Overall Summary", ...OTHER_SHEET_NAMES]);

export async function importReport(
  chunks: AsyncIterable<Uint8Array>,
  filename: string,
  sink: Sink,
  options: { csv?: boolean; onProgress?: (p: Progress) => void } = {},
): Promise<ImportResult> {
  const sheetsSeen = new Set<string>();
  const rows: AsyncGenerator<SheetRow> = options.csv
    ? readCsv(chunks)
    : readWorkbook(chunks, (name) => {
        sheetsSeen.add(name);
        return WANTED.has(name);
      });

  let kind: ReportKind | null = null;
  let upload: string | null = null;

  // settled
  let settledCols: SettledColumns | null = null;
  const keys = new KeyCounter();
  let settledBuf: SettledLine[] = [];
  const otherReaders = new Map<string, OtherSheetReader>();
  let otherBuf: OtherLine[] = [];
  const summaryRows: SheetRow[] = [];
  // pnl
  let pnlGroup: SheetCells | null = null;
  let pnlCols: PnlColumns | null = null;
  let pnlBuf: PnlOrder[] = [];
  const pnlSummaryRows: SheetRow[] = [];

  let headerSearched = 0;
  let rowsRead = 0;
  let otherRowsRead = 0;
  const rowsBySheet: Record<string, number> = {};

  const begin = async (k: ReportKind) => {
    if (upload) return;
    kind = k;
    upload = await sink.begin(k, filename);
  };
  const flushSettled = async () => {
    if (settledBuf.length && upload) await sink.addSettled(upload, settledBuf);
    settledBuf = [];
  };
  const flushOther = async () => {
    if (otherBuf.length && upload) await sink.addOther(upload, otherBuf);
    otherBuf = [];
  };
  const flushPnl = async () => {
    if (pnlBuf.length && upload) await sink.addPnl(upload, pnlBuf);
    pnlBuf = [];
  };

  try {
    for await (const r of rows) {
      const sheet = options.csv ? "CSV" : r.sheet;

      if (sheet === "Summary of report") {
        summaryRows.push(r);
        continue;
      }
      if (sheet === "Overall Summary") {
        pnlSummaryRows.push(r);
        continue;
      }

      const isCsvSettled = options.csv && (settledCols !== null || (pnlCols === null && !pnlGroup && isSettledHeader(r.cells)));
      if (sheet === "Orders" || isCsvSettled) {
        if (!settledCols) {
          if (!isSettledHeader(r.cells)) {
            if (++headerSearched > 8) throw new ReportError('The "Orders" sheet has no header row with "Order item ID" and "Bank Settlement Value" in its first rows. Nothing was imported.');
            continue;
          }
          settledCols = resolveSettled(headerMapOf(r.cells));
          await begin("settled");
          continue;
        }
        const line = settledLine(r.cells, settledCols, keys, r.row);
        if (!line) continue;
        settledBuf.push(line);
        rowsRead++;
        rowsBySheet.Orders = (rowsBySheet.Orders ?? 0) + 1;
        if (settledBuf.length >= BATCH_SIZE) {
          await flushSettled();
          options.onProgress?.({ sheet: "Orders", rows: rowsRead });
        }
        continue;
      }

      if (sheet === "Orders P&L" || (options.csv && (pnlCols !== null || isPnlGroupRow(r.cells)))) {
        if (!pnlCols) {
          if (!pnlGroup) {
            if (isPnlGroupRow(r.cells)) {
              if (options.csv) {
                pnlCols = resolvePnl(r.cells);
                await begin("pnl");
              } else pnlGroup = r.cells;
            } else if (++headerSearched > 8) {
              throw new ReportError('The "Orders P&L" sheet has no header row with "Order Item ID" and "SKU Name". Nothing was imported.');
            }
            continue;
          }
          pnlCols = resolvePnl(pnlHeaderNames(pnlGroup, r.cells));
          await begin("pnl");
          continue;
        }
        const order = pnlOrder(r.cells, pnlCols, r.row);
        if (!order) continue;
        pnlBuf.push(order);
        rowsRead++;
        rowsBySheet["Orders P&L"] = (rowsBySheet["Orders P&L"] ?? 0) + 1;
        if (pnlBuf.length >= BATCH_SIZE) {
          await flushPnl();
          options.onProgress?.({ sheet: "Orders P&L", rows: rowsRead });
        }
        continue;
      }

      if (OTHER_SHEET_NAMES.has(sheet) && !options.csv) {
        if (!upload) {
          // The sheets after Orders are only read once we know this is a settlement report.
          continue;
        }
        let reader = otherReaders.get(sheet);
        if (!reader) {
          const spec = OTHER_SHEETS.find((s) => s.sheet === sheet);
          if (!spec) continue;
          reader = new OtherSheetReader(spec);
          otherReaders.set(sheet, reader);
          await flushSettled();
        }
        const line = reader.read(r);
        if (!line) continue;
        otherBuf.push(line);
        otherRowsRead++;
        rowsBySheet[sheet] = (rowsBySheet[sheet] ?? 0) + 1;
        if (otherBuf.length >= BATCH_SIZE) await flushOther();
      }
    }

    if (!kind || !upload) {
      const names = [...sheetsSeen].slice(0, 12).join(", ");
      throw new ReportError(
        options.csv
          ? "This CSV is not a Settled Transactions or Profit and Loss report (no row with \"Order item ID\" and \"Bank Settlement Value\", or \"Order Item ID\" and \"SKU Name\")."
          : `This file is not a Settled Transactions or Profit and Loss report. Its sheets are: ${names || "none"}. Expected a sheet called "Orders" or "Orders P&L".`,
      );
    }
    await flushSettled();
    await flushOther();
    await flushPnl();

    let summary: Record<string, unknown> = { filename, sheets: rowsBySheet };
    if (kind === "settled") {
      const s: SettledSummary = readSettledSummary(summaryRows.map((x) => x));
      summary = { ...summary, flipkart: s };
    } else {
      const s: PnlSummary = readPnlSummary(pnlSummaryRows);
      summary = { ...summary, flipkart: s };
    }
    const finish = await sink.finish(upload, summary);
    return {
      uploadId: upload,
      kind,
      finish,
      summary,
      rowsRead,
      otherRowsRead,
      hasWeightColumns: settledCols ? settledCols.hasWeight : false,
    };
  } catch (error) {
    if (upload) await sink.fail(upload, error instanceof Error ? error.message : String(error)).catch(() => undefined);
    throw error;
  }
}
