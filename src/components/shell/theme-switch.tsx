"use client";

import { useState } from "react";
import { applyThemeMode } from "@/lib/theme-client";
import type { ThemeMode } from "@/lib/theme-mode";

const OPTIONS: { mode: ThemeMode; label: string }[] = [
  { mode: "light", label: "Light" },
  { mode: "dark", label: "Dark" },
  { mode: "auto", label: "Auto" },
];

/**
 * Light, Dark or Auto, in the account menu. The page changes at once (the colours are CSS variables chosen by
 * data-theme on <html>), and the choice is saved in a cookie for a year so the server paints it on the next visit.
 * Auto removes both and lets the phone or computer decide.
 */
export function ThemeSwitch({ initial }: { initial: ThemeMode }) {
  const [mode, setMode] = useState<ThemeMode>(initial);

  const choose = (next: ThemeMode) => {
    setMode(next);
    applyThemeMode(next);
  };

  return (
    // The account menu closes on any click inside it; choosing a theme should leave it open so the change can be seen.
    <div onClick={(e) => e.stopPropagation()}>
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">Theme</p>
      <div role="group" aria-label="Colour theme" className="grid grid-cols-3 gap-1 rounded-xl bg-line-soft p-1">
        {OPTIONS.map((o) => {
          const on = mode === o.mode;
          return (
            <button
              key={o.mode}
              type="button"
              aria-pressed={on}
              onClick={() => choose(o.mode)}
              className={`focus-ring min-h-11 rounded-lg text-sm font-bold transition ${on ? "bg-accent text-accent-ink" : "text-muted hover:bg-surface hover:text-ink"}`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
