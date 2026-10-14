"use client";

import Link from "next/link";
import { useState } from "react";
import { Caption, InfoTip } from "@/components/flipkart/kit";
import { EmptyState } from "@/components/ui";
import { formatDate, formatNumber } from "@/lib/format";
import type { ActionLink, ActionRow, ActionSection } from "@/lib/flipkart-analysis";

const SHOWN = 6;

const TONE_BAR = { bad: "bg-bad", warn: "bg-warn", info: "bg-info" } as const;
const TONE_RANK = { bad: 0, warn: 1, info: 2 } as const;

const BUTTON =
  "focus-ring inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-lg border border-line bg-surface px-3 text-xs font-bold hover:bg-surface2 sm:min-h-9";

function ActionButton({ link }: { link: ActionLink }) {
  if (link.external) {
    return (
      <a href={link.href} target="_blank" rel="noopener noreferrer" className={BUTTON}>
        {link.label} ↗
      </a>
    );
  }
  return (
    <Link prefetch={false} href={link.href} className={BUTTON}>
      {link.label}
    </Link>
  );
}

/** One line of what is wrong, and the buttons for the next step on the right (below it on a phone). */
function Row({ row, plain }: { row: ActionRow; plain: boolean }) {
  return (
    <li className="flex gap-3 px-3 py-2.5">
      <span aria-hidden="true" className={`w-1 shrink-0 self-stretch rounded-full ${TONE_BAR[row.tone]}`} />
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <p className={`break-words text-[13px] font-bold leading-snug [overflow-wrap:anywhere] ${plain ? "" : "font-mono"}`}>{row.title}</p>
          {row.detail ? <p className="mt-0.5 line-clamp-2 break-words text-xs leading-snug text-muted">{row.detail}</p> : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
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
    <section aria-labelledby={`na-${section.key}`} className="mb-6">
      <h2 id={`na-${section.key}`} className="mb-2 flex items-baseline gap-2 text-base font-extrabold">
        {section.title}
        <span className="text-sm font-semibold text-muted">{formatNumber(section.rows.length)}</span>
      </h2>
      <ul className="divide-y divide-line overflow-hidden sp-card">
        {rows.map((r) => (
          <Row key={r.key} row={r} plain={section.key === "orders"} />
        ))}
      </ul>
      {more > 0 ? (
        <button type="button" onClick={() => setAll((v) => !v)} className="focus-ring mt-2 min-h-11 rounded-lg px-2 text-sm font-bold text-ink underline decoration-line underline-offset-4 hover:bg-surface2">
          {all ? "Show fewer" : `Show ${formatNumber(more)} more`}
        </button>
      ) : null}
    </section>
  );
}

/** The most urgent section first: red before amber before blue, then the order the sections were built in. */
function bySeverity(sections: ActionSection[]): ActionSection[] {
  const rank = (s: ActionSection) => Math.min(...s.rows.map((r) => TONE_RANK[r.tone]));
  return sections.map((s, i) => ({ s, i })).sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i).map((x) => x.s);
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
      <div className="mb-2 flex items-center justify-between gap-2">
        <Caption>{asOf.stock ? `From stock as of ${formatDate(asOf.stock, asOf.today)}. Red first.` : "Red first."}</Caption>
        {notes.length ? (
          <InfoTip label="Things not ready yet">
            <ul className="flex flex-col gap-2">
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </InfoTip>
        ) : null}
      </div>
      {sections.length === 0 ? (
        <EmptyState title="Nothing needs action" body="No order is about to miss dispatch, and no price, return or stock warning is open. Check Stock and Overfill Orders for the rest." />
      ) : null}
      {bySeverity(sections).map((s) => (
        <Section key={s.key} section={s} />
      ))}
    </>
  );
}
