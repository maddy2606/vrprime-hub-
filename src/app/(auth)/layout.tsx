import type { ReactNode } from "react";
import { LiveLogo } from "@/components/ui";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[432px] flex-col justify-center px-4 py-10">
      <div className="mb-6 flex flex-col items-center text-center">
        {/* The mark with its pulsing glow and shine (the sign-in and change-password pages share this layout). */}
        <span className="mb-5">
          <LiveLogo size={64} />
        </span>
        <p className="font-display text-[20px] font-semibold leading-tight">VR Prime Ops</p>
        <p className="t-caption mt-1">Tasks, problems and stock</p>
      </div>
      <div className="sp-card g-pad w-full">{children}</div>
    </main>
  );
}
