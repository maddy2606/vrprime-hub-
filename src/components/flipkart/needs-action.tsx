"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { AlertIcon, BoxIcon, ClockIcon, ReturnIcon, RupeeIcon } from "@/components/icons";
import { Caption, InfoTip } from "@/components/flipkart/kit";
import { Chip, EmptyState, ItemRow, buttonClass } from "@/components/ui";
import { formatDate, formatNumber } from "@/lib/format";
import type { ActionLink, ActionRow, ActionSection } from "@/lib/flipkart-analysis";

const SHOWN = 6;

const TONE_RANK = { bad: 0, warn: 1, info: 2 } as const;

/** A row button: 40px secondary (graphite-spec 4, item row). */
function ActionButton({ link }: { link: ActionLink }) {
  const BUTTON = buttonClass("row");
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

/** Each section's icon (graphite-spec 4, by meaning); the tint follows the row's tone. */
const ICON: Record<string, ReactNode> = {
  orders: <ClockIcon />,
  prices: <AlertIcon />,
  inactive: <AlertIcon />,
  listings: <AlertIcon />,
  money: <RupeeIcon />,
  returns: <ReturnIcon />,
  running: <BoxIcon />,
};
const TINT = { bad: "red", warn: "amber", info: "blue" } as const;

/** One item row: what is wrong over its detail, and the buttons for the next step on the right. */
function Row({ row, plain, section }: { row: ActionRow; plain: boolean; section: string }) {
  return (
    <li>
      <ItemRow
        icon={ICON[section] ?? <AlertIcon />}
        tint={TINT[row.tone]}
        title={<span className={plain ? "" : "font-mono"}>{row.title}</span>}
        detail={row.detail || undefined}
        end={row.actions.map((a) => (
          <ActionButton key={a.label} link={a} />
        ))}
      />
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
      <ul className="item-list m-0 list-none px-[18px] pb-[18px] max-[699.98px]:px-[14px] max-[699.98px]:pb-[14px]">
        {rows.map((r) => (
          <Row key={r.key} row={r} plain={section.key === "orders"} section={section.key} />
        ))}
      </ul>
      {more > 0 ? (
        <div className="px-2 pb-2">
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
