"use client";

import { useEffect, useId, useRef, type ReactNode, type TouchEvent as ReactTouchEvent } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "@/components/icons";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A panel over the page. On a phone it is a bottom sheet (drag the handle down to close); on a bigger screen it is either a
 * panel under the top bar on the right ("popover", for the alerts) or a sheet centred at the bottom ("sheet"). The page
 * behind is dimmed and stays still; Escape or a tap outside closes it, and focus goes back to what opened it.
 * It is drawn into <body>, so a blurred parent (the top bar, the bottom bar) cannot trap it.
 */
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  headerAction,
  footer,
  variant = "sheet",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  headerAction?: ReactNode;
  footer?: ReactNode;
  variant?: "sheet" | "popover";
  children: ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
        return;
      }
      if (e.key !== "Tab" || !panel.current) return;
      // Keep Tab inside the panel.
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      opener?.focus({ preventScroll: true });
    };
  }, [open]);

  // Drag the top of the sheet down to close it (phones).
  const drag = useRef<{ y: number; dy: number } | null>(null);
  const onTouchStart = (e: ReactTouchEvent) => {
    drag.current = { y: e.touches[0].clientY, dy: 0 };
  };
  const onTouchMove = (e: ReactTouchEvent) => {
    if (!drag.current || !panel.current) return;
    const dy = Math.max(0, e.touches[0].clientY - drag.current.y);
    drag.current.dy = dy;
    panel.current.style.transform = dy ? `translateY(${dy}px)` : "";
  };
  const onTouchEnd = () => {
    const dy = drag.current?.dy ?? 0;
    drag.current = null;
    if (!panel.current) return;
    if (dy > 90) {
      close.current();
    } else {
      panel.current.style.transition = "transform 160ms ease-out";
      panel.current.style.transform = "";
      window.setTimeout(() => {
        if (panel.current) panel.current.style.transition = "";
      }, 170);
    }
  };

  if (!open) return null;

  const place =
    variant === "popover"
      ? "sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-[76px] sm:w-[440px] sm:max-h-[min(82vh,760px)] sm:rounded-[26px] vr-pop"
      : "sm:mx-auto sm:max-w-lg";

  return createPortal(
    <div className="fixed inset-0 z-[70]">
      <div aria-hidden="true" onClick={() => close.current()} className="vr-scrim absolute inset-0 bg-scrim backdrop-blur-[3px]" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`vr-sheet absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col overflow-hidden rounded-t-[28px] border border-line bg-panel2 shadow-[0_-18px_50px_-20px_rgba(0,0,0,0.6)] outline-none ${place}`}
      >
        <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} className="touch-none sm:touch-auto">
          <div className="flex justify-center pt-2.5 sm:hidden" aria-hidden="true">
            <span className="h-1.5 w-11 rounded-full bg-line" />
          </div>
          <header className="flex items-start gap-2 px-5 pb-3 pt-2 sm:pt-5">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="font-display text-xl font-semibold tracking-tight">
                {title}
              </h2>
              {subtitle ? <p className="mt-0.5 text-sm text-muted">{subtitle}</p> : null}
            </div>
            {headerAction}
            <button
              type="button"
              onClick={() => close.current()}
              aria-label="Close"
              className="focus-ring -mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-surface2 hover:text-ink"
            >
              <CloseIcon className="h-5 w-5" />
            </button>
          </header>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">{children}</div>
        {footer ? (
          <div className="border-t border-line-soft bg-panel2 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>
        ) : (
          <div className="pb-[env(safe-area-inset-bottom)]" />
        )}
      </div>
    </div>,
    document.body,
  );
}
