"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
import { BoardIcon, BoxIcon, DashIcon, DeckIcon, GaugeIcon, MegaphoneIcon, MoreIcon, StarIcon, RupeeIcon, SlidersIcon, TicketIcon, TrendIcon, UsersIcon } from "@/components/icons";
import { Sheet } from "@/components/shell/sheet";

type Item = { key: string; href: string; label: string; icon: (p: { className?: string }) => ReactNode };
type Group = { label: string; items: Item[] };

/**
 * The navigation, in three groups. Operate: Command Deck, Dashboard (owner), Work board, Tickets, Team (owner and
 * admin). Marketplace: Flipkart, Forecast, Ads tracker and Review tracker (owner and admin). Admin (owner): P&L,
 * People, Settings. Who sees what is exactly as before; only the grouping and the labels are new.
 * On a phone it is a bottom bar of five: Deck, Flipkart, Forecast and Team, with the rest under More.
 */
function groups(isOwner: boolean, isStaff: boolean): Group[] {
  const operate: Item[] = [
    { key: "deck", href: "/", label: "Command Deck", icon: DeckIcon },
    ...(isOwner ? [{ key: "dashboard", href: "/dashboard", label: "Dashboard", icon: DashIcon }] : []),
    { key: "work", href: "/work", label: "Work board", icon: BoardIcon },
    { key: "tickets", href: "/tickets", label: "Tickets", icon: TicketIcon },
    ...(isStaff ? [{ key: "team", href: "/team", label: "Team", icon: GaugeIcon }] : []),
  ];
  const marketplace: Item[] = [
    { key: "flipkart", href: "/flipkart", label: "Flipkart", icon: BoxIcon },
    { key: "forecast", href: "/flipkart?tab=forecast", label: "Forecast", icon: TrendIcon },
    ...(isStaff
      ? [
          { key: "ads", href: "/ads", label: "Ads tracker", icon: MegaphoneIcon },
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

function RailInner({ isOwner, isStaff }: { isOwner: boolean; isStaff: boolean }) {
  const pathname = usePathname();
  const tab = useSearchParams().get("tab");
  const active = activeKey(pathname, tab);
  const list = groups(isOwner, isStaff);
  const flat = list.flatMap((g) => g.items);
  return (
    <>
      {/* Sidebar: a 72px icon rail from 561px, the full labelled sidebar from 1100px (see .vr-rail in globals.css). */}
      <aside className="vr-rail fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-line bg-panel2 min-[561px]:flex">
        <Link href="/" aria-label="VR Prime Ops, Command Deck" className="focus-ring mx-3 mt-4 flex h-11 items-center gap-3 rounded-lg px-1.5">
          <span className="font-display flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-ink text-[13px] font-bold tracking-tight text-canvas">VR</span>
          <span className="vr-rail-label font-display text-[15px] font-semibold tracking-tight">VR Prime Ops</span>
        </Link>
        <nav aria-label="Main" className="mt-5 flex flex-1 flex-col gap-5 overflow-y-auto px-3 pb-4">
          {list.map((g) => (
            <div key={g.label}>
              <p className="vr-rail-group mb-1.5 px-2 text-[11px] font-semibold text-faint">{g.label}</p>
              <ul className="flex flex-col gap-0.5">
                {g.items.map((item) => {
                  const on = active === item.key;
                  return (
                    <li key={item.key}>
                      <Link
                        href={item.href}
                        aria-label={item.label}
                        aria-current={on ? "page" : undefined}
                        className={`focus-ring group relative flex h-11 items-center gap-3 rounded-lg px-2.5 text-sm font-semibold transition-colors ${
                          on ? "bg-accent-soft text-accent-text" : "text-muted hover:bg-surface2 hover:text-ink"
                        }`}
                      >
                        {on ? <span aria-hidden="true" className="absolute -left-3 h-6 w-[3px] rounded-r-full bg-accent" /> : null}
                        <item.icon className="h-[21px] w-[21px] shrink-0" />
                        <span className="vr-rail-label truncate">{item.label}</span>
                        <span
                          role="tooltip"
                          className="sp-pop pointer-events-none absolute left-[58px] z-50 whitespace-nowrap px-2.5 py-1.5 text-xs font-semibold text-ink opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 min-[1100px]:hidden"
                        >
                          {item.label}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
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
  const first = ["deck", "flipkart", "forecast", "team"];
  const bar = first.map((k) => list.find((i) => i.key === k)).filter((i): i is Item => Boolean(i)).slice(0, 4);
  return { bar, more: list.filter((i) => !bar.includes(i)) };
}

function BottomBar({ list, active }: { list: Item[]; active: string }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const { bar, more } = splitForPhone(list);
  const moreActive = more.some((i) => i.key === active);
  const slots = bar.length + (more.length ? 1 : 0);
  const slotClass = (on: boolean) =>
    `focus-ring flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors ${on ? "text-accent-text" : "text-muted active:text-ink"}`;
  const pill = (on: boolean) => `flex h-8 w-14 items-center justify-center rounded-full transition-colors ${on ? "bg-accent-soft" : ""}`;
  return (
    <>
      {/* Bottom bar, 560px and under */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-panel2 pb-[env(safe-area-inset-bottom)] min-[561px]:hidden">
        <ul className="grid" style={{ gridTemplateColumns: `repeat(${slots}, minmax(0, 1fr))` }}>
          {bar.map((item) => {
            const on = active === item.key;
            return (
              <li key={item.key}>
                <Link href={item.href} aria-current={on ? "page" : undefined} className={slotClass(on)}>
                  <span aria-hidden="true" className={pill(on)}>
                    <item.icon className="h-[22px] w-[22px]" />
                  </span>
                  <span className="max-w-full truncate px-0.5">{SHORT[item.key] ?? item.label}</span>
                </Link>
              </li>
            );
          })}
          {more.length ? (
            <li>
              <button type="button" onClick={() => setMoreOpen(true)} aria-haspopup="dialog" className={slotClass(moreActive)}>
                <span aria-hidden="true" className={pill(moreActive)}>
                  <MoreIcon className="h-[22px] w-[22px]" />
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
                  className={`focus-ring flex min-h-14 items-center gap-3 rounded-lg border px-3.5 py-3 text-sm font-semibold transition-colors ${
                    on ? "border-accent/50 bg-accent-soft text-accent-text" : "border-line bg-surface text-ink active:bg-surface2"
                  }`}
                >
                  <item.icon className="h-5 w-5 shrink-0 text-muted" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </Sheet>
    </>
  );
}

export function Rail({ isOwner, isStaff }: { isOwner: boolean; isStaff: boolean }) {
  // useSearchParams needs a boundary; the fallback is the rail with nothing marked yet.
  return (
    <Suspense fallback={null}>
      <RailInner isOwner={isOwner} isStaff={isStaff} />
    </Suspense>
  );
}
