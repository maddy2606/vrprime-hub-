import type { Metadata } from "next";
import { EMPTY_POST, PostForm, type PostFormValues } from "@/components/posts/post-form";
import { PageTitle } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import { POST_TYPES, type PostType } from "@/lib/types";

export const metadata: Metadata = { title: "New post" };

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

// Other screens can pre-fill the form through the URL, for example
// /posts/new?type=restock&sku=ABC&warehouse=<id> from a stock row.
export default async function NewPostPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const sp = await searchParams;
  const lookups = await getLookups();

  const type = one(sp.type);
  const warehouse = one(sp.warehouse);
  const initial: PostFormValues = {
    ...EMPTY_POST,
    type: (POST_TYPES as readonly string[]).includes(type) ? (type as PostType) : null,
    sku: one(sp.sku).slice(0, 120),
    warehouse_id: lookups.warehouses.some((w) => w.id === warehouse) ? warehouse : "",
    qty_needed: one(sp.qty).replace(/\D/g, "").slice(0, 8),
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle title="New post" sub="Pick a type, then fill the short form." />
      <PostForm initial={initial} people={lookups.people} warehouses={lookups.warehouses} />
    </div>
  );
}
