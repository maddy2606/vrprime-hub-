"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useToast } from "@/components/toast";
import { buttonClass } from "@/components/ui";
import { setMoneyEnabled } from "@/server/actions/settings";

/** Money (settlement reports, costs, profit) is shelved until it is switched on here. */
export function MoneySwitch({ initial }: { initial: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [on, setOn] = useState(initial);
  const [pending, startTransition] = useTransition();
  return (
    <div className="mb-6 rounded-xl border border-line bg-surface p-4">
      <p className="text-base font-extrabold">Money</p>
      <p className="mt-1 text-sm text-muted">
        Settlement reports, SKU costs, profit per SKU and the settlement checks. While it is off there is no Money page or menu link and nothing in Needs action.
        Switching it on needs the reports uploaded again (Money &gt; Uploads).
      </p>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await setMoneyEnabled(!on);
            if (toast.result(result)) {
              setOn(!on);
              router.refresh();
            }
          })
        }
        className={buttonClass(on ? "secondary" : "primary", "mt-3")}
      >
        {pending ? "Saving…" : on ? "Money is on: turn it off" : "Money is off: turn it on"}
      </button>
    </div>
  );
}
