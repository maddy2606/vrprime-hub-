"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
import { BarsIcon, BoardIcon, BoxIcon, DashIcon, DeckIcon, GaugeIcon, Logo, MegaphoneIcon, MoreIcon, StarIcon, RupeeIcon, SlidersIcon, TicketIcon, TrendIcon, UsersIcon } from "@/components/icons";
import { SyncCard } from "@/components/shell/command-bar";
import { InstallAppCard, InstallAppRow } from "@/components/shell/install-app";
import { Sheet } from "@/components/shell/sheet";

type Item = { key: string; href: string; label: string; icon: (p: { className?: string }) => ReactNode };
type Group = { label: string; items: Item[] };

/**
 * The navigation (graphite-spec section 8), in three groups with no headings and a 14px gap between them: Command
 * Centre, Dashboard and Business (owner), Work board, Tickets, Team (owner and admin); Flipkart, Forecast, Ads Desk and Review
 * tracker (owner and admin); P&L, People, Settings (owner). Who sees what is exactly as before.
 * Under 700px it is a bottom bar of five: Deck, Work, Tickets and Flipkart within thumb reach, with the rest under More.
 */
function groups(isOwner: boolean, isStaff: boolean): Group[] {
  const operate: Item[] = [
    { key: "deck", href: "/", label: "Command Centre", icon: DeckIcon },
    ...(isOwner
      ? [
          { key: "dashboard", href: "/dashboard", label: "Dashboard", icon: DashIcon },
          { key: "business", href: "/business", label: "Business", icon: BarsIcon },
        ]
      : []),
    { key: "work", href: "/work", label: "Work board", icon: BoardIcon },
    { key: "tickets", href: "/tickets", label: "Tickets", icon: TicketIcon },
    ...(isStaff ? [{ key: "team", href: "/team", label: "Team", icon: GaugeIcon }] : []),
  ];
  const marketplace: Item[] = [
    { key: "flipkart", href: "/flipkart", label: "Flipkart", icon: BoxIcon },
    { key: "forecast", href: "/flipkart?tab=forecast", label: "Forecast", icon: TrendIcon },
    ...(isStaff
      ? [
          { key: "ads", href: "/ads/desk", label: "Ads Desk", icon: MegaphoneIcon },
          { key: "reviews", href: "/reviews", label: "Review tracker", icon: StarIcon },
        ]
      : []),
  ];
  const admin: Item[] = isOwner
    ? [
        { key: "pnl", href: "/pnl", label: "P&L", icon: RupeeIcon },
        { key: "people", href: "/admin/users", label: "People", icon: UsersIcon },
        { key: "settings", href: "/admin/settings", label: "Settings", icon: SlidersIcon },
      ]
    : [];
  return [
    { label: "Operate", items: operate },
    { label: "Marketplace", items: marketplace },
    ...(admin.length ? [{ label: "Admin", items: admin }] : []),
  ];
}

function activeKey(pathname: string, tab: string | null): string {
  if (pathname === "/") return "deck";
  if (pathname.startsWith("/dashboard")) return "dashboard";
  if (pathname.startsWith("/business")) return "business";
  if (pathname.startsWith("/flipkart")) return tab === "forecast" ? "forecast" : "flipkart";
  if (pathname === "/work" || pathname === "/all" || pathname.startsWith("/posts")) return "work";
  if (pathname.startsWith("/tickets")) return "tickets";
  if (pathname.startsWith("/ads")) return "ads";
  if (pathname.startsWith("/reviews")) return "reviews";
  if (pathname.startsWith("/team")) return "team";
  if (pathname.startsWith("/pnl")) return "pnl";
  if (pathname.startsWith("/admin/users")) return "people";
  if (pathname.startsWith("/admin/settings")) return "settings";
  return "";
}

export type RailSync = { syncedAt: string | null; scope: string; canSync: boolean };

function RailInner({ isOwner, isStaff, sync }: { isOwner: boolean; isStaff: boolean; sync: RailSync }) {
  const pathname = usePathname();
  const tab = useSearchParams().get("tab");
  const active = activeKey(pathname, tab);
  const list = groups(isOwner, isStaff);
  const flat = list.flatMap((g) => g.items);
  return (
    <>
      {/* Side rail (graphite-spec section 8): 72px icons only from 700px, 228px with labels from 1100px. */}
      <aside className="vr-rail fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-line bg-surface2 px-3 py-[22px] min-[700px]:flex min-[1100px]:px-4">
        <Link href="/" aria-label="VR Prime Ops, Command Centre" className="focus-ring flex h-10 items-center gap-2.5 rounded-[11px] max-[1099.98px]:justify-center">
          <Logo size={30} />
          <span className="vr-rail-label font-display text-[16px] font-bold">VR Prime Ops</span>
        </Link>
        <nav aria-label="Main" className="mt-5 flex min-h-0 flex-1 flex-col gap-[14px] overflow-y-auto">
          {list.map((g) => (
            <ul key={g.label} aria-label={g.label} className="flex flex-col gap-0.5">
              {g.items.map((item) => {
                const on = active === item.key;
                return (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      aria-label={item.label}
                      aria-current={on ? "page" : undefined}
                      className={`focus-ring group relative flex h-11 items-center gap-3 rounded-[11px] px-[13px] text-[14px] transition-colors duration-160 ${
                        on ? "bg-accent-soft font-semibold text-ink" : "text-muted hover:bg-panel2"
                      }`}
                    >
                      <item.icon className="h-[18px] w-[18px] shrink-0" />
                      <span className="vr-rail-label truncate">{item.label}</span>
                      <span
                        role="tooltip"
                        className="sp-pop sp-tip pointer-events-none absolute left-[58px] z-50 whitespace-nowrap px-2.5 py-1.5 text-xs font-semibold text-ink opacity-0 transition-opacity duration-160 group-hover:opacity-100 group-focus-visible:opacity-100 min-[1100px]:hidden"
                      >
                        {item.label}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ))}
        </nav>
        <InstallAppCard />
        <SyncCard since={sync.syncedAt} scope={sync.scope} canSync={sync.canSync} />
      </aside>
      <BottomBar list={flat} active={active} />
    </>
  );
}

/** Short names for the bottom bar, where each slot is a fifth of a phone's width. */
const SHORT: Record<string, string> = { deck: "Deck", work: "Work", tickets: "Tickets", flipkart: "Flipkart", forecast: "Forecast", ads: "Ads", reviews: "Reviews", team: "Team", people: "People", settings: "Settings" };

/** The places that get a slot of their own on a phone; the rest go under More. Five slots at most. */
function splitForPhone(list: Item[]): { bar: Item[]; more: Item[] } {
  if (list.length <= 5) return { bar: list, more: [] };
  const first = ["deck", "work", "tickets", "flipkart"];
  const bar = first.map((k) => list.find((i) => i.key === k)).filter((i): i is Item => Boolean(i)).slice(0, 4);
  return { bar, more: list.filter((i) => !bar.includes(i)) };
}

function BottomBar({ list, active }: { list: Item[]; active: string }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const { bar, more } = splitForPhone(list);
  const moreActive = more.some((i) => i.key === active);
  const slots = bar.length + (more.length ? 1 : 0);
  const slotClass = (on: boolean) =>
    `focus-ring relative flex h-16 w-full flex-col items-center justify-center gap-1 text-[10px] font-semibold transition-colors duration-160 ${on ? "text-accent-text" : "text-muted active:text-ink"}`;
  const pill = "relative flex h-6 w-10 items-center justify-center";
  const dot = (on: boolean) => (on ? <span aria-hidden="true" className="absolute -top-1.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-accent" /> : null);
  return (
    <>
      {/* Bottom bar, under 700px */}
      <nav aria-label="Main" className="vr-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line pb-[env(safe-area-inset-bottom)] min-[700px]:hidden">
        <ul className="grid" style={{ gridTemplateColumns: `repeat(${slots}, minmax(0, 1fr))` }}>
          {bar.map((item) => {
            const on = active === item.key;
            return (
              <li key={item.key}>
                <Link href={item.href} aria-current={on ? "page" : undefined} className={slotClass(on)}>
                  <span aria-hidden="true" className={pill}>
                    {dot(on)}
                    <item.icon className="h-5 w-5" />
                  </span>
                  <span className="max-w-full truncate px-0.5">{SHORT[item.key] ?? item.label}</span>
                </Link>
              </li>
            );
          })}
          {more.length ? (
            <li>
              <button type="button" onClick={() => setMoreOpen(true)} aria-haspopup="dialog" className={slotClass(moreActive)}>
                <span aria-hidden="true" className={pill}>
                  {dot(moreActive)}
                  <MoreIcon className="h-5 w-5" />
                </span>
                <span>More</span>
              </button>
            </li>
          ) : null}
        </ul>
      </nav>
      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <ul className="grid grid-cols-2 gap-2 pb-2">
          {more.map((item) => {
            const on = active === item.key;
            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  aria-current={on ? "page" : undefined}
                  className={`focus-ring sp-inner flex min-h-14 items-center gap-3 px-3.5 py-3 text-sm font-medium transition-colors duration-160 ${
                    on ? "!bg-accent-soft text-ink" : "text-ink active:bg-panel2"
                  }`}
                >
                  <item.icon className={`h-5 w-5 shrink-0 ${on ? "text-accent-text" : "text-muted"}`} />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <InstallAppRow onDone={() => setMoreOpen(false)} />
      </Sheet>
    </>
  );
}

export function Rail({ isOwner, isStaff, sync }: { isOwner: boolean; isStaff: boolean; sync: RailSync }) {
  // useSearchParams needs a boundary; the fallback is the rail with nothing marked yet.
  return (
    <Suspense fallback={null}>
      <RailInner isOwner={isOwner} isStaff={isStaff} sync={sync} />
    </Suspense>
  );
}
