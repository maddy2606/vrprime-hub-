"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Bar = "idle" | "running" | "done";

/** Whether a click on this link starts an in-app navigation to another page (not a new tab, download or same page). */
function startsNavigation(e: MouseEvent): boolean {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return false;
  const to = new URL(a.href, location.href);
  if (to.origin !== location.origin) return false;
  return to.pathname + to.search !== location.pathname + location.search;
}

/**
 * The 2 px gradient bar along the very top while a page is on its way (owner-approved exception to graphite-spec
 * section 1). It starts on a click on an in-app link, creeps towards the end, and runs out and fades when the address
 * changes. A link that goes nowhere stops it after 12 seconds.
 */
export function NavProgress() {
  const path = usePathname();
  const search = useSearchParams().toString();
  const [bar, setBar] = useState<Bar>("idle");
  const [width, setWidth] = useState(0);
  const timers = useRef<number[]>([]);
  const running = useRef(false);
  const finishRef = useRef<() => void>(() => undefined);

  const clear = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  useEffect(() => {
    const finish = () => {
      clear();
      running.current = false;
      setBar("done");
      setWidth(100);
      timers.current.push(window.setTimeout(() => setBar("idle"), 600));
    };
    const onClick = (e: MouseEvent) => {
      if (!startsNavigation(e)) return;
      clear();
      running.current = true;
      setBar("running");
      setWidth(0);
      // Next frame: from 0 towards 85%, slowing as it goes (the CSS transition).
      timers.current.push(window.setTimeout(() => setWidth(85), 20));
      timers.current.push(window.setTimeout(finish, 12_000));
    };
    // Capture: before Next's Link handler, which cancels the click to navigate in place.
    document.addEventListener("click", onClick, true);
    finishRef.current = () => {
      if (running.current) finish();
    };
    return () => {
      document.removeEventListener("click", onClick, true);
      clear();
    };
  }, []);

  // The new page has arrived.
  useEffect(() => {
    finishRef.current();
  }, [path, search]);

  if (bar === "idle") return null;
  return <div aria-hidden="true" className="vr-nav-bar" data-state={bar} style={{ width: `${width}%`, opacity: bar === "done" ? 0 : 1 }} />;
}
