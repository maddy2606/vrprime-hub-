"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { BoardIcon, BoxIcon, DeckIcon, SlidersIcon, TicketIcon, TrendIcon, UsersIcon } from "@/components/icons";

type Item = { key: string; href: string; label: string; icon: (p: { className?: string }) => ReactNode };

/** The rail, in order: Command Deck, Work board, Tickets, Flipkart, Forecast, People, Settings. */
function items(isOwner: boolean): Item[] {
  return [
    { key: "deck", href: "/", label: "Command Deck", icon: DeckIcon },
    { key: "work", href: "/work", label: "Work board", icon: BoardIcon },
    { key: "tickets", href: "/tickets", label: "Tickets", icon: TicketIcon },
    { key: "flipkart", href: "/flipkart", label: "Flipkart", icon: BoxIcon },
    { key: "forecast", href: "/flipkart?tab=forecast", label: "Forecast", icon: TrendIcon },
    ...(isOwner
      ? [
          { key: "people", href: "/admin/users", label: "People", icon: UsersIcon },
          { key: "settings", href: "/admin/settings", label: "Settings", icon: SlidersIcon },
        ]
      : []),
  ];
}

function activeKey(pathname: string, tab: string | null): string {
  if (pathname === "/") return "deck";
  if (pathname.startsWith("/flipkart")) return tab === "forecast" ? "forecast" : "flipkart";
  if (pathname === "/work" || pathname === "/all" || pathname.startsWith("/posts")) return "work";
  if (pathname.startsWith("/tickets")) return "tickets";
  if (pathname.startsWith("/admin/users")) return "people";
  if (pathname.startsWith("/admin/settings")) return "settings";
  return "";
}

function RailInner({ isOwner }: { isOwner: boolean }) {
  const pathname = usePathname();
  const tab = useSearchParams().get("tab");
  const active = activeKey(pathname, tab);
  const list = items(isOwner);
  return (
    <>
      {/* Slim icon rail, 72px, from 561px up */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[72px] flex-col items-center border-r border-line-soft bg-panel2/90 py-4 backdrop-blur min-[561px]:flex">
        <Link prefetch={false} href="/" aria-label="VR Prime Ops, Command Deck" className="focus-ring mb-6 flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-sm font-extrabold text-white sp-glow">
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
                {on ? <span aria-hidden="true" className="absolute -left-[12px] h-6 w-[3px] rounded-r-full bg-accent shadow-[0_0_12px_2px_rgba(139,92,246,0.8)]" /> : null}
                <item.icon className="h-[22px] w-[22px]" />
                <span
                  role="tooltip"
                  className="pointer-events-none absolute left-[58px] z-50 whitespace-nowrap rounded-lg border border-line bg-surface2 px-2.5 py-1.5 text-xs font-bold text-ink opacity-0 shadow-xl transition group-hover:opacity-100 group-focus-visible:opacity-100"
                >
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Bottom bar, 560px and under */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-panel2/95 pb-[env(safe-area-inset-bottom)] backdrop-blur min-[561px]:hidden"
      >
        <ul className="grid" style={{ gridTemplateColumns: `repeat(${list.length}, minmax(0, 1fr))` }}>
          {list.map((item) => {
            const on = active === item.key;
            return (
              <li key={item.key}>
                <Link
                  prefetch={false}
                  href={item.href}
                  aria-current={on ? "page" : undefined}
                  className={`focus-ring relative flex h-16 min-h-11 flex-col items-center justify-center gap-0.5 text-[10px] font-bold ${on ? "text-accent-text" : "text-muted"}`}
                >
                  {on ? <span aria-hidden="true" className="absolute top-0 h-[3px] w-8 rounded-b-full bg-accent shadow-[0_0_12px_2px_rgba(139,92,246,0.8)]" /> : null}
                  <item.icon className="h-6 w-6" />
                  <span className="max-w-full truncate px-0.5">{item.label.replace("Command Deck", "Deck").replace("Work board", "Work")}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}

export function Rail({ isOwner }: { isOwner: boolean }) {
  // useSearchParams needs a boundary; the fallback is the rail with nothing marked yet.
  return (
    <Suspense fallback={null}>
      <RailInner isOwner={isOwner} />
    </Suspense>
  );
}
