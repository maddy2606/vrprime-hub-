import type { Metadata } from "next";
import Link from "next/link";
import { MyWork } from "@/components/posts/my-work";
import { requireUser } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import { todayIST } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_STATUSES } from "@/lib/types";

export const metadata: Metadata = { title: "My work" };

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
      <div className="mb-4 flex gap-1 rounded-lg border border-line bg-surface p-1 lg:hidden">
        <span className="flex min-h-10 flex-1 items-center justify-center rounded-md bg-accent text-sm font-bold text-accent-ink">
          My work
        </span>
        <Link href="/all" className="focus-ring flex min-h-10 flex-1 items-center justify-center rounded-md text-sm font-bold text-muted">
          Everything
        </Link>
      </div>
      <MyWork posts={posts ?? []} lookups={lookups} today={todayIST()} firstName={user.name.split(" ")[0]} />
    </>
  );
}
