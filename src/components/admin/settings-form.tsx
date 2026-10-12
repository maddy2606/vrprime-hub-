"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useToast } from "@/components/toast";
import { buttonClass, Field } from "@/components/ui";
import { fieldErrors, settingsSchema } from "@/lib/validation";
import { saveSettings } from "@/server/actions/settings";

type Values = { low_stock_threshold: string; weight_alert_limit: string; new_inactive_days: string };

export function SettingsForm({ initial }: { initial: Values }) {
  const router = useRouter();
  const toast = useToast();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const set = (key: keyof Values, value: string) => {
    setValues((v) => ({ ...v, [key]: value.replace(/\D/g, "") }));
    setErrors((e) => {
      const rest = { ...e };
      delete rest[key];
      return rest;
    });
  };

  const submit = () => {
    const parsed = settingsSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      toast.show("Check the highlighted fields.", "bad");
      return;
    }
    startTransition(async () => {
      const result = await saveSettings(values);
      if (!result.ok) setErrors(result.fieldErrors ?? {});
      if (toast.result(result)) router.refresh();
    });
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-4"
    >
      <Field
        label="Low stock level (units)"
        htmlFor="low_stock_threshold"
        required
        error={errors.low_stock_threshold}
        hint="A warehouse counts as low when it has fewer units of a SKU than this, but not zero. Normal setting: 100."
      >
        <input id="low_stock_threshold" className="input" inputMode="numeric" value={values.low_stock_threshold} onChange={(e) => set("low_stock_threshold", e.target.value)} aria-invalid={Boolean(errors.low_stock_threshold)} />
      </Field>
      <Field
        label="Weight alert limit"
        htmlFor="weight_alert_limit"
        required
        error={errors.weight_alert_limit}
        hint="A listing is flagged when length × breadth × height (in cm) plus its weight in grams is over this. Listings with no size are skipped. Normal setting: 2,000."
      >
        <input id="weight_alert_limit" className="input" inputMode="numeric" value={values.weight_alert_limit} onChange={(e) => set("weight_alert_limit", e.target.value)} aria-invalid={Boolean(errors.weight_alert_limit)} />
      </Field>
      <Field
        label="New inactive: days"
        htmlFor="new_inactive_days"
        required
        error={errors.new_inactive_days}
        hint="A listing counts as newly inactive if it went inactive within this many days. Normal setting: 2."
      >
        <input id="new_inactive_days" className="input" inputMode="numeric" value={values.new_inactive_days} onChange={(e) => set("new_inactive_days", e.target.value)} aria-invalid={Boolean(errors.new_inactive_days)} />
      </Field>
      <button type="submit" disabled={pending} className={buttonClass("primary", "sm:self-start sm:min-w-40")}>
        {pending ? "Saving…" : "Save settings"}
      </button>
    </form>
  );
}
