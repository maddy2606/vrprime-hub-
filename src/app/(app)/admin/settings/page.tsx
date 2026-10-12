import type { Metadata } from "next";
import { OwnerOnly } from "@/components/owner-only";
import { SettingsForm } from "@/components/admin/settings-form";
import { PageTitle } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_SETTINGS } from "@/server/stock-data";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const me = await requireUser();
  if (me.role !== "owner") return <OwnerOnly />;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", ["low_stock_threshold", "weight_alert_limit", "new_inactive_days"]);
  if (error) throw new Error("Could not load settings");

  const read = (key: string, fallback: number) => {
    const n = Number(data.find((row) => row.key === key)?.value);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle title="Settings" sub="Thresholds for the Stock page. They apply the next time anyone opens it." />
      <SettingsForm
        initial={{
          low_stock_threshold: String(read("low_stock_threshold", DEFAULT_SETTINGS.low)),
          weight_alert_limit: String(read("weight_alert_limit", DEFAULT_SETTINGS.weightLimit)),
          new_inactive_days: String(read("new_inactive_days", DEFAULT_SETTINGS.newInactiveDays)),
        }}
      />
    </div>
  );
}
