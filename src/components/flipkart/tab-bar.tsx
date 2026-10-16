import Link from "next/link";
import { SHOW_LISTING_HEALTH } from "@/lib/feature-flags";

// The order of the tabs. "health" (Listing health) is only shown while SHOW_LISTING_HEALTH is on.
export const TAB_KEYS = ["needs", "orders", "stock", "returns", "prices", "health", "forecast", "overfill", "masters"] as const;
export type TabKey = (typeof TAB_KEYS)[number];

export const TAB_LABEL: Record<TabKey, string> = {
  needs: "Needs action",
  orders: "Orders",
  stock: "Stock",
  returns: "Returns",
  prices: "Prices",
  health: "Listing health",
  forecast: "Forecasting",
  overfill: "Overfill Orders",
  masters: "Master SKUs",
};

/** Prices, Master SKUs (and Listing health, when it is on) are for owner and admin; warehouse users see the rest, for their own warehouses. */
export function tabsFor(role: string): TabKey[] {
  return TAB_KEYS.filter((k) => (k !== "health" || SHOW_LISTING_HEALTH) && !(role === "warehouse" && (k === "prices" || k === "health" || k === "masters")));
}

export function isTabKey(value: unknown): value is TabKey {
  return typeof value === "string" && (TAB_KEYS as readonly string[]).includes(value);
}

/** The page's tabs: one row that scrolls sideways on a phone. Plain links: each tab loads only its own data. */
export function TabBar({ tabs, active }: { tabs: TabKey[]; active: TabKey }) {
  return (
    <nav aria-label="Flipkart sections" className="-mx-4 mb-4 flex overflow-x-auto overflow-y-hidden border-b border-line px-4 [scrollbar-width:none] lg:mx-0 lg:px-0 [&::-webkit-scrollbar]:hidden">
      {tabs.map((key) => (
        <Link
          key={key}
          prefetch={false}
          href={key === "needs" ? "/flipkart" : `/flipkart?tab=${key}`}
          aria-current={active === key ? "page" : undefined}
          className={`focus-ring -mb-px flex min-h-11 shrink-0 items-center whitespace-nowrap border-b-2 px-3.5 text-sm font-bold transition ${
            active === key ? "border-accent text-accent-text" : "border-transparent text-muted hover:text-ink"
          }`}
        >
          {TAB_LABEL[key]}
        </Link>
      ))}
    </nav>
  );
}
