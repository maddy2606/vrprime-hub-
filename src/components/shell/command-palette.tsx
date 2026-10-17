"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { SearchIcon } from "@/components/icons";
import { KIND_LABEL, matchPages, type SearchHit } from "@/lib/search";
import { searchAll } from "@/server/actions/search";

type Role = "owner" | "admin" | "warehouse";

const KIND_TONE: Record<SearchHit["kind"], string> = {
  page: "bg-accent-soft text-accent-text",
  sku: "bg-cyan-soft text-cyan",
  order: "bg-warn-soft text-warn",
  ticket: "bg-bad-soft text-bad",
  post: "bg-ok-soft text-ok",
};

/** Ctrl/Cmd + K. Pages answer at once; SKUs, orders, tickets and work posts come from the server, debounced. */
export function CommandPalette({ open, onClose, role }: { open: boolean; onClose: () => void; role: Role }) {
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<{ q: string; hits: SearchHit[] }>({ q: "", hits: [] });
  const [busy, setBusy] = useState(false);
  const [pick, setActive] = useState(0);

  const term = q.trim();
  const hits = useMemo(() => {
    const pages = matchPages(term, role, term ? 4 : 7);
    // Results for an older term are not shown against a newer one.
    return [...pages, ...(remote.q === term ? remote.hits : [])];
  }, [term, role, remote]);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
      opener.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open || term.length < 2) return;
    let stale = false;
    const timer = window.setTimeout(async () => {
      setBusy(true);
      try {
        const found = await searchAll(term);
        if (!stale) setRemote({ q: term, hits: found });
      } catch {
        if (!stale) setRemote({ q: term, hits: [] });
      } finally {
        if (!stale) setBusy(false);
      }
    }, 220);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [term, open]);

  if (!open) return null;
  // The highlighted row follows the list: a shorter list never leaves it past the end.
  const active = Math.min(pick, Math.max(hits.length - 1, 0));

  const go = (hit: SearchHit | undefined) => {
    if (!hit) return;
    onClose();
    setQ("");
    router.push(hit.href);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (hits.length ? (i + 1) % hits.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (hits.length ? (i - 1 + hits.length) % hits.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(hits[active]);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-3 pt-[10vh]" role="dialog" aria-modal="true" aria-label="Search">
      <button type="button" aria-label="Close search" tabIndex={-1} onClick={onClose} className="absolute inset-0 cursor-default bg-scrim backdrop-blur-sm" />
      <div onKeyDown={onKey} className="sp-card sp-card-lg relative w-full max-w-xl overflow-hidden bg-surface2">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <SearchIcon className="h-5 w-5 shrink-0 text-muted" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={hits[active] ? `${listId}-${hits[active].id}` : undefined}
            autoComplete="off"
            spellCheck={false}
            placeholder="Search SKUs, orders, tickets, work, pages"
            className="min-h-14 w-full bg-transparent text-base outline-none placeholder:text-faint"
          />
          <kbd className="hidden shrink-0 rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted sm:block">Esc</kbd>
        </div>
        <ul id={listId} role="listbox" aria-label="Results" className="max-h-[55vh] overflow-y-auto p-2">
          {hits.length === 0 ? (
            <li className="px-3 py-8 text-center text-sm text-muted">{busy ? "Searching…" : term.length < 2 ? "Type at least 2 characters." : "Nothing found."}</li>
          ) : (
            hits.map((h, i) => (
              <li key={h.id} id={`${listId}-${h.id}`} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onClick={() => go(h)}
                  onMouseMove={() => setActive(i)}
                  className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2 text-left ${i === active ? "bg-accent-soft" : ""}`}
                >
                  <span className={`w-16 shrink-0 rounded-full px-2 py-0.5 text-center font-mono text-[10px] font-bold tracking-wider ${KIND_TONE[h.kind]}`}>{KIND_LABEL[h.kind]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[13px] font-bold">{h.label}</span>
                    <span className="block truncate text-xs text-muted">{h.sub}</span>
                  </span>
                  {i === active ? <span aria-hidden="true" className="shrink-0 font-mono text-xs text-muted">↵</span> : null}
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="hidden items-center gap-4 border-t border-line px-4 py-2 text-[11px] text-faint sm:flex" aria-hidden="true">
          <span>↑↓ move</span>
          <span>↵ open</span>
          <span>Esc close</span>
        </div>
      </div>
    </div>
  );
}
