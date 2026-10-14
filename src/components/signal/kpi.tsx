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
      <span className="block text-[11px] font-bold uppercase tracking-wider text-muted">{label}</span>
      <CountUp value={value} className={`mt-1 block text-3xl font-bold leading-none ${TEXT[tone]}`} />
      {sub ? <span className="mt-1.5 block text-xs text-muted">{sub}</span> : null}
      {spark && spark.length > 1 ? (
        <div className="mt-3">
          <Sparkline values={spark} tone={sparkTone ?? (tone === "neutral" ? "cyan" : tone)} label={sparkLabel ?? `${label} trend`} />
        </div>
      ) : null}
    </>
  );
  const cls = "sp-card sp-lift sp-reveal block min-w-0 p-4";
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
