"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { CheckIcon, PlusIcon, ReceiptIcon, RefreshIcon } from "@/components/icons";
import { Sheet } from "@/components/shell/sheet";
import { Bar } from "@/components/signal/charts";
import { useToast } from "@/components/toast";
import { buttonClass, Chip } from "@/components/ui";
import { counts, EXPENSE_CATEGORIES, monthSummary } from "@/lib/expenses";
import { formatINR, formatNumber } from "@/lib/format";
import { addExpense, chooseExpenseGroup, deleteExpense, saveScreenshotReading, updateExpense } from "@/server/actions/expenses";

export type ExpenseRow = {
  id: string;
  spentAt: string;
  sender: string | null;
  reason: string | null;
  category: string;
  amount: number | null;
  amountFrom: "typed" | "screenshot" | "note" | null;
  textAmount: number | null;
  readAmount: number | null;
  paidTo: string | null;
  reference: string | null;
  status: "new" | "checked" | "ignored";
  /** pending: not read yet; payment: a "payment done" screenshot (counts); not_payment: a QR, a bill, a photo (does not). */
  verdict: "pending" | "payment" | "not_payment";
  manual: boolean;
  readDone: boolean;
  isPdf: boolean;
  thumbUrl: string | null;
  imageUrl: string | null;
};
export type MonthTotal = { month: string; label: string; total: number; count: number };
export type WhatsAppState = {
  linkedAs: string | null;
  groupId: string | null;
  groupName: string | null;
  groups: { id: string; name: string }[];
  lastFetchAt: string | null;
  lastResult: string | null;
  lastError: string | null;
};

const rupees = (n: number | null) => (n === null ? "—" : formatINR(n));
const time = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
const dayHead = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" });
const istDay = (iso: string) => new Date(Date.parse(iso) + 5.5 * 3_600_000).toISOString().slice(0, 10);
const FROM_LABEL: Record<string, string> = { typed: "typed", screenshot: "from screenshot", note: "from note" };

function ago(iso: string | null): string {
  if (!iso) return "never";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.floor(h / 24)} days ago`;
}

// ---- WhatsApp: link, fetch, unlink ---------------------------------------------------------------------------------------

type LinkEvent = { type: "qr"; svg: string } | { type: "status"; text: string } | { type: "linked"; name: string } | { type: "done"; text: string } | { type: "error"; text: string };

function LinkSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [qr, setQr] = useState<string | null>(null);
  const [lines, setLines] = useState<{ tone: "ok" | "bad" | "muted"; text: string }[]>([]);
  const [running, setRunning] = useState(false);

  const start = async () => {
    setRunning(true);
    setQr(null);
    setLines([{ tone: "muted", text: "Asking WhatsApp for a QR code…" }]);
    try {
      const res = await fetch("/api/whatsapp/link", { method: "POST" });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { text?: string } | null;
        setLines((l) => [...l, { tone: "bad", text: body?.text ?? "Could not start the link." }]);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl = buffer.indexOf("\n");
        while (nl >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          nl = buffer.indexOf("\n");
          if (!line) continue;
          const e = JSON.parse(line) as LinkEvent;
          if (e.type === "qr") setQr(e.svg);
          else {
            if (e.type !== "status") setQr(null);
            setLines((l) => [...l, { tone: e.type === "error" ? "bad" : e.type === "status" ? "muted" : "ok", text: e.type === "linked" ? `Linked as ${e.name}.` : e.text }]);
          }
        }
      }
    } catch {
      setLines((l) => [...l, { tone: "bad", text: "The connection to the site dropped. Press Link WhatsApp to try again." }]);
    } finally {
      setRunning(false);
      router.refresh();
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Link WhatsApp" subtitle="Like opening WhatsApp Web: scan once, then the site can read the expenses group.">
      <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-muted">
        <li>On the phone, open WhatsApp, then Settings (or the three dots), then Linked devices.</li>
        <li>Tap Link a device and scan the code below.</li>
        <li>Keep this open until it says it is linked; it then reads the group&apos;s recent messages.</li>
      </ol>
      <div className="flex min-h-[17rem] items-center justify-center rounded-2xl border border-line bg-white p-3">
        {qr ? (
          // The QR is an SVG made on the server from WhatsApp's pairing code.
          <div aria-label="WhatsApp link QR code" role="img" className="h-64 w-64 [&_svg]:h-full [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: qr }} />
        ) : (
          <p className="max-w-[14rem] text-center text-sm text-neutral-600">{running ? "Waiting for WhatsApp…" : "Press Show QR code to start."}</p>
        )}
      </div>
      <ul className="mt-3 flex flex-col gap-1 text-sm" aria-live="polite">
        {lines.map((l, i) => (
          <li key={i} className={l.tone === "bad" ? "font-semibold text-bad" : l.tone === "ok" ? "font-semibold text-ok" : "text-muted"}>
            {l.text}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex gap-2">
        <button type="button" disabled={running} onClick={start} className={buttonClass("primary", "flex-1")}>
          {running ? "Linking…" : "Show QR code"}
        </button>
        <button type="button" onClick={onClose} className={buttonClass("secondary")}>
          Close
        </button>
      </div>
      <p className="mt-3 text-xs text-muted">
        The site only reads the expenses group. It never sends messages, never marks anything read and never shows you online. WhatsApp does not officially support this,
        so there is a small risk to the linked number. You can unlink it any time here or from Linked devices on the phone.
      </p>
    </Sheet>
  );
}

function WhatsAppBar({ wa }: { wa: WhatsAppState }) {
  const router = useRouter();
  const toast = useToast();
  const [linking, setLinking] = useState(false);
  const [busy, setBusy] = useState<"fetch" | "unlink" | null>(null);
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState("");

  const call = async (what: "fetch" | "unlink") => {
    if (what === "unlink" && !window.confirm("Unlink WhatsApp from the site? Expenses already saved stay.")) return;
    setBusy(what);
    try {
      const res = await fetch(`/api/whatsapp/${what}`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; text?: string } | null;
      toast.result({ ok: Boolean(body?.ok), message: body?.text ?? "Something went wrong. Try again." });
    } catch {
      toast.result({ ok: false, message: "Could not reach the site. Check the connection and try again." });
    } finally {
      setBusy(null);
      router.refresh();
    }
  };

  const linked = Boolean(wa.linkedAs);
  return (
    <section className="sp-card mb-5 p-4 sm:p-5" aria-label="WhatsApp">
      <div className="flex flex-wrap items-center gap-3">
        <span aria-hidden="true" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${linked ? "bg-ok-soft text-ok" : "bg-surface2 text-muted"}`}>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
            <path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3zm0 16.4a7.4 7.4 0 0 1-3.8-1l-.3-.2-2.7.7.7-2.6-.2-.3A7.4 7.4 0 1 1 12 19.4zm4.1-5.5c-.2-.1-1.3-.7-1.5-.7s-.4-.1-.5.1-.6.7-.7.9-.3.2-.5.1a6 6 0 0 1-3-2.6c-.2-.4.2-.4.6-1.2.1-.1 0-.3 0-.4l-.7-1.6c-.2-.4-.4-.4-.5-.4h-.4a.8.8 0 0 0-.6.3 2.5 2.5 0 0 0-.8 1.9 4.4 4.4 0 0 0 .9 2.3 10 10 0 0 0 3.8 3.4c1.4.6 2 .7 2.7.6a2.3 2.3 0 0 0 1.5-1.1 1.9 1.9 0 0 0 .1-1.1c0-.1-.2-.2-.4-.3z" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">
            {linked ? (wa.groupName ? `Reading "${wa.groupName}"` : "Linked, but the expenses group is not chosen") : "WhatsApp is not linked yet"}
          </p>
          <p className="truncate text-xs text-muted">
            {linked ? `Linked as ${wa.linkedAs} · last fetched ${ago(wa.lastFetchAt)}${wa.lastResult ? ` · ${wa.lastResult}` : ""}` : "Link once with a QR code, then press Fetch whenever you want the latest expenses."}
          </p>
          {wa.lastError ? <p className="mt-0.5 text-xs font-semibold text-bad">{wa.lastError}</p> : null}
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          {linked && wa.groupId ? (
            <button type="button" disabled={busy !== null} onClick={() => call("fetch")} className={buttonClass("primary", "w-full sm:w-auto")}>
              <RefreshIcon className={`h-4 w-4 ${busy === "fetch" ? "animate-spin" : ""}`} />
              {busy === "fetch" ? "Fetching… (up to a minute)" : "Fetch from WhatsApp"}
            </button>
          ) : null}
          {!linked ? (
            <button type="button" onClick={() => setLinking(true)} className={buttonClass("primary", "flex-1 sm:flex-none")}>
              Link WhatsApp
            </button>
          ) : (
            <>
              <button type="button" onClick={() => setLinking(true)} className={buttonClass("secondary")}>
                Link again
              </button>
              <button type="button" disabled={busy !== null} onClick={() => call("unlink")} className={buttonClass("ghost")}>
                {busy === "unlink" ? "Unlinking…" : "Unlink"}
              </button>
            </>
          )}
        </div>
      </div>
      {linked && !wa.groupId && wa.groups.length ? (
        <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-line pt-4">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-semibold">
            Which group has the expenses?
            <select className="input" value={picked} onChange={(e) => setPicked(e.target.value)}>
              <option value="">Choose a group…</option>
              {wa.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!picked || pending}
            onClick={() =>
              startTransition(async () => {
                if (toast.result(await chooseExpenseGroup(picked))) router.refresh();
              })
            }
            className={buttonClass("primary")}
          >
            Use this group
          </button>
        </div>
      ) : null}
      <LinkSheet open={linking} onClose={() => setLinking(false)} />
    </section>
  );
}

// ---- Reading the screenshots (in this browser, free) ---------------------------------------------------------------------

/** Reads the amount, payee and UPI reference from screenshots not read yet, a few at a time, then refreshes the page. */
function ScreenshotReader({ rows }: { rows: ExpenseRow[] }) {
  const router = useRouter();
  const todo = rows.filter((r) => r.verdict === "pending" && r.imageUrl && !r.isPdf);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const started = useRef(false);
  const key = todo.map((r) => r.id).join(",");

  useEffect(() => {
    if (!key || started.current) return;
    started.current = true;
    const list = key.split(",").map((id) => rows.find((r) => r.id === id)!).filter(Boolean);
    let cancelled = false;
    (async () => {
      setProgress({ done: 0, total: list.length });
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng");
      try {
        for (let i = 0; i < list.length && !cancelled; i++) {
          const r = list[i];
          try {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.src = r.imageUrl!;
            await img.decode();
            const canvas = document.createElement("canvas");
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            canvas.getContext("2d")!.drawImage(img, 0, 0);
            const { data } = await worker.recognize(canvas);
            await saveScreenshotReading(r.id, data.text ?? "");
          } catch {
            // One unreadable screenshot does not stop the rest; it is tried again next time.
          }
          setProgress({ done: i + 1, total: list.length });
        }
      } finally {
        await worker.terminate();
        if (!cancelled) router.refresh();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, rows, router]);

  if (!progress || progress.done >= progress.total) return null;
  return (
    <p role="status" className="mb-4 flex items-center gap-2 rounded-xl bg-accent-soft px-3 py-2 text-sm font-semibold text-accent-text">
      <RefreshIcon className="h-4 w-4 animate-spin" />
      Reading amounts from screenshots: {progress.done} of {progress.total}
    </p>
  );
}

// ---- Editing -------------------------------------------------------------------------------------------------------------

function EditSheet({ row, onClose }: { row: ExpenseRow | null; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Other");
  const [reason, setReason] = useState("");
  const [prevId, setPrevId] = useState<string | null>(null);
  if (row && row.id !== prevId) {
    setPrevId(row.id);
    setAmount(row.amount === null ? "" : String(row.amount));
    setCategory(row.category);
    setReason(row.reason ?? "");
  }
  if (!row) return null;

  const run = (input: Record<string, unknown>) =>
    startTransition(async () => {
      if (toast.result(await updateExpense({ id: row.id, ...input }))) {
        router.refresh();
        onClose();
      }
    });
  const save = () => {
    const n = amount.trim() === "" ? null : Number(amount.replace(/,/g, ""));
    if (n !== null && (!Number.isFinite(n) || n < 0)) {
      toast.result({ ok: false, message: "The amount should be a number." });
      return;
    }
    run({ amount: n, category, reason, status: "checked", verdict: "payment" });
  };

  return (
    <Sheet open={Boolean(row)} onClose={onClose} title="Expense" subtitle={`${dayHead.format(new Date(row.spentAt))}, ${time.format(new Date(row.spentAt))}${row.sender ? ` · ${row.sender}` : ""}`}>
      {row.verdict !== "payment" ? (
        <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-sm font-semibold text-warn">
          {row.verdict === "pending"
            ? "This screenshot has not been read yet, so it does not count yet."
            : "This does not look like a payment done screenshot (it may be a QR code, a bill or a photo), so it does not count. If it is a payment, fill in the amount and press Count it and save."}
        </p>
      ) : null}
      {row.imageUrl && !row.isPdf ? (
        <a href={row.imageUrl} target="_blank" rel="noreferrer" className="mb-4 block" aria-label="Open the screenshot full size">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={row.imageUrl} alt="Payment screenshot" className="max-h-[55vh] w-full rounded-xl border border-line bg-surface2 object-contain" />
        </a>
      ) : null}
      {row.isPdf && row.imageUrl ? (
        <a href={row.imageUrl} target="_blank" rel="noreferrer" className={buttonClass("secondary", "mb-4 w-full")}>
          Open the PDF
        </a>
      ) : null}
      <div className="grid gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Amount (₹)
          <input className="input font-mono" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1250" />
          <span className="text-xs font-normal text-muted">
            {row.readAmount !== null ? `Screenshot says ${rupees(row.readAmount)}. ` : ""}
            {row.textAmount !== null ? `Note says ${rupees(row.textAmount)}.` : ""}
            {row.paidTo ? ` Paid to ${row.paidTo}.` : ""}
            {row.reference ? ` UPI ref ${row.reference}.` : ""}
          </span>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Type
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          What it was for
          <textarea className="input min-h-20" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={save} className={buttonClass("primary", "flex-1")}>
          <CheckIcon className="h-4 w-4" />
          {row.verdict === "payment" && row.status !== "ignored" ? "Save and mark checked" : "Count it and save"}
        </button>
        {row.verdict === "payment" && row.status !== "ignored" ? (
          <button type="button" disabled={pending} onClick={() => run({ verdict: "not_payment", status: "new" })} className={buttonClass("secondary")}>
            Not a payment
          </button>
        ) : null}
        {row.manual ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                if (window.confirm("Delete this expense?") && toast.result(await deleteExpense(row.id))) {
                  router.refresh();
                  onClose();
                }
              })
            }
            className={buttonClass("danger")}
          >
            Delete
          </button>
        ) : null}
      </div>
    </Sheet>
  );
}

function AddSheet({ open, onClose, today }: { open: boolean; onClose: () => void; today: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [day, setDay] = useState(today);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<string>("Other");
  const [reason, setReason] = useState("");
  return (
    <Sheet open={open} onClose={onClose} title="Add an expense" subtitle="For one that is not in the WhatsApp group, like cash.">
      <div className="grid gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Date
          <input className="input" type="date" max={today} value={day} onChange={(e) => setDay(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Amount (₹)
          <input className="input font-mono" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="500" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Type
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          What it was for
          <textarea className="input min-h-20" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Tempo to Bhiwandi" />
        </label>
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            if (toast.result(await addExpense({ day, amount: Number(amount.replace(/,/g, "")), category, reason }))) {
              setAmount("");
              setReason("");
              router.refresh();
              onClose();
            }
          })
        }
        className={buttonClass("primary", "mt-4 w-full")}
      >
        <PlusIcon className="h-4 w-4" />
        Add expense
      </button>
    </Sheet>
  );
}

// ---- The page ------------------------------------------------------------------------------------------------------------

function downloadCsv(month: string, rows: ExpenseRow[]) {
  const q = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [["Date", "Time", "Amount", "Type", "What it was for", "Paid to", "UPI reference", "Sent by", "Status", "Amount from"].join(",")];
  for (const r of [...rows].sort((a, b) => a.spentAt.localeCompare(b.spentAt))) {
    lines.push([istDay(r.spentAt), time.format(new Date(r.spentAt)), r.amount ?? "", r.category, r.reason, r.paidTo, r.reference, r.sender, r.status, r.amountFrom].map(q).join(","));
  }
  const blob = new Blob([`﻿${lines.join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `vrprime-expenses-${month}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function ExpensesBoard({ month, months, previous, expenses, whatsapp, today }: { month: string; months: MonthTotal[]; previous: MonthTotal | null; expenses: ExpenseRow[]; whatsapp: WhatsAppState; today: string }) {
  const [editing, setEditing] = useState<ExpenseRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [show, setShow] = useState<"payments" | "check" | "reading" | "not">("payments");
  // Only "payment done" screenshots (and ones added by hand) count; a QR code, a bill or a photo never does.
  const counted = expenses.filter(counts);
  const reading = expenses.filter((e) => e.verdict === "pending" && e.status !== "ignored");
  const notCounted = expenses.filter((e) => !counts(e) && !(e.verdict === "pending" && e.status !== "ignored"));
  const s = monthSummary(counted.map((e) => ({ amount: e.amount, category: e.category, status: e.status })));
  const label = months.find((m) => m.month === month)?.label ?? month;
  const change = previous && previous.total > 0 ? Math.round(((s.total - previous.total) / previous.total) * 100) : null;
  const top = s.byCategory[0];
  const maxCat = Math.max(1, ...s.byCategory.map((c) => c.total));
  const shown = show === "payments" ? counted : show === "check" ? counted.filter((e) => e.status === "new") : show === "reading" ? reading : notCounted;
  const days = new Map<string, ExpenseRow[]>();
  for (const e of shown) days.set(istDay(e.spentAt), [...(days.get(istDay(e.spentAt)) ?? []), e]);

  return (
    <div className="flex min-w-0 flex-col">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-[1.65rem] font-semibold tracking-tight">Expenses</h1>
          <p className="mt-0.5 text-sm text-muted">Warehouse spending from the WhatsApp group, month by month</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => downloadCsv(month, expenses)} disabled={!expenses.length} className={buttonClass("secondary")}>
            CSV
          </button>
          <button type="button" onClick={() => setAdding(true)} className={buttonClass("secondary")}>
            <PlusIcon className="h-4 w-4" />
            Add
          </button>
        </div>
      </div>

      <WhatsAppBar wa={whatsapp} />
      <ScreenshotReader rows={expenses} />

      <nav aria-label="Months" className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:px-0 [&::-webkit-scrollbar]:hidden">
        {months.map((m) => {
          const on = m.month === month;
          return (
            <Link
              key={m.month}
              prefetch={false}
              href={`/expenses?month=${m.month}`}
              aria-current={on ? "page" : undefined}
              className={`focus-ring flex shrink-0 flex-col rounded-2xl border px-4 py-2.5 transition ${on ? "border-accent bg-accent text-accent-ink sp-glow" : "border-line bg-surface hover:border-accent/50"}`}
            >
              <span className={`text-xs font-bold ${on ? "text-accent-ink/80" : "text-muted"}`}>{m.label}</span>
              <span className="font-mono text-base font-bold tabular-nums">{formatINR(m.total)}</span>
            </Link>
          );
        })}
      </nav>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[1fr_1.15fr]">
        <section className="sp-card sp-card-lg relative overflow-hidden p-5 sm:p-6" aria-labelledby="exp-total">
          <span aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full" style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--accent) 28%, transparent), transparent 68%)" }} />
          <div className="relative">
            <h2 id="exp-total" className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
              Spent in {label}
            </h2>
            <p className="mt-3 bg-clip-text font-mono text-[3.2rem] font-bold leading-none tracking-tight text-transparent tabular-nums sm:text-6xl" style={{ backgroundImage: "linear-gradient(100deg, var(--accent-text), var(--madder))" }}>
              {formatINR(s.total)}
            </p>
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
              {formatNumber(s.count)} {s.count === 1 ? "expense" : "expenses"}
              {change !== null ? (
                <Chip tone={change > 0 ? "bad" : "ok"}>
                  {change > 0 ? "▲" : "▼"} {Math.abs(change)}% on {previous?.label}
                </Chip>
              ) : null}
            </p>
            <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-line pt-4">
              <div className="min-w-0">
                <dt className="text-[11px] font-bold uppercase tracking-wider text-muted">To check</dt>
                <dd className={`mt-1 font-mono text-xl font-bold tabular-nums sm:text-2xl ${s.toCheck ? "text-warn" : ""}`}>{formatNumber(s.toCheck)}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[11px] font-bold uppercase tracking-wider text-muted">No amount</dt>
                <dd className={`mt-1 font-mono text-xl font-bold tabular-nums sm:text-2xl ${s.noAmount ? "text-bad" : ""}`}>{formatNumber(s.noAmount)}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[11px] font-bold uppercase tracking-wider text-muted">Biggest</dt>
                <dd className="mt-1 truncate text-sm font-bold">{top ? top.category : "—"}</dd>
                {top ? <dd className="font-mono text-xs text-muted tabular-nums">{formatINR(top.total)}</dd> : null}
              </div>
            </dl>
          </div>
        </section>

        <section className="sp-card sp-card-lg p-5 sm:p-6" aria-labelledby="exp-types">
          <h2 id="exp-types" className="font-display text-lg font-semibold">
            By type
          </h2>
          <p className="mb-4 text-xs text-muted">Where the money went in {label}</p>
          {s.byCategory.length ? (
            <ul className="flex flex-col gap-3.5">
              {s.byCategory.map((c, i) => (
                <li key={c.category} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5">
                  <span className="min-w-0 truncate text-sm font-bold">{c.category}</span>
                  <span className="text-right font-mono text-sm font-bold tabular-nums">
                    {formatINR(c.total)} <span className="text-xs font-normal text-muted">· {c.count}</span>
                  </span>
                  <span className="col-span-2">
                    <Bar share={c.total / maxCat} tone="accent" index={i} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-8 text-center text-sm text-muted">No expenses in {label} yet.</p>
          )}
        </section>
      </div>

      <div className="mb-3 mt-6 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold">Every expense</h2>
        <div role="group" aria-label="Show" className="inline-flex rounded-xl border border-line bg-panel2 p-0.5">
          {(
            [
              ["payments", `Payments ${counted.length}`],
              ["check", `To check ${s.toCheck}`],
              ...(reading.length ? ([["reading", `Being read ${reading.length}`]] as const) : []),
              ["not", `Not counted ${notCounted.length}`],
            ] as const
          ).map(([k, text]) => (
            <button
              key={k}
              type="button"
              aria-pressed={show === k}
              onClick={() => setShow(k)}
              className={`focus-ring min-h-10 rounded-[10px] px-3 text-sm font-semibold transition ${show === k ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"}`}
            >
              {text}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line px-5 py-10 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface2 text-muted">
            <ReceiptIcon className="h-6 w-6" />
          </span>
          <p className="mt-3 text-base font-bold">{show === "check" ? "Nothing left to check" : `No expenses in ${label} yet`}</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{whatsapp.linkedAs ? "Press Fetch from WhatsApp to bring in the latest from the group." : "Link WhatsApp above, or add one by hand."}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {[...days.entries()].map(([day, list]) => (
            <section key={day} aria-label={day}>
              <h3 className="mb-2 flex items-baseline justify-between px-1 text-sm font-bold">
                <span>{dayHead.format(new Date(`${day}T12:00:00+05:30`))}</span>
                <span className="font-mono text-xs text-muted tabular-nums">{formatINR(list.filter(counts).reduce((n, e) => n + (e.amount ?? 0), 0))}</span>
              </h3>
              <ul className="sp-card divide-y divide-line-soft overflow-hidden">
                {list.map((e) => (
                  <li key={e.id}>
                    <button type="button" onClick={() => setEditing(e)} className={`focus-ring flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-surface2/60 sm:px-4 ${counts(e) ? "" : "opacity-60"}`}>
                      {/* The whole screenshot, small (phone screenshots are tall). */}
                      <span className="flex h-[4.5rem] w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface2 text-muted">
                        {e.thumbUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={e.thumbUrl} alt="" className="h-full w-full object-contain" loading="lazy" />
                        ) : (
                          <ReceiptIcon className="h-6 w-6" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold">{e.reason || (e.paidTo ? `Paid to ${e.paidTo}` : "No note")}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Chip tone="accent">{e.category}</Chip>
                          {e.verdict === "pending" && e.status !== "ignored" ? <Chip tone="info">Being read</Chip> : null}
                          {e.verdict === "not_payment" ? <Chip>Not a payment</Chip> : null}
                          {counts(e) && e.status === "new" ? <Chip tone="warn">Check</Chip> : null}
                          {e.status === "ignored" ? <Chip>Not counted</Chip> : null}
                          <span className="text-[11px] text-muted">
                            {time.format(new Date(e.spentAt))}
                            {e.sender ? ` · ${e.sender}` : ""}
                          </span>
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className={`block font-mono text-base font-bold tabular-nums ${e.amount === null ? "text-bad" : ""}`}>{e.amount === null ? "No amount" : rupees(e.amount)}</span>
                        {e.amountFrom ? <span className="block text-[11px] text-muted">{FROM_LABEL[e.amountFrom]}</span> : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <EditSheet row={editing} onClose={() => setEditing(null)} />
      <AddSheet open={adding} onClose={() => setAdding(false)} today={today} />
    </div>
  );
}
