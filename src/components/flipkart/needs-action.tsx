"use client";

import Link from "next/link";
import { useState } from "react";
import { EmptyState } from "@/components/ui";
import { formatDate, formatNumber } from "@/lib/format";
import type { ActionLink, ActionRow, ActionSection } from "@/lib/flipkart-analysis";

const SHOWN = 5;

const TONE_BAR = { bad: "bg-bad", warn: "bg-warn", info: "bg-info" } as const;

function ActionButton({ link }: { link: ActionLink }) {
  const cls = "focus-ring inline-flex min-h-10 items-center whitespace-nowrap rounded-lg border border-line bg-surface px-3 text-xs font-bold text-accent-text hover:bg-accent-soft";
  if (link.external) {
    return (
      <a href={link.href} target="_blank" rel="noopener noreferrer" className={cls}>
        {link.label} ↗
      </a>
    );
  }
  return (
    <Link prefetch={false} href={link.href} className={cls}>
      {link.label}
    </Link>
  );
}

function Row({ row }: { row: ActionRow }) {
  return (
    <li className="flex gap-3 rounded-xl border border-line bg-surface p-3">
      <span aria-hidden="true" className={`mt-0.5 w-1 shrink-0 self-stretch rounded-full ${TONE_BAR[row.tone]}`} />
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-extrabold leading-snug [overflow-wrap:anywhere]">{row.title}</p>
        {row.detail ? <p className="mt-0.5 break-words text-sm text-muted">{row.detail}</p> : null}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {row.actions.map((a) => (
            <ActionButton key={a.label} link={a} />
          ))}
        </div>
      </div>
    </li>
  );
}

function Section({ section }: { section: ActionSection }) {
  const [all, setAll] = useState(false);
  const rows = all ? section.rows : section.rows.slice(0, SHOWN);
  const more = section.rows.length - SHOWN;
  return (
    <section aria-labelledby={`na-${section.key}`} className="mb-5">
      <h2 id={`na-${section.key}`} className="mb-2 flex items-baseline gap-2 text-base font-extrabold">
        {section.title}
        <span className="text-sm font-semibold text-muted">{formatNumber(section.rows.length)}</span>
      </h2>
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <Row key={r.key} row={r} />
        ))}
      </ul>
      {more > 0 ? (
        <button type="button" onClick={() => setAll((v) => !v)} className="focus-ring mt-2 min-h-10 rounded-lg px-2 text-sm font-bold text-accent-text hover:bg-accent-soft">
          {all ? "Show fewer" : `Show ${formatNumber(more)} more`}
        </button>
      ) : null}
    </section>
  );
}

export function NeedsAction({
  sections,
  notes,
  asOf,
}: {
  sections: ActionSection[];
  /** Things that are not ready yet, such as "collecting data". */
  notes: string[];
  asOf: { stock: string | null; today: string };
}) {
  return (
    <>
      <p className="mb-4 text-sm text-muted">
        What to look at today{asOf.stock ? `, from stock as of ${formatDate(asOf.stock, asOf.today)}` : ""}. Each line has a button for the next step.
      </p>
      {sections.length === 0 ? <EmptyState title="Nothing needs action" body="No order is about to miss dispatch, nothing is empty where orders wait, and no price, return or stock warning is open." /> : null}
      {sections.map((s) => (
        <Section key={s.key} section={s} />
      ))}
      {notes.length ? (
        <ul className="mt-2 flex flex-col gap-1.5">
          {notes.map((n) => (
            <li key={n} className="rounded-lg bg-info-soft px-3 py-2 text-xs font-semibold text-info">
              {n}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
