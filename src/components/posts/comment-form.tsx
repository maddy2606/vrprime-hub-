"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useToast } from "@/components/toast";
import { buttonClass } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import type { PostComment } from "@/lib/types";
import { addComment } from "@/server/actions/posts";

type Props = {
  postId: string;
  comments: PostComment[];
  /** id -> name, for everyone who can appear as an author. */
  names: Record<string, string>;
};

/** The comment list and the box to add one. */
export function CommentThread({ postId, comments, names }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [body, setBody] = useState("");
  // Comments this person just posted. They show at once, without waiting for
  // the page to reload its data, and drop out once the server list has them.
  const [posted, setPosted] = useState<PostComment[]>([]);
  const [pending, startTransition] = useTransition();

  const known = new Set(comments.map((c) => c.id));
  const all = [...comments, ...posted.filter((c) => !known.has(c.id))];

  return (
    <>
      <h2 className="t-card-title g-head">
        Comments{all.length ? <span className="text-muted"> · {all.length}</span> : null}
      </h2>
      {all.length ? (
        <ul className="mb-4 flex flex-col gap-3">
          {all.map((comment) => (
            <li key={comment.id} className="sp-inner p-3">
              <p className="t-body flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold">{names[comment.author_id] ?? "Unknown"}</span>
                <span className="t-caption">{formatDateTime(comment.created_at)}</span>
              </p>
              <p className="t-body mt-1 whitespace-pre-wrap break-words">{comment.body}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="t-caption mb-4">No comments yet. Ask a question or post an update here.</p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!body.trim()) return;
          startTransition(async () => {
            const result = await addComment({ postId, body });
            if (toast.result(result) && result.ok) {
              const created = result.data;
              if (created) setPosted((list) => [...list, created]);
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
    </>
  );
}
