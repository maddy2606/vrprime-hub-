import type { Metadata } from "next";
import Link from "next/link";
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
      <div className="mb-4 flex max-w-sm gap-1 rounded-xl border border-line bg-panel2 p-1">
        <span className="flex min-h-11 flex-1 items-center justify-center rounded-[10px] bg-accent text-sm font-bold text-accent-ink sp-glow">
          My work
        </span>
        <Link prefetch={false} href="/all" className="focus-ring flex min-h-11 flex-1 items-center justify-center rounded-[10px] text-sm font-bold text-muted">
          Everything
        </Link>
      </div>
      <MyWork posts={posts ?? []} lookups={lookups} today={todayIST()} firstName={user.name.split(" ")[0]} />
    </>
  );
}
