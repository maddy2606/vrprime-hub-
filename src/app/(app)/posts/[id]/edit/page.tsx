import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PostForm } from "@/components/posts/post-form";
import { PageTitle } from "@/components/ui";
import { canManage, requireUser } from "@/lib/auth";
import { getLookups, getWeightLimit } from "@/lib/data";
import { postNumber } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const metadata: Metadata = { title: "Edit post" };

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const supabase = await createClient();
  const [{ data: post }, lookups, weightLimit] = await Promise.all([
    supabase.from("posts").select("*").eq("id", id).maybeSingle(),
    getLookups(),
    getWeightLimit(),
  ]);
  if (!post) notFound();

  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle title={`Edit ${postNumber(post.number)}`} sub="Every change is recorded in the post history." />
      <PostForm
        postId={post.id}
        people={lookups.people}
        warehouses={lookups.warehouses}
        canPostListings={canManage(user)}
        weightLimit={weightLimit}
        initial={{
          type: post.type,
          title: post.title,
          details: post.details ?? "",
          priority: post.priority,
          sku: post.sku ?? "",
          warehouse_id: post.warehouse_id ?? "",
          platform: post.platform ?? "",
          qty_needed: post.qty_needed === null ? "" : String(post.qty_needed),
          assignee_id: post.assignee_id ?? "",
          due_date: post.due_date ?? "",
          product_name: post.product_name ?? "",
          reference_url: post.reference_url ?? "",
          target_price: post.target_price === null ? "" : String(post.target_price),
          mrp: post.mrp === null ? "" : String(post.mrp),
          dim_l: post.dim_l === null ? "" : String(post.dim_l),
          dim_b: post.dim_b === null ? "" : String(post.dim_b),
          dim_h: post.dim_h === null ? "" : String(post.dim_h),
          weight_kg: post.weight_kg === null ? "" : String(post.weight_kg),
        }}
      />
    </div>
  );
}
