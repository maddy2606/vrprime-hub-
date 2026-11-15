import Link from "next/link";
import type { ReactNode } from "react";
import { PageTitle } from "@/components/ui";

export type BusinessTab = "week" | "targets" | "dead";

export const BUSINESS_TABS: { key: BusinessTab; label: string }[] = [
  { key: "week", label: "This week" },
  { key: "targets", label: "Targets" },
  { key: "dead", label: "Dead stock" },
];

export function readBusinessTab(v: unknown): BusinessTab {
  return v === "targets" || v === "dead" ? v : "week";
}

/** The Business page's header and tabs (graphite-spec 12.1); the tab's content goes under it. */
export function BusinessFrame({ tab, sub, base = "/business", children }: { tab: BusinessTab; sub: string; base?: string; children: ReactNode }) {
  const sep = base.includes("?") ? "&" : "?";
  return (
    <div>
      <PageTitle title="Business" sub={sub} />
      <nav aria-label="Business views" className="seg mb-4">
        {BUSINESS_TABS.map((t) => (
          <Link key={t.key} prefetch={false} href={t.key === "week" ? base : `${base}${sep}tab=${t.key}`} aria-current={t.key === tab ? "page" : undefined} className="seg-opt">
            {t.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
