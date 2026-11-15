import type { ReactNode } from "react";

/** The three order stages as a small still picture of the warehouse lanes: the same mark the app opens on. */
function LaneMark() {
  const lanes = [
    [18, 26, 44],
    [10, 14, 34],
    [24, 20, 50],
  ];
  return (
    <div aria-hidden="true" className="mb-8 flex flex-col gap-1.5">
      {lanes.map((l, i) => (
        <div key={i} className="flex h-2 gap-[2px] rounded-full bg-surface2">
          <span className="rounded-l-full" style={{ width: `${l[0]}%`, background: "var(--stage-1)" }} />
          <span style={{ width: `${l[1]}%`, background: "var(--stage-2)" }} />
          <span className="rounded-r-full" style={{ width: `${l[2] - 10}%`, background: "var(--stage-3)" }} />
        </div>
      ))}
    </div>
  );
}

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4 py-10">
      <LaneMark />
      <div className="mb-6 flex items-center gap-3">
        <span className="font-display flex h-11 w-11 items-center justify-center rounded-lg bg-ink text-base font-bold tracking-tight text-canvas">VR</span>
        <div>
          <p className="font-display text-xl font-semibold leading-tight tracking-[-0.02em]">VR Prime Ops</p>
          <p className="text-sm text-muted">Tasks, problems and stock</p>
        </div>
      </div>
      <div className="sp-card p-5">{children}</div>
    </main>
  );
}
