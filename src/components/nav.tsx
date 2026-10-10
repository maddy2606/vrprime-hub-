"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BoxIcon, InboxIcon, ListIcon, PlusIcon, TicketIcon, UsersIcon } from "@/components/icons";

type Item = { href: string; label: string; icon: (p: { className?: string }) => ReactNode };

const ITEMS: Item[] = [
  { href: "/", label: "My work", icon: InboxIcon },
  { href: "/all", label: "All", icon: ListIcon },
  { href: "/posts/new", label: "Post", icon: PlusIcon },
  { href: "/tickets", label: "Tickets", icon: TicketIcon },
  { href: "/stock", label: "Stock", icon: BoxIcon },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/all") return pathname === "/all" || (pathname.startsWith("/posts/") && pathname !== "/posts/new");
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Fixed bottom bar on phones. */
export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          const isPost = item.href === "/posts/new";
          return (
            <li key={item.href}>
              <Link prefetch={false}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`focus-ring flex h-16 flex-col items-center justify-center gap-0.5 text-[11px] font-bold ${
                  active ? "text-accent-text" : "text-muted"
                }`}
              >
                {isPost ? (
                  <span className="flex h-10 w-14 items-center justify-center rounded-full bg-accent text-accent-ink">
                    <item.icon className="h-6 w-6" />
                  </span>
                ) : (
                  <item.icon className="h-6 w-6" />
                )}
                <span className={isPost ? "sr-only" : ""}>{isPost ? "New post" : item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Sidebar links on desktop. */
export function SideNav({ showAdmin }: { showAdmin: boolean }) {
  const pathname = usePathname();
  const items = showAdmin ? [...ITEMS, { href: "/admin/users", label: "Users", icon: UsersIcon }] : ITEMS;
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        if (item.href === "/posts/new") {
          return (
            <Link prefetch={false}
              key={item.href}
              href={item.href}
              className="focus-ring my-2 flex min-h-11 items-center justify-center gap-2 rounded-lg bg-accent px-3 text-sm font-bold text-accent-ink hover:opacity-90"
            >
              <PlusIcon className="h-5 w-5" /> Post
            </Link>
          );
        }
        return (
          <Link prefetch={false}
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`focus-ring flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-bold ${
              active ? "bg-accent-soft text-accent-text" : "text-muted hover:bg-surface2 hover:text-ink"
            }`}
          >
            <item.icon className="h-5 w-5" /> {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
