"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { ActionResult } from "@/lib/types";

type Toast = { id: number; message: string; tone: "ok" | "bad" };
type ToastApi = {
  show: (message: string, tone?: Toast["tone"]) => void;
  /** Shows the message of a server action result and returns whether it succeeded. */
  result: (result: ActionResult<unknown>) => boolean;
};

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const show = useCallback<ToastApi["show"]>((message, tone = "ok") => {
    const id = nextId.current++;
    setToasts((list) => [...list.slice(-2), { id, message, tone }]);
    window.setTimeout(
      () => setToasts((list) => list.filter((t) => t.id !== id)),
      tone === "bad" ? 6000 : 3500,
    );
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      result: (result) => {
        show(result.message, result.ok ? "ok" : "bad");
        return result.ok;
      },
    }),
    [show],
  );

  return (
    <ToastContext value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`toast pointer-events-auto max-w-sm rounded-lg px-4 py-3 text-sm font-semibold shadow-lg ${
              t.tone === "ok" ? "bg-ink text-canvas" : "bg-bad text-canvas"
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside ToastProvider");
  return api;
}
