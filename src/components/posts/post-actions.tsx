"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useToast } from "@/components/toast";
import { buttonClass, Field } from "@/components/ui";
import type { ActionResult, Post, PostStatus } from "@/lib/types";
import { markDone, setStatus } from "@/server/actions/posts";

type Proof = {
  ticket_id: string;
  no_ticket: boolean;
  no_ticket_reason: string;
  listing_id: string;
  qty: string;
  reference: string;
  note: string;
};

const DONE_HINT: Record<Post["type"], string> = {
  problem: "Enter the marketplace ticket ID so anyone can follow up later.",
  new_listing: "Enter the FSN or listing ID of the live listing.",
  restock: "Enter what was actually sent and the invoice or challan number.",
  task: "Add a note if it helps. It is optional.",
};

export function PostActions({
  post,
  linkedTicketIds = [],
}: {
  post: Pick<Post, "id" | "type" | "status" | "qty_needed">;
  /** Marketplace IDs of tickets already linked to this post: the first fills in the "done" form. */
  linkedTicketIds?: string[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [doneOpen, setDoneOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [proof, setProof] = useState<Proof>({
    ticket_id: linkedTicketIds[0] ?? "",
    no_ticket: false,
    no_ticket_reason: "",
    listing_id: "",
    qty: post.qty_needed ? String(post.qty_needed) : "",
    reference: "",
    note: "",
  });

  const run = (action: () => Promise<ActionResult>, after?: () => void) =>
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setErrors(result.fieldErrors ?? {});
      if (toast.result(result)) {
        setErrors({});
        after?.();
        router.refresh();
      }
    });

  const change = (status: Exclude<PostStatus, "done">) => run(() => setStatus({ postId: post.id, status }));
  const closed = post.status === "done" || post.status === "cancelled";

  if (closed) {
    return (
      <button type="button" disabled={pending} onClick={() => change("open")} className={buttonClass("secondary", "w-full sm:w-auto")}>
        {pending ? "Reopening…" : "Reopen"}
      </button>
    );
  }

  if (doneOpen) {
    return (
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          run(() => markDone({ postId: post.id, ...proof }), () => setDoneOpen(false));
        }}
        className="flex flex-col gap-4 rounded-xl border border-accent bg-surface p-4"
      >
        <div>
          <p className="text-base font-extrabold">Mark done</p>
          <p className="mt-0.5 text-sm text-muted">{DONE_HINT[post.type]}</p>
        </div>

        {post.type === "problem" ? (
          <>
            {!proof.no_ticket ? (
              <Field label="Ticket ID" htmlFor="ticket_id" required error={errors.ticket_id}>
                <input
                  id="ticket_id"
                  className="input font-mono"
                  value={proof.ticket_id}
                  onChange={(e) => setProof({ ...proof, ticket_id: e.target.value })}
                  maxLength={120}
                  autoCorrect="off"
                  spellCheck={false}
                  aria-invalid={Boolean(errors.ticket_id)}
                />
              </Field>
            ) : null}
            <label className="flex min-h-11 items-center gap-3 text-sm font-semibold">
              <input
                type="checkbox"
                className="h-5 w-5 accent-(--accent)"
                checked={proof.no_ticket}
                onChange={(e) => setProof({ ...proof, no_ticket: e.target.checked })}
              />
              No ticket needed
            </label>
            {proof.no_ticket ? (
              <Field label="Why was no ticket needed?" htmlFor="no_ticket_reason" required error={errors.no_ticket_reason}>
                <input
                  id="no_ticket_reason"
                  className="input"
                  value={proof.no_ticket_reason}
                  onChange={(e) => setProof({ ...proof, no_ticket_reason: e.target.value })}
                  maxLength={500}
                  aria-invalid={Boolean(errors.no_ticket_reason)}
                />
              </Field>
            ) : null}
          </>
        ) : null}

        {post.type === "new_listing" ? (
          <Field label="FSN / listing ID" htmlFor="listing_id" required error={errors.listing_id}>
            <input
              id="listing_id"
              className="input font-mono"
              value={proof.listing_id}
              onChange={(e) => setProof({ ...proof, listing_id: e.target.value })}
              maxLength={120}
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={Boolean(errors.listing_id)}
            />
          </Field>
        ) : null}

        {post.type === "restock" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Quantity sent" htmlFor="done_qty" required error={errors.qty}>
              <input
                id="done_qty"
                className="input"
                inputMode="numeric"
                pattern="[0-9]*"
                value={proof.qty}
                onChange={(e) => setProof({ ...proof, qty: e.target.value.replace(/\D/g, "") })}
                aria-invalid={Boolean(errors.qty)}
              />
            </Field>
            <Field label="Invoice / challan number" htmlFor="reference" required error={errors.reference}>
              <input
                id="reference"
                className="input font-mono"
                value={proof.reference}
                onChange={(e) => setProof({ ...proof, reference: e.target.value })}
                maxLength={120}
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={Boolean(errors.reference)}
              />
            </Field>
          </div>
        ) : null}

        <Field label="Note" htmlFor="done_note" error={errors.note}>
          <input
            id="done_note"
            className="input"
            value={proof.note}
            onChange={(e) => setProof({ ...proof, note: e.target.value })}
            maxLength={1000}
          />
        </Field>

        <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
          <button type="submit" disabled={pending} className={buttonClass("primary", "sm:min-w-36")}>
            {pending ? "Saving…" : "Mark done"}
          </button>
          <button type="button" onClick={() => setDoneOpen(false)} className={buttonClass("secondary")}>
            Back
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button type="button" disabled={pending} onClick={() => setDoneOpen(true)} className={buttonClass("primary", "w-full")}>
        Mark done
      </button>
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          disabled={pending || post.status === "in_progress"}
          onClick={() => change("in_progress")}
          className={buttonClass("secondary", "px-2")}
        >
          {post.status === "open" ? "Start" : "In progress"}
        </button>
        <button
          type="button"
          disabled={pending || post.status === "waiting"}
          onClick={() => change("waiting")}
          className={buttonClass("secondary", "px-2")}
        >
          Waiting
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (window.confirm("Cancel this post? It stays in the history and can be reopened.")) change("cancelled");
          }}
          className={buttonClass("danger", "px-2")}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
