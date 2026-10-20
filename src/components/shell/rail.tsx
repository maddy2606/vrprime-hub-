"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
import { BoardIcon, BoxIcon, DashIcon, DeckIcon, GaugeIcon, MoreIcon, ReceiptIcon, RupeeIcon, SlidersIcon, TicketIcon, TrendIcon, UsersIcon } from "@/components/icons";
import { Sheet } from "@/components/shell/sheet";

type Item = { key: string; href: string; label: string; icon: (p: { className?: string }) => ReactNode };

/**
 * The rail, in order: Command Deck, Dashboard (owner), Work board, Tickets, Flipkart, Forecast, Team (owner and admin), Expenses, P&L, People, Settings (owner).
 * On a phone it is a bottom bar of five: Deck, Flipkart, Forecast and Team, with the rest under More.
 */
function items(isOwner: boolean, isStaff: boolean): Item[] {
  return [
    { key: "deck", href: "/", label: "Command Deck", icon: DeckIcon },
    ...(isOwner ? [{ key: "dashboard", href: "/dashboard", label: "Dashboard", icon: DashIcon }] : []),
    { key: "work", href: "/work", label: "Work board", icon: BoardIcon },
    { key: "tickets", href: "/tickets", label: "Tickets", icon: TicketIcon },
    { key: "flipkart", href: "/flipkart", label: "Flipkart", icon: BoxIcon },
    { key: "forecast", href: "/flipkart?tab=forecast", label: "Forecast", icon: TrendIcon },
    ...(isStaff ? [{ key: "team", href: "/team", label: "Team", icon: GaugeIcon }] : []),
    ...(isOwner
      ? [
          { key: "expenses", href: "/expenses", label: "Expenses", icon: ReceiptIcon },
          { key: "pnl", href: "/pnl", label: "P&L", icon: RupeeIcon },
          { key: "people", href: "/admin/users", label: "People", icon: UsersIcon },
          { key: "settings", href: "/admin/settings", label: "Settings", icon: SlidersIcon },
        ]
      : []),
  ];
}

function activeKey(pathname: string, tab: string | null): string {
  if (pathname === "/") return "deck";
  if (pathname.startsWith("/dashboard")) return "dashboard";
  if (pathname.startsWith("/flipkart")) return tab === "forecast" ? "forecast" : "flipkart";
  if (pathname === "/work" || pathname === "/all" || pathname.startsWith("/posts")) return "work";
  if (pathname.startsWith("/tickets")) return "tickets";
  if (pathname.startsWith("/team")) return "team";
  if (pathname.startsWith("/expenses")) return "expenses";
  if (pathname.startsWith("/pnl")) return "pnl";
  if (pathname.startsWith("/admin/users")) return "people";
  if (pathname.startsWith("/admin/settings")) return "settings";
  return "";
}

function RailInner({ isOwner, isStaff }: { isOwner: boolean; isStaff: boolean }) {
  const pathname = usePathname();
  const tab = useSearchParams().get("tab");
  const active = activeKey(pathname, tab);
  const list = items(isOwner, isStaff);
  return (
    <>
      {/* Slim icon rail, 72px, from 561px up */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[72px] flex-col items-center border-r border-line-soft bg-panel2/90 py-4 backdrop-blur min-[561px]:flex">
        <Link prefetch={false} href="/" aria-label="VR Prime Ops, Command Deck" className="focus-ring font-display mb-6 flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-base font-semibold text-accent-ink sp-glow">
          VR
        </Link>
        <nav aria-label="Main" className="flex flex-1 flex-col items-center gap-2">
          {list.map((item) => {
            const on = active === item.key;
            return (
              <Link
                prefetch={false}
                key={item.key}
                href={item.href}
                aria-label={item.label}
                aria-current={on ? "page" : undefined}
                className={`focus-ring group relative flex h-12 w-12 items-center justify-center rounded-2xl transition ${
                  on ? "bg-accent-soft text-accent-text" : "text-muted hover:-translate-y-px hover:bg-surface2 hover:text-ink"
                }`}
              >
                {on ? <span aria-hidden="true" className="absolute -left-[12px] h-6 w-[3px] rounded-r-full bg-madder" /> : null}
                <item.icon className="h-[22px] w-[22px]" />
                <span
                  role="tooltip"
                  className="pointer-events-none absolute left-[58px] z-50 whitespace-nowrap rounded-lg bg-accent px-2.5 py-1.5 text-xs font-bold text-accent-ink opacity-0 shadow-lg transition group-hover:opacity-100 group-focus-visible:opacity-100"
                >
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <BottomBar list={list} active={active} />
    </>
  );
}

/** Short names for the bottom bar, where each slot is a fifth of a phone's width. */
const SHORT: Record<string, string> = { deck: "Deck", work: "Work", tickets: "Tickets", flipkart: "Flipkart", forecast: "Forecast", team: "Team", expenses: "Expenses", people: "People", settings: "Settings" };

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
    `focus-ring flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-bold transition ${on ? "text-accent-text" : "text-muted active:text-ink"}`;
  const pill = (on: boolean) => `flex h-8 w-14 items-center justify-center rounded-full transition ${on ? "bg-accent-soft" : ""}`;

  return (
    <>
      {/* Bottom bar, 560px and under */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-panel2/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md min-[561px]:hidden"
      >
        <ul className="grid" style={{ gridTemplateColumns: `repeat(${slots}, minmax(0, 1fr))` }}>
          {bar.map((item) => {
            const on = active === item.key;
            return (
              <li key={item.key}>
                <Link prefetch={false} href={item.href} aria-current={on ? "page" : undefined} className={slotClass(on)}>
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
        <ul className="grid grid-cols-2 gap-2.5 pb-2">
          {more.map((item) => {
            const on = active === item.key;
            return (
              <li key={item.key}>
                <Link
                  prefetch={false}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  aria-current={on ? "page" : undefined}
                  className={`focus-ring flex min-h-[4.5rem] items-center gap-3 rounded-2xl border px-3.5 py-3 text-sm font-bold transition ${
                    on ? "border-accent/60 bg-accent-soft text-accent-text" : "border-line bg-surface text-ink active:bg-surface2"
                  }`}
                >
                  <span aria-hidden="true" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${on ? "bg-accent text-accent-ink" : "bg-surface2 text-muted"}`}>
                    <item.icon className="h-5 w-5" />
                  </span>
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
