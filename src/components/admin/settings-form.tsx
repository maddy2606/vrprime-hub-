"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useToast } from "@/components/toast";
import { buttonClass, Field } from "@/components/ui";
import { fieldErrors, settingsSchema } from "@/lib/validation";
import { saveSettings } from "@/server/actions/settings";

export type SettingsValues = {
  low_stock_threshold: string;
  weight_alert_limit: string;
  new_inactive_days: string;
  price_drop_percent: string;
  dispatch_sla_days: string;
  running_out_days: string;
  return_rate_percent: string;
  money_low_margin_percent: string;
  money_default_fee_percent: string;
  money_unpaid_after_days: string;
  money_fee_deviation_points: string;
  money_upload_reminder_days: string;
  money_keep_months: string;
};
type Values = SettingsValues;

export function SettingsForm({ initial }: { initial: SettingsValues }) {
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
      <h2 className="mt-2 text-base font-extrabold">Flipkart page</h2>
      <Field
        label="Price drop alert (%)"
        htmlFor="price_drop_percent"
        required
        error={errors.price_drop_percent}
        hint="Flag a SKU whose selling price fell overnight by more than this percent. Normal setting: 15."
      >
        <input id="price_drop_percent" className="input" inputMode="numeric" value={values.price_drop_percent} onChange={(e) => set("price_drop_percent", e.target.value)} aria-invalid={Boolean(errors.price_drop_percent)} />
      </Field>
      <Field
        label="Slow dispatch: days"
        htmlFor="dispatch_sla_days"
        required
        error={errors.dispatch_sla_days}
        hint="Listing health flags a listing whose dispatch SLA on Flipkart is more than this many days. Normal setting: 2."
      >
        <input id="dispatch_sla_days" className="input" inputMode="numeric" value={values.dispatch_sla_days} onChange={(e) => set("dispatch_sla_days", e.target.value)} aria-invalid={Boolean(errors.dispatch_sla_days)} />
      </Field>
      <Field
        label="Running out soon: days of cover"
        htmlFor="running_out_days"
        required
        error={errors.running_out_days}
        hint="Flag a SKU at a warehouse when its units would last fewer than this many days at the recent sales rate. Normal setting: 7."
      >
        <input id="running_out_days" className="input" inputMode="numeric" value={values.running_out_days} onChange={(e) => set("running_out_days", e.target.value)} aria-invalid={Boolean(errors.running_out_days)} />
      </Field>
      <Field
        label="High return rate (%)"
        htmlFor="return_rate_percent"
        required
        error={errors.return_rate_percent}
        hint="Flag a SKU when returns are more than this percent of the units sold in the last 30 days (needs at least 10 units sold). Normal setting: 10."
      >
        <input id="return_rate_percent" className="input" inputMode="numeric" value={values.return_rate_percent} onChange={(e) => set("return_rate_percent", e.target.value)} aria-invalid={Boolean(errors.return_rate_percent)} />
      </Field>
      <h2 className="mt-2 text-base font-extrabold">Money (owner only)</h2>
      <Field
        label="Low margin (%)"
        htmlFor="money_low_margin_percent"
        required
        error={errors.money_low_margin_percent}
        hint="Needs action flags a SKU whose profit margin over the last 30 days of settlements is under this. Normal setting: 10."
      >
        <input id="money_low_margin_percent" className="input" inputMode="numeric" value={values.money_low_margin_percent} onChange={(e) => set("money_low_margin_percent", e.target.value)} aria-invalid={Boolean(errors.money_low_margin_percent)} />
      </Field>
      <Field
        label="Default fee (%)"
        htmlFor="money_default_fee_percent"
        required
        error={errors.money_default_fee_percent}
        hint="Used to estimate the profit on unsettled orders for a SKU that has no recent settlements. Normal setting: 12."
      >
        <input id="money_default_fee_percent" className="input" inputMode="numeric" value={values.money_default_fee_percent} onChange={(e) => set("money_default_fee_percent", e.target.value)} aria-invalid={Boolean(errors.money_default_fee_percent)} />
      </Field>
      <Field
        label="Unpaid after (days)"
        htmlFor="money_unpaid_after_days"
        required
        error={errors.money_unpaid_after_days}
        hint="An order shipped more than this many days before the latest settlement day, with no money line, is listed as unpaid. Normal setting: 15."
      >
        <input id="money_unpaid_after_days" className="input" inputMode="numeric" value={values.money_unpaid_after_days} onChange={(e) => set("money_unpaid_after_days", e.target.value)} aria-invalid={Boolean(errors.money_unpaid_after_days)} />
      </Field>
      <Field
        label="Fee deviation (points)"
        htmlFor="money_fee_deviation_points"
        required
        error={errors.money_fee_deviation_points}
        hint="A fee is flagged when it is this many percentage points of the sale price above (or, for commission, away from) what the SKU usually pays. Normal setting: 2."
      >
        <input id="money_fee_deviation_points" className="input" inputMode="numeric" value={values.money_fee_deviation_points} onChange={(e) => set("money_fee_deviation_points", e.target.value)} aria-invalid={Boolean(errors.money_fee_deviation_points)} />
      </Field>
      <Field
        label="Upload reminder (days)"
        htmlFor="money_upload_reminder_days"
        required
        error={errors.money_upload_reminder_days}
        hint="You get a notification when no settlement report has been uploaded for this many days. Normal setting: 14."
      >
        <input id="money_upload_reminder_days" className="input" inputMode="numeric" value={values.money_upload_reminder_days} onChange={(e) => set("money_upload_reminder_days", e.target.value)} aria-invalid={Boolean(errors.money_upload_reminder_days)} />
      </Field>
      <Field
        label="Months of money data to keep"
        htmlFor="money_keep_months"
        required
        error={errors.money_keep_months}
        hint="Older settlement lines are deleted when a report is uploaded. The free database holds about three months at your volume, so 12 only fits on a paid plan."
      >
        <input id="money_keep_months" className="input" inputMode="numeric" value={values.money_keep_months} onChange={(e) => set("money_keep_months", e.target.value)} aria-invalid={Boolean(errors.money_keep_months)} />
      </Field>
      <button type="submit" disabled={pending} className={buttonClass("primary", "sm:self-start sm:min-w-40")}>
        {pending ? "Saving…" : "Save settings"}
      </button>
    </form>
  );
}
