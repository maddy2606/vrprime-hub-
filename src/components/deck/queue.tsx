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
      <ul className="m-0 list-none p-0">
        {shown.map((r) => (
          <li key={r.key} className={`tone-row ${r.kind === "late" ? "tone-bad tone-late" : `tone-${TONE[r.kind]}`}`}>
            <Chip tone={TONE[r.kind]} live={r.kind === "late"}>
              {r.tag}
            </Chip>
            <div className="min-w-0 flex-1 basis-48">
              <p className="tone-row-title break-words font-mono [overflow-wrap:anywhere]">{r.title}</p>
              <p className="t-caption mt-0.5 line-clamp-2 break-words">{r.detail}</p>
            </div>
            <div className="tone-row-actions">
              {r.actions.map((a, i) => (
                <Link key={a.label} prefetch={false} href={a.href} className={buttonClass(i === 0 ? "secondary" : "ghost")}>
                  {a.label}
                </Link>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {rows.length > SHOWN ? (
        <div className="border-t border-line-soft p-2">
          <button type="button" onClick={() => setAll((v) => !v)} className={buttonClass("ghost", "w-full")}>
            {all ? "Show fewer" : `Show ${rows.length - SHOWN} more`}
          </button>
        </div>
      ) : null}
    </>
  );
}
