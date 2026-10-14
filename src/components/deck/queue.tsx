"use client";

import Link from "next/link";
import { useState } from "react";
import { buttonClass, Chip } from "@/components/ui";
import type { QueueKind } from "@/lib/deck";
import type { Tone } from "@/lib/labels";

type Row = {
  key: string;
  kind: QueueKind;
  tag: string;
  title: string;
  detail: string;
  actions: { label: string; href: string }[];
};

const TONE: Record<QueueKind, Tone> = { late: "bad", overfill: "bad", dry: "warn", risk: "warn", ticket: "accent", work: "neutral" };
const SHOWN = 6;

/** The ranked list. Each row has a kind tag, what is wrong and a button that goes straight to where it is fixed. */
export function QueueList({ rows }: { rows: Row[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, SHOWN);
  return (
    <>
      <ul className="divide-y divide-line-soft">
        {shown.map((r) => (
          <li key={r.key} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 w-[5.5rem] shrink-0">
                <Chip tone={TONE[r.kind]}>{r.tag}</Chip>
              </span>
              <div className="min-w-0">
                <p className="break-words font-mono text-[13px] font-bold leading-snug [overflow-wrap:anywhere]">{r.title}</p>
                <p className="mt-0.5 line-clamp-2 break-words text-xs leading-snug text-muted">{r.detail}</p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2 pl-[6.25rem] sm:pl-0">
              {r.actions.map((a, i) => (
                <Link key={a.label} prefetch={false} href={a.href} className={buttonClass(i === 0 ? "primary" : "outline", "min-h-11 px-3 text-xs sm:min-h-9")}>
                  {a.label}
                </Link>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {rows.length > SHOWN ? (
        <div className="border-t border-line-soft p-2">
          <button type="button" onClick={() => setAll((v) => !v)} className="focus-ring min-h-11 w-full rounded-xl text-sm font-bold text-accent-text hover:bg-accent-soft">
            {all ? "Show fewer" : `Show ${rows.length - SHOWN} more`}
          </button>
        </div>
      ) : null}
    </>
  );
}
