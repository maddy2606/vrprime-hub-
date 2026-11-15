import type { ReactNode } from "react";

/** The three order stages as a small still picture of the warehouse lanes: the same mark the app opens on. */
function LaneMark() {
  const lanes = [
    [18, 26, 44],
    [10, 14, 34],
    [24, 20, 50],
  ];
  return (
    <div aria-hidden="true" className="mb-5 flex w-24 flex-col gap-1.5">
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
    <main className="mx-auto flex min-h-dvh w-full max-w-[432px] flex-col justify-center px-4 py-10">
      <div className="mb-6 flex flex-col items-center text-center">
        <LaneMark />
        <p className="font-display text-[20px] font-semibold leading-tight">VR Prime Ops</p>
        <p className="t-caption mt-1">Tasks, problems and stock</p>
      </div>
      <div className="sp-card g-pad w-full">{children}</div>
    </main>
  );
}
