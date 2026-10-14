"use client";

import { useEffect, useRef } from "react";
import { formatNumber } from "@/lib/format";

/**
 * A big number that counts up once on load. The markup always holds the final value, so it is correct without
 * JavaScript and under prefers-reduced-motion (no animation is started then).
 */
export function CountUp({ value, className = "", format = formatNumber }: { value: number; className?: string; format?: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches || value === 0) return;
    const started = performance.now();
    const ms = 900;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / ms);
      const eased = 1 - (1 - t) ** 3;
      el.textContent = format(Math.round(value * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
      else el.textContent = format(value);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      el.textContent = format(value);
    };
  }, [value, format]);
  return (
    <span ref={ref} className={`font-mono tabular-nums ${className}`}>
      {format(value)}
    </span>
  );
}
