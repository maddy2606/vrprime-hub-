"use client";

import Link from "next/link";
import { useState } from "react";
import { Caption, InfoTip } from "@/components/flipkart/kit";
import { Chip, EmptyState, buttonClass } from "@/components/ui";
import { formatDate, formatNumber } from "@/lib/format";
import type { ActionLink, ActionRow, ActionSection } from "@/lib/flipkart-analysis";

const SHOWN = 6;

const TONE_RANK = { bad: 0, warn: 1, info: 2 } as const;

function ActionButton({ link, first }: { link: ActionLink; first: boolean }) {
  const BUTTON = buttonClass(first ? "secondary" : "ghost");
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
    <li className={`tone-row tone-${row.tone}`}>
      <div className="min-w-0 flex-1 basis-48">
        <p className={`tone-row-title break-words [overflow-wrap:anywhere] ${plain ? "" : "font-mono"}`}>{row.title}</p>
        {row.detail ? <p className="t-caption mt-0.5 line-clamp-2 break-words">{row.detail}</p> : null}
      </div>
      <div className="tone-row-actions">
        {row.actions.map((a, i) => (
          <ActionButton key={a.label} link={a} first={i === 0} />
        ))}
      </div>
    </li>
  );
}

function Section({ section }: { section: ActionSection }) {
  const [all, setAll] = useState(false);
  const rows = all ? section.rows : section.rows.slice(0, SHOWN);
  const more = section.rows.length - SHOWN;
  const tone = section.rows.reduce<"bad" | "warn" | "info">((t, r) => (TONE_RANK[r.tone] < TONE_RANK[t] ? r.tone : t), "info");
  return (
    <section aria-labelledby={`na-${section.key}`} className="sp-card overflow-hidden">
      <div className="g-pad pb-3">
        <h2 id={`na-${section.key}`} className={`tone-head tone-${tone} t-card-title flex items-center gap-2`}>
          {section.title}
          <Chip tone={tone}>{formatNumber(section.rows.length)}</Chip>
        </h2>
      </div>
      <ul className="m-0 list-none p-0">
        {rows.map((r) => (
          <Row key={r.key} row={r} plain={section.key === "orders"} />
        ))}
      </ul>
      {more > 0 ? (
        <div className="border-t border-line-soft p-2">
          <button type="button" onClick={() => setAll((v) => !v)} className={buttonClass("ghost", "w-full")}>
            {all ? "Show fewer" : `Show ${formatNumber(more)} more`}
          </button>
        </div>
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
      <div className="mb-4 flex items-center justify-between gap-2">
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
      {sections.length ? (
        <div className="grid items-start gap-3 min-[700px]:gap-4 min-[1100px]:grid-cols-2">
          {bySeverity(sections).map((s) => (
            <Section key={s.key} section={s} />
          ))}
        </div>
      ) : null}
    </>
  );
}
