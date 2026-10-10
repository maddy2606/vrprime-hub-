import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-base font-extrabold text-accent-ink">
          VR
        </span>
        <div>
          <p className="text-lg font-extrabold leading-tight tracking-tight">VR Prime Ops</p>
          <p className="text-sm text-muted">Tasks, problems and stock</p>
        </div>
      </div>
      <div className="rounded-xl border border-line bg-surface p-5">{children}</div>
    </main>
  );
}
