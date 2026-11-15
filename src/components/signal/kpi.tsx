import Link from "next/link";
import type { ReactNode } from "react";
import { Sparkline } from "@/components/signal/charts";
import { CountUp } from "@/components/signal/count-up";
import type { SignalTone } from "@/lib/theme";

const TEXT: Record<SignalTone, string> = {
  bad: "text-bad",
  warn: "text-warn",
  ok: "text-ok",
  accent: "text-accent-text",
  cyan: "text-cyan",
  neutral: "text-ink",
};

/**
 * A KPI tile: label, a big count-up number, one line under it and a sparkline. Colour only says what the status is;
 * the words under the number say it too.
 */
export function KpiTile({
  label,
  value,
  sub,
  tone = "neutral",
  spark,
  sparkTone,
  sparkLabel,
  href,
  index = 0,
}: {
  label: string;
  value: number;
  sub?: ReactNode;
  tone?: SignalTone;
  spark?: number[];
  sparkTone?: SignalTone;
  sparkLabel?: string;
  href?: string;
  index?: number;
}) {
  const body = (
    <>
      <span className="t-label block">{label}</span>
      <CountUp value={value} className={`t-stat mt-2 block font-display ${TEXT[tone]}`} />
      {sub ? <span className="t-caption mt-1.5 block">{sub}</span> : null}
      {spark && spark.length > 1 ? (
        <div className="mt-3">
          <Sparkline values={spark} tone={sparkTone ?? (tone === "neutral" ? "accent" : tone)} label={sparkLabel ?? `${label} trend`} className="h-9 w-full" />
        </div>
      ) : null}
    </>
  );
  const cls = "sp-card g-pad block min-w-0";
  const style = { ["--i" as string]: index };
  return href ? (
    <Link prefetch={false} href={href} className={`${cls} focus-ring`} style={style}>
      {body}
    </Link>
  ) : (
    <div className={cls} style={style}>
      {body}
    </div>
  );
}
