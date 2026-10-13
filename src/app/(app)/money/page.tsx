import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageTitle } from "@/components/ui";
import { requireOwnerPage } from "@/server/money-data";
import { ChecksPanel, CostsPanel, ProfitPanel, UploadsPanel, WeightPanel, type Search } from "./panels";

export const metadata: Metadata = { title: "Money" };

// Owner only. Anyone else gets "not found": the page, its nav link and its numbers do not exist for them.
const TABS = [
  { key: "profit", label: "Profit", sub: "Profit per SKU from the settlement reports" },
  { key: "costs", label: "Costs", sub: "What each SKU costs you: purchase, packaging, freight" },
  { key: "weight", label: "Weight", sub: "Orders Flipkart charged too much weight for" },
  { key: "checks", label: "Settlement", sub: "Unpaid orders and wrong fees" },
  { key: "uploads", label: "Uploads", sub: "Settlement reports from Seller Hub" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function MoneyPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { db } = await requireOwnerPage();
  const sp = await searchParams;
  const requested = one(sp.tab);
  const tab: TabKey = (TABS.find((t) => t.key === requested)?.key ?? "profit") as TabKey;
  const current = TABS.find((t) => t.key === tab)!;

  return (
    <>
      <PageTitle title="Money" sub={current.sub} />
      <nav aria-label="Money sections" className="-mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0">
        {TABS.map((t) => (
          <Link
            key={t.key}
            prefetch={false}
            href={t.key === "profit" ? "/money" : `/money?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={`focus-ring flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-full border px-3.5 text-sm font-bold ${
              tab === t.key ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <Suspense key={`${tab}|${JSON.stringify(sp)}`} fallback={<div aria-busy="true" className="skeleton h-72 w-full" />}>
        {tab === "profit" ? <ProfitPanel db={db} sp={sp} /> : null}
        {tab === "costs" ? <CostsPanel db={db} /> : null}
        {tab === "weight" ? <WeightPanel db={db} sp={sp} /> : null}
        {tab === "checks" ? <ChecksPanel db={db} /> : null}
        {tab === "uploads" ? <UploadsPanel db={db} /> : null}
      </Suspense>
    </>
  );
}
