import { PostListSkeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div>
      <div className="skeleton mb-2 h-7 w-40" />
      <div className="skeleton mb-5 h-4 w-56" />
      <PostListSkeleton rows={6} />
    </div>
  );
}
