import type { Metadata } from "next";
import { OwnerOnly } from "@/components/owner-only";
import { SettingsForm } from "@/components/admin/settings-form";
import { PageTitle } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_FLIPKART_SETTINGS } from "@/lib/flipkart-analysis";
import { SETTING_KEYS } from "@/lib/settings-keys";
import { DEFAULT_SETTINGS } from "@/server/stock-data";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const me = await requireUser();
  if (me.role !== "owner") return <OwnerOnly />;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", SETTING_KEYS);
  if (error) throw new Error("Could not load settings");

  const read = (key: string, fallback: number) => {
    const n = Number(data.find((row) => row.key === key)?.value);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle title="Settings" sub="Thresholds for the Flipkart page. They apply the next time anyone opens it." />
      <SettingsForm
        initial={{
          low_stock_threshold: String(read("low_stock_threshold", DEFAULT_SETTINGS.low)),
          weight_alert_limit: String(read("weight_alert_limit", DEFAULT_SETTINGS.weightLimit)),
          new_inactive_days: String(read("new_inactive_days", DEFAULT_SETTINGS.newInactiveDays)),
          price_drop_percent: String(read("price_drop_percent", DEFAULT_FLIPKART_SETTINGS.priceDropPercent)),
          dispatch_sla_days: String(read("dispatch_sla_days", DEFAULT_FLIPKART_SETTINGS.dispatchSlaDays)),
          running_out_days: String(read("running_out_days", DEFAULT_FLIPKART_SETTINGS.runningOutDays)),
          return_rate_percent: String(read("return_rate_percent", DEFAULT_FLIPKART_SETTINGS.returnRatePercent)),
          money_low_margin_percent: String(read("money_low_margin_percent", 10)),
          money_default_fee_percent: String(read("money_default_fee_percent", 12)),
          money_unpaid_after_days: String(read("money_unpaid_after_days", 15)),
          money_fee_deviation_points: String(read("money_fee_deviation_points", 2)),
          money_upload_reminder_days: String(read("money_upload_reminder_days", 14)),
          money_keep_months: String(read("money_keep_months", 12)),
        }}
      />
    </div>
  );
}
