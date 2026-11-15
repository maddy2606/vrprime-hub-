import Link from "next/link";
import { SHOW_LISTING_HEALTH } from "@/lib/feature-flags";

// The order of the tabs. "health" (Listing health) is only shown while SHOW_LISTING_HEALTH is on.
export const TAB_KEYS = ["needs", "orders", "stock", "stockouts", "returns", "prices", "health", "forecast", "overfill", "masters"] as const;
export type TabKey = (typeof TAB_KEYS)[number];

export const TAB_LABEL: Record<TabKey, string> = {
  needs: "Needs action",
  orders: "Orders",
  stock: "Stock",
  stockouts: "Stock-outs",
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

/** The tabs in four groups. The addresses do not change: every tab is still /flipkart?tab=<key>. */
export const TAB_GROUPS: { label: string; keys: TabKey[] }[] = [
  { label: "Today", keys: ["needs", "orders", "overfill"] },
  { label: "Stock", keys: ["stock", "stockouts", "forecast"] },
  { label: "Listings", keys: ["prices", "health", "masters"] },
  { label: "Returns", keys: ["returns"] },
];

const hrefFor = (key: TabKey) => (key === "needs" ? "/flipkart" : `/flipkart?tab=${key}`);

/**
 * The page's tabs: a row of groups (Today, Stock, Listings, Returns), then the tabs of the open group. A group is
 * shown only when the reader may open at least one of its tabs, and it opens on the first of them. Plain links: each
 * tab loads only its own data.
 */
export function TabBar({ tabs, active }: { tabs: TabKey[]; active: TabKey }) {
  const groups = TAB_GROUPS.map((g) => ({ ...g, keys: g.keys.filter((k) => tabs.includes(k)) })).filter((g) => g.keys.length > 0);
  const open = groups.find((g) => g.keys.includes(active)) ?? groups[0];
  return (
    <nav aria-label="Flipkart sections" className="mb-5 flex flex-col gap-3">
      <div className="seg max-w-full self-start">
        {groups.map((g) => {
          const on = g === open;
          return (
            <Link
              key={g.label}
              prefetch={false}
              href={hrefFor(g.keys[0])}
              aria-current={on && g.keys.length === 1 ? "page" : undefined}
              className={`seg-opt ${on ? "is-on" : ""}`}
            >
              {g.label}
            </Link>
          );
        })}
      </div>
      {open && open.keys.length > 1 ? (
        <div className="-mx-3 min-[700px]:-mx-4 flex gap-1.5 overflow-x-auto overflow-y-hidden px-3 min-[700px]:px-4 [scrollbar-width:none] min-[1100px]:mx-0 min-[1100px]:px-0 [&::-webkit-scrollbar]:hidden">
          {open.keys.map((key) => (
            <Link
              key={key}
              prefetch={false}
              href={hrefFor(key)}
              aria-current={active === key ? "page" : undefined}
              className={`g-btn g-btn-ghost focus-ring shrink-0 whitespace-nowrap rounded-full ${active === key ? "bg-accent-soft" : ""}`}
            >
              {TAB_LABEL[key]}
            </Link>
          ))}
        </div>
      ) : null}
    </nav>
  );
}
