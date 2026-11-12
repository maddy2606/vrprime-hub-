import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdsDesk } from "@/components/ads/ads-desk";
import { canManage, requireUser } from "@/lib/auth";
import { todayIST } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Ads Desk" };

// The function is newer than the generated types.
type Loose = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }> };

/**
 * The Ads Desk: where the ad money went and what to do about it, from Seller Hub's four PLA reports (daily spend,
 * per SKU, search terms, keywords). Owner and admin. The analysis runs in the browser from one read of the data.
 */
export default async function AdsDeskPage() {
  const user = await requireUser();
  if (!canManage(user)) notFound();
  const db = (await createClient()) as unknown as Loose;
  const { data } = await db.rpc("ads_desk_data", { p_days: 75 });
  return <AdsDesk raw={data ?? null} today={todayIST()} />;
}
