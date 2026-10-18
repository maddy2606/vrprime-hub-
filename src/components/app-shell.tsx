import { cookies } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { PushPrompt } from "@/components/notifications/push-prompt";
import { CommandBar } from "@/components/shell/command-bar";
import { Rail } from "@/components/shell/rail";
import { ThemeSwitch } from "@/components/shell/theme-switch";
import { buttonClass } from "@/components/ui";
import { ROLE_LABEL } from "@/lib/labels";
import { readThemeMode, THEME_COOKIE } from "@/lib/theme-mode";
import type { SessionUser } from "@/lib/types";

/**
 * The shell: a 72px icon rail (a bottom bar on phones), the command bar on top of every page, and the page.
 */
export async function AppShell({
  user,
  unread = 0,
  money = false,
  scope,
  syncedAt,
  children,
}: {
  user: Pick<SessionUser, "name" | "role" | "email"> & { id?: string };
  /** Notifications this person has not opened yet. */
  unread?: number;
  /** Owner only, and only while Money is switched on in Settings. */
  money?: boolean;
  /** "All warehouses", or the names of the warehouses a warehouse user works at. */
  scope: string;
  /** When the orders were last read from Flipkart. */
  syncedAt: string | null;
  children: ReactNode;
}) {
  const theme = readThemeMode((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <div className="min-[561px]:pl-[72px]">
      <Rail isOwner={user.role === "owner"} isStaff={user.role !== "warehouse"} />
      <CommandBar
        user={{ name: user.name, role: user.role, sub: `${ROLE_LABEL[user.role]}${user.email ? ` · ${user.email}` : ""}` }}
        unread={unread}
        scope={scope}
        syncedAt={syncedAt}
        menu={
          <>
            <ThemeSwitch initial={theme} />
            {money ? (
              <Link prefetch={false} href="/money" className={buttonClass("outline", "w-full")}>
                Money
              </Link>
            ) : null}
            <Link prefetch={false} href="/notifications" className={buttonClass("outline", "w-full")}>
              Notifications
            </Link>
            <Link prefetch={false} href="/change-password" className={buttonClass("outline", "w-full")}>
              Change password
            </Link>
            <SignOutButton className={buttonClass("outline", "w-full")} />
          </>
        }
      />
      <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-5 min-[561px]:pb-12 lg:px-8 lg:pt-7">
        {user.id ? <PushPrompt userId={user.id} /> : null}
        {children}
      </main>
    </div>
  );
}
