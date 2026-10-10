"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useToast } from "@/components/toast";
import { buttonClass } from "@/components/ui";
import { addComment } from "@/server/actions/posts";

export function CommentForm({ postId }: { postId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!body.trim()) return;
        startTransition(async () => {
          const result = await addComment({ postId, body });
          if (toast.result(result)) {
            setBody("");
            router.refresh();
          }
        });
      }}
      className="flex flex-col gap-2"
    >
      <label htmlFor="comment" className="sr-only">
        Add a comment
      </label>
      <textarea
        id="comment"
        className="input"
        placeholder="Add a comment…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={4000}
      />
      <button type="submit" disabled={pending || !body.trim()} className={buttonClass("primary", "self-end")}>
        {pending ? "Posting…" : "Post comment"}
      </button>
    </form>
  );
}
