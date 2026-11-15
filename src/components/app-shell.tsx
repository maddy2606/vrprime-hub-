import { cookies } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { AlertCenter } from "@/components/alerts/alert-center";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { PushPrompt } from "@/components/notifications/push-prompt";
import { CommandBar, SyncControl } from "@/components/shell/command-bar";
import { Rail } from "@/components/shell/rail";
import { ThemeSwitch } from "@/components/shell/theme-switch";
import { buttonClass } from "@/components/ui";
import { ROLE_LABEL } from "@/lib/labels";
import { readThemeMode, THEME_COOKIE } from "@/lib/theme-mode";
import type { NotificationRow, SessionUser } from "@/lib/types";

/**
 * The shell: the sidebar on the left (an icon rail on tablets, a bottom bar on phones), the top bar on every page,
 * and the page itself.
 */
export async function AppShell({
  user,
  unread = 0,
  alerts = [],
  money = false,
  scope,
  syncedAt,
  children,
}: {
  user: Pick<SessionUser, "name" | "role" | "email"> & { id?: string };
  /** Notifications this person has not opened yet. */
  unread?: number;
  /** The newest unread notifications: the alerts panel opens with them when the site opens. */
  alerts?: NotificationRow[];
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
    <div className="vr-shell min-h-dvh">
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
      <main className="vr-page pb-[calc(5.5rem+env(safe-area-inset-bottom))] min-[700px]:pb-12">
        {/* Phone: the sync status (and Sync now for the owner and admin) leaves the top bar and leads the page. */}
        <div className="mb-3 min-[700px]:hidden">
          <SyncControl since={syncedAt} scope={scope} canSync={user.role !== "warehouse"} place="phone" />
        </div>
        {/* The offer to turn on alerts: one line, on the Command Deck only (the component checks the route). */}
        {user.id ? <PushPrompt userId={user.id} /> : null}
        {children}
      </main>
      <AlertCenter initial={alerts} total={unread} />
    </div>
  );
}
