import type { Metadata } from "next";
import { TicketForm } from "@/components/tickets/ticket-form";
import { PageTitle } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { todayIST } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { emptyTicket } from "@/lib/ticket-options";

export const metadata: Metadata = { title: "New ticket" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

// /tickets/new?post=<id> raises the ticket from a post: the post's SKU and platform are
// filled in and the ticket is linked to the post.
export default async function NewTicketPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const postParam = one((await searchParams).post);
  const today = todayIST();
  const initial = emptyTicket(today);

  let linkedPost: { id: string; number: number; title: string } | null = null;
  if (UUID.test(postParam)) {
    const supabase = await createClient();
    // RLS decides whether this person can see the post at all.
    const { data: post } = await supabase
      .from("posts")
      .select("id, number, title, sku, platform, type")
      .eq("id", postParam)
      .maybeSingle();
    if (post) {
      linkedPost = { id: post.id, number: post.number, title: post.title };
      initial.post_id = post.id;
      initial.sku = post.sku ?? "";
      if (post.platform) initial.platform = post.platform;
      if (post.type === "problem") initial.issue_type = "other";
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle
        title="New ticket"
        sub={linkedPost ? "It will be linked to the post below." : "Save the marketplace ticket so its follow-up is not forgotten."}
      />
      <TicketForm initial={initial} linkedPost={linkedPost} today={today} />
    </div>
  );
}
