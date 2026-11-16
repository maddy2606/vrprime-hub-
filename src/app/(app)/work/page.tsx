import type { Metadata } from "next";
import { WorkSwitch } from "@/components/posts/post-card";
import { MyWork } from "@/components/posts/my-work";
import { requireUser } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import { todayIST } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_STATUSES } from "@/lib/types";

export const metadata: Metadata = { title: "Work board" };

export default async function MyWorkPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const [{ data: posts, error }, lookups] = await Promise.all([
    supabase.from("posts").select("*").eq("assignee_id", user.id).in("status", ACTIVE_STATUSES).limit(300),
    getLookups(),
  ]);
  if (error) throw new Error("Could not load your work");

  return (
    <>
      <WorkSwitch on="mine" />
      <MyWork posts={posts ?? []} lookups={lookups} today={todayIST()} firstName={user.name.split(" ")[0]} />
    </>
  );
}
