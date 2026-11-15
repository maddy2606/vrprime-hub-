"use client";

import { useState, type ReactNode } from "react";
import { AlertIcon, BoardIcon, BoxIcon, ClockIcon, TicketIcon } from "@/components/icons";
import { buttonClass, ItemRow, type Tint } from "@/components/ui";
import type { QueueKind } from "@/lib/deck";
import Link from "next/link";

type Row = {
  key: string;
  kind: QueueKind;
  tag: string;
  title: string;
  detail: string;
  actions: { label: string; href: string }[];
};

/** Each kind's icon badge (graphite-spec 4: icon and tint by meaning; red for late, amber for at risk). */
const BADGE: Record<QueueKind, { icon: ReactNode; tint: Tint }> = {
  late: { icon: <ClockIcon />, tint: "red" },
  overfill: { icon: <BoxIcon />, tint: "red" },
  risk: { icon: <ClockIcon />, tint: "amber" },
  dry: { icon: <AlertIcon />, tint: "amber" },
  ticket: { icon: <TicketIcon />, tint: "green" },
  work: { icon: <BoardIcon />, tint: "violet" },
};

/**
 * The ranked list as item rows: the kind's icon badge, the title over "kind · detail", and the row's buttons (40px
 * secondary) on the right. The first `shown` rows show; the rest open in place.
 */
export function QueueList({ rows, shown = 6, expand = "more" }: { rows: Row[]; shown?: number; expand?: "more" | "all" }) {
  const [all, setAll] = useState(false);
  const list = all ? rows : rows.slice(0, shown);
  return (
    <>
      <ul className="item-list m-0 list-none p-0">
        {list.map((r) => (
          <li key={r.key}>
            <ItemRow
              icon={BADGE[r.kind].icon}
              tint={BADGE[r.kind].tint}
              title={<span className="font-mono">{r.title}</span>}
              detail={`${r.tag} · ${r.detail}`}
              end={r.actions.map((a) => (
                <Link key={a.label} prefetch={false} href={a.href} className={buttonClass("row")}>
                  {a.label}
                </Link>
              ))}
            />
          </li>
        ))}
      </ul>
      {rows.length > shown ? (
        <button type="button" onClick={() => setAll((v) => !v)} className={buttonClass("ghost", "mt-2 w-full")}>
          {all ? "Show fewer" : expand === "all" ? "View all" : `Show ${rows.length - shown} more`}
        </button>
      ) : null}
    </>
  );
}
