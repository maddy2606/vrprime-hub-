import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/** Money (Phase 6) is switched on or off by the owner in Settings (app setting money_enabled). Off unless it says true. */
export const isMoneyEnabled = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const { data } = await supabase.from("app_settings").select("value").eq("key", "money_enabled").maybeSingle();
  return data?.value === true;
});
