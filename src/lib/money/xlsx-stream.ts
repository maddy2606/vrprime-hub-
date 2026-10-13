// Reads an .xlsx file as a stream, one row at a time, without loading it into memory.
//
// Flipkart's settlement reports are big: one sheet can be 1.4 GB of XML (390,000 rows by 76 columns) inside a
// 140 MB file, which no spreadsheet library can open in a browser. So the zip is inflated in small pieces and the
// sheet XML is cut into rows as it arrives.
//
// Pure TypeScript with relative .ts imports so the tests and the Node import script can run it too.
import { Unzip, UnzipInflate } from "fflate";

/** A row: column letter (A, B, ... AA ...) to the cell's text. Empty cells are left out. */
export type SheetCells = Record<string, string>;
export type SheetRow = { sheet: string; row: number; cells: SheetCells };

const ENTITIES: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&amp;": "&" };

export function decodeXml(text: string): string {
  if (!text.includes("&")) return text;
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&(lt|gt|quot|apos|amp);/g, (m) => ENTITIES[m] ?? m);
}

/** Cuts sheet XML into rows as text arrives in pieces. */
export class RowSplitter {
  private buf = "";
  private pending: SheetRow[] = [];
  private readonly sheet: string;
  private readonly shared: string[];
  constructor(sheet: string, shared: string[]) {
    this.sheet = sheet;
    this.shared = shared;
  }

  push(text: string): void {
    this.buf += text;
    let pos = 0;
    for (;;) {
      const start = this.buf.indexOf("<row ", pos);
      if (start < 0) break;
      const end = this.buf.indexOf("</row>", start);
      if (end < 0) {
        // A row may be cut in the middle: keep it for the next piece. (A self-closing empty row has no end tag.)
        const selfClose = this.buf.indexOf("/>", start);
        const open = this.buf.indexOf(">", start);
        if (selfClose >= 0 && selfClose === open - 1) {
          pos = selfClose + 2;
          continue;
        }
        pos = start;
        break;
      }
      this.emit(this.buf.slice(start, end));
      pos = end + 6;
    }
    this.buf = pos > 0 ? this.buf.slice(pos) : this.buf;
    // Nothing but the sheet header can be left before the first row: do not let it grow without end.
    if (this.buf.length > 20_000_000) this.buf = this.buf.slice(-1_000_000);
  }

  take(): SheetRow[] {
    const rows = this.pending;
    this.pending = [];
    return rows;
  }

  private emit(rowXml: string): void {
    const rowNum = Number(/<row [^>]*?\br="(\d+)"/.exec(rowXml)?.[1] ?? 0);
    const cells: SheetCells = {};
    let i = rowXml.indexOf("<c ");
    while (i >= 0) {
      const tagEnd = rowXml.indexOf(">", i);
      if (tagEnd < 0) break;
      const tag = rowXml.slice(i, tagEnd);
      const selfClosed = tag.endsWith("/");
      const ref = /\br="([A-Z]+)\d+"/.exec(tag)?.[1];
      let next: number;
      if (selfClosed) {
        next = rowXml.indexOf("<c ", tagEnd);
      } else {
        const close = rowXml.indexOf("</c>", tagEnd);
        const inner = close < 0 ? rowXml.slice(tagEnd + 1) : rowXml.slice(tagEnd + 1, close);
        next = close < 0 ? -1 : rowXml.indexOf("<c ", close);
        if (ref) {
          const type = /\bt="(\w+)"/.exec(tag)?.[1];
          let value: string | null = null;
          if (type === "inlineStr") {
            const t = inner.indexOf("<t");
            if (t >= 0) {
              const s = inner.indexOf(">", t) + 1;
              const e = inner.indexOf("</t>", s);
              value = decodeXml(inner.slice(s, e < 0 ? undefined : e));
            }
          } else {
            const v = inner.indexOf("<v>");
            if (v >= 0) {
              const e = inner.indexOf("</v>", v);
              const raw = inner.slice(v + 3, e < 0 ? undefined : e);
              value = type === "s" ? (this.shared[Number(raw)] ?? "") : type === "str" ? decodeXml(raw) : raw;
            }
          }
          if (value !== null && value !== "") cells[ref] = value;
        }
      }
      i = next;
    }
    this.pending.push({ sheet: this.sheet, row: rowNum, cells });
  }
}

function sharedStringsOf(xml: string): string[] {
  const out: string[] = [];
  const re = /<si>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const parts = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => decodeXml(x[1]));
    out.push(parts.join(""));
  }
  return out;
}

/**
 * Streams every row of every sheet, in file order. Sheets are named from the workbook; a sheet is only read when
 * `wanted(name)` says so (the others are skipped without being inflated).
 *
 * The zip is fed one input chunk at a time, so a consumer that awaits between rows (for example while saving to
 * the database) also slows the reading down: memory stays flat however big the file is.
 */
export async function* readWorkbook(
  chunks: AsyncIterable<Uint8Array>,
  wanted: (sheetName: string) => boolean = () => true,
): AsyncGenerator<SheetRow> {
  const unzip = new Unzip();
  unzip.register(UnzipInflate);

  const decoder = new TextDecoder("utf-8");
  let workbookXml = "";
  let relsXml = "";
  let sharedXml = "";
  const sheetNameByPath = new Map<string, string>();
  const splitters: RowSplitter[] = [];
  let shared: string[] = [];
  let fatal: Error | null = null;

  const resolveNames = () => {
    sheetNameByPath.clear();
    const target = new Map<string, string>();
    for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
      const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
      const t = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
      if (id && t) target.set(id, t.startsWith("/") ? t.slice(1) : `xl/${t}`);
    }
    for (const m of workbookXml.matchAll(/<sheet\b[^>]*>/g)) {
      const name = /\bname="([^"]*)"/.exec(m[0])?.[1];
      const rid = /\br:id="([^"]+)"/.exec(m[0])?.[1];
      const path = rid ? target.get(rid) : undefined;
      if (name && path) sheetNameByPath.set(path, decodeXml(name));
    }
  };

  unzip.onfile = (file) => {
    const name = file.name;
    const collect = (assign: (text: string) => void) => {
      let text = "";
      file.ondata = (err, data, final) => {
        if (err) {
          fatal = err instanceof Error ? err : new Error(String(err));
          return;
        }
        text += decoder.decode(data, { stream: !final });
        if (final) assign(text);
      };
      file.start();
    };
    if (name === "xl/workbook.xml") collect((t) => ((workbookXml = t), resolveNames()));
    else if (name === "xl/_rels/workbook.xml.rels") collect((t) => ((relsXml = t), resolveNames()));
    else if (name === "xl/sharedStrings.xml") collect((t) => ((sharedXml = t), (shared = sharedStringsOf(sharedXml))));
    else if (/^xl\/worksheets\/[^/]+\.xml$/.test(name)) {
      const sheetName = sheetNameByPath.get(name);
      if (!sheetName) {
        fatal = new Error("This file's sheets could not be named (the workbook index comes after the sheets).");
        return;
      }
      if (!wanted(sheetName)) return;
      const splitter = new RowSplitter(sheetName, shared);
      splitters.push(splitter);
      const piece = new TextDecoder("utf-8");
      file.ondata = (err, data, final) => {
        if (err) {
          fatal = err instanceof Error ? err : new Error(String(err));
          return;
        }
        splitter.push(piece.decode(data, { stream: !final }));
      };
      file.start();
    }
  };

  function* drain(): Generator<SheetRow> {
    if (fatal) throw fatal;
    for (const s of splitters) yield* s.take();
  }

  for await (const chunk of chunks) {
    // A chunk is split so that one chunk never inflates into hundreds of megabytes before it is consumed.
    const STEP = 64 * 1024;
    for (let at = 0; at < chunk.length; at += STEP) {
      unzip.push(chunk.subarray(at, Math.min(at + STEP, chunk.length)), false);
      yield* drain();
    }
  }
  unzip.push(new Uint8Array(0), true);
  yield* drain();
}

// --- CSV ----------------------------------------------------------------------------------------------------------

/** One CSV record as column letters, so CSV and XLSX rows look the same to the importers. */
export function columnLetter(index: number): string {
  let n = index;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export function parseCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Streams a CSV file as rows of one sheet called "CSV". Quoted line breaks are supported. */
export async function* readCsv(chunks: AsyncIterable<Uint8Array>, sheet = "CSV"): AsyncGenerator<SheetRow> {
  const decoder = new TextDecoder("utf-8");
  let buf = "";
  let rowNum = 0;
  let delimiter: string | null = null;
  function* lines(final: boolean): Generator<SheetRow> {
    for (;;) {
      // A record ends at a line break outside quotes.
      let quoted = false;
      let end = -1;
      for (let i = 0; i < buf.length; i++) {
        const ch = buf[i];
        if (ch === '"') quoted = !quoted;
        else if (ch === "\n" && !quoted) {
          end = i;
          break;
        }
      }
      if (end < 0) {
        if (final && buf.trim() !== "") {
          end = buf.length;
        } else return;
      }
      const line = buf.slice(0, end).replace(/\r$/, "");
      buf = buf.slice(end + 1);
      rowNum++;
      if (line.trim() === "") continue;
      if (!delimiter) delimiter = (line.match(/;/g)?.length ?? 0) > (line.match(/,/g)?.length ?? 0) ? ";" : ",";
      const cells: SheetCells = {};
      parseCsvLine(line.replace(/^﻿/, ""), delimiter).forEach((v, i) => {
        if (v !== "") cells[columnLetter(i)] = v;
      });
      yield { sheet, row: rowNum, cells };
    }
  }
  for await (const chunk of chunks) {
    buf += decoder.decode(chunk, { stream: true });
    yield* lines(false);
  }
  buf += decoder.decode();
  yield* lines(true);
}
