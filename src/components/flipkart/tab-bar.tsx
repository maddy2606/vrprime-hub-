import Link from "next/link";

export const TAB_KEYS = ["needs", "orders", "stock", "returns", "prices", "health", "forecast"] as const;
export type TabKey = (typeof TAB_KEYS)[number];

export const TAB_LABEL: Record<TabKey, string> = {
  needs: "Needs action",
  orders: "Orders",
  stock: "Stock",
  returns: "Returns",
  prices: "Prices",
  health: "Listing health",
  forecast: "Forecasting",
};

/** Prices and listing problems are for owner and admin; warehouse users see the other five (Forecasting shows only their warehouses). */
export function tabsFor(role: string): TabKey[] {
  return role === "warehouse" ? ["needs", "orders", "stock", "returns", "forecast"] : [...TAB_KEYS];
}

export function isTabKey(value: unknown): value is TabKey {
  return typeof value === "string" && (TAB_KEYS as readonly string[]).includes(value);
}

/** The tabs of the Flipkart page. Plain links: each tab loads only its own data. */
export function TabBar({ tabs, active }: { tabs: TabKey[]; active: TabKey }) {
  return (
    <nav aria-label="Flipkart sections" className="-mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0">
      {tabs.map((key) => (
        <Link
          key={key}
          prefetch={false}
          href={key === "needs" ? "/flipkart" : `/flipkart?tab=${key}`}
          aria-current={active === key ? "page" : undefined}
          className={`focus-ring flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-full border px-3.5 text-sm font-bold ${
            active === key ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-muted hover:text-ink"
          }`}
        >
          {TAB_LABEL[key]}
        </Link>
      ))}
    </nav>
  );
}
