import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import type { Photo } from "@/components/posts/photos";
import { PostView } from "@/components/posts/post-view";
import { canManage, requireUser } from "@/lib/auth";
import { getLookups, getWeightLimit } from "@/lib/data";
import { postNumber, todayIST } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIGNED_URL_SECONDS = 60 * 60;

// Read once per request, shared by the tab title and the page. RLS hides posts this
// user may not see, so "not visible" and "does not exist" look the same.
const getPost = cache(async (id: string) => {
  if (!UUID.test(id)) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("posts").select("*").eq("id", id).maybeSingle();
  return data;
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const post = await getPost((await params).id);
  return { title: post ? `${postNumber(post.number)} ${post.title}` : "Post" };
}

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const post = await getPost(id);
  if (!post) notFound();
  const supabase = await createClient();

  const [lookups, weightLimit, comments, events, attachments, tickets] = await Promise.all([
    getLookups(),
    getWeightLimit(),
    supabase.from("post_comments").select("*").eq("post_id", id).order("created_at"),
    supabase.from("post_events").select("*").eq("post_id", id).order("created_at", { ascending: false }).order("id", { ascending: false }),
    supabase.from("post_attachments").select("*").eq("post_id", id).order("created_at"),
    supabase.from("tickets").select("*").eq("post_id", id).order("created_at"),
  ]);

  const files = attachments.data ?? [];
  const signed = files.length
    ? await supabase.storage.from("post-attachments").createSignedUrls(files.map((f) => f.path), SIGNED_URL_SECONDS)
    : { data: [] };
  const urlByPath = new Map((signed.data ?? []).map((s) => [s.path, s.signedUrl]));
  const photos: Photo[] = files.map((f) => ({
    id: f.id,
    url: urlByPath.get(f.path) ?? null,
    canRemove: f.uploaded_by === user.id || canManage(user),
  }));

  return (
    <PostView
        post={post}
        tickets={tickets.data ?? []}
        lookups={lookups}
        today={todayIST()}
        comments={comments.data ?? []}
        events={events.data ?? []}
        photos={photos}
        weightLimit={weightLimit}
    />
  );
}
