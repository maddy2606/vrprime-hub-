import Link from "next/link";
import type { ReactNode } from "react";
import { BottomNav, SideNav } from "@/components/nav";
import { buttonClass } from "@/components/ui";
import { ROLE_LABEL } from "@/lib/labels";
import type { SessionUser } from "@/lib/types";
import { signOut } from "@/server/actions/auth";

function Brand() {
  return (
    <Link prefetch={false} href="/" className="focus-ring flex items-center gap-2 rounded-lg">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-extrabold text-accent-ink">
        VR
      </span>
      <span className="text-base font-extrabold tracking-tight">Prime Ops</span>
    </Link>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function AppShell({
  user,
  children,
}: {
  user: Pick<SessionUser, "name" | "role" | "email">;
  children: ReactNode;
}) {
  const isOwner = user.role === "owner";
  return (
    <div className="lg:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-surface p-4 lg:flex">
        <Brand />
        <div className="mt-6 flex-1">
          <SideNav showAdmin={isOwner} />
        </div>
        <div className="border-t border-line pt-3">
          <p className="truncate text-sm font-bold">{user.name}</p>
          <p className="truncate text-xs text-muted">
            {ROLE_LABEL[user.role]}
            {user.email ? ` · ${user.email}` : ""}
          </p>
          <Link prefetch={false} href="/change-password" className={buttonClass("ghost", "mt-2 w-full")}>
            Change password
          </Link>
          <form action={signOut} className="mt-1">
            <button type="submit" className={buttonClass("secondary", "w-full")}>
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Phone header */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-surface px-4 lg:hidden">
          <Brand />
          <details className="relative">
            <summary
              aria-label="Account menu"
              className="focus-ring flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-full bg-accent-soft text-sm font-extrabold text-accent-text [&::-webkit-details-marker]:hidden"
            >
              {initials(user.name) || "?"}
            </summary>
            <div className="absolute right-0 top-12 w-64 rounded-xl border border-line bg-surface p-3 shadow-xl">
              <p className="truncate text-sm font-bold">{user.name}</p>
              <p className="truncate text-xs text-muted">
                {ROLE_LABEL[user.role]}
                {user.email ? ` · ${user.email}` : ""}
              </p>
              {isOwner ? (
                <Link prefetch={false} href="/admin/users" className={buttonClass("secondary", "mt-3 w-full")}>
                  Manage users
                </Link>
              ) : null}
              <Link prefetch={false} href="/change-password" className={buttonClass("secondary", "mt-2 w-full")}>
                Change password
              </Link>
              <form action={signOut} className="mt-2">
                <button type="submit" className={buttonClass("secondary", "w-full")}>
                  Sign out
                </button>
              </form>
            </div>
          </details>
        </header>

        <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-4 lg:px-8 lg:pb-12 lg:pt-8">{children}</main>
      </div>

      <BottomNav />
    </div>
  );
}
