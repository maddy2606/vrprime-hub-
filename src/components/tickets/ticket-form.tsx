"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { useToast } from "@/components/toast";
import { buttonClass, Field } from "@/components/ui";
import { addDays, postNumber } from "@/lib/format";
import { ISSUE_LABEL, PLATFORM_LABEL, TICKET_STATUS_LABEL } from "@/lib/labels";
import type { TicketFormValues } from "@/lib/ticket-options";
import { ISSUE_TYPES, PLATFORMS, TICKET_STATUSES, type IssueType, type Platform, type TicketStatus } from "@/lib/types";
import { fieldErrors, ticketSchema } from "@/lib/validation";
import { createTicket, updateTicket } from "@/server/actions/tickets";

type LinkedPost = { id: string; number: number; title: string };

type Props = {
  ticketId?: string;
  initial: TicketFormValues;
  linkedPost: LinkedPost | null;
  /** Shown 4 columns beside the form; defaults to the linked post. */
  aside?: ReactNode;
  today: string;
};

/** Ticket ID, platform, issue type, SKU, raised on, next follow-up, status, notes. Nothing else. */
/** The linked post as its own Card, 4 columns beside the form (glass-spec 8.6). */
export function LinkedPostCard({ post }: { post: LinkedPost }) {
  return (
    <aside className="sp-card g-pad span-4">
      <p className="t-label">Linked post</p>
      <Link prefetch={false} href={`/posts/${post.id}`} className="focus-ring t-card-title mt-2 block break-words">
        <span className="font-mono">{postNumber(post.number)}</span> · {post.title}
      </Link>
    </aside>
  );
}

export function TicketForm({ ticketId, initial, linkedPost, today, aside }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [values, setValues] = useState<TicketFormValues>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof TicketFormValues>(key: K, value: TicketFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => {
      if (!(key in e)) return e;
      const rest = { ...e };
      delete rest[key];
      return rest;
    });
  };

  const submit = () => {
    const parsed = ticketSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      toast.show("Check the highlighted fields.", "bad");
      return;
    }
    startTransition(async () => {
      if (ticketId) {
        const result = await updateTicket(ticketId, values);
        if (!result.ok) setErrors(result.fieldErrors ?? {});
        if (toast.result(result)) {
          router.push("/tickets");
          router.refresh();
        }
        return;
      }
      const result = await createTicket(values);
      if (!result.ok) setErrors(result.fieldErrors ?? {});
      if (toast.result(result) && result.ok && result.data) {
        // From a post: go back to it, so the new link is visible. Otherwise open the ticket.
        router.push(linkedPost ? `/posts/${linkedPost.id}` : `/tickets/${result.data.id}`);
        router.refresh();
      }
    });
  };

  return (
    <div className="g-grid items-start">
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="sp-card g-pad span-8 flex flex-col gap-4"
    >

      <Field label="Marketplace ticket ID" htmlFor="ticket_id" required error={errors.ticket_id} hint="The ID Flipkart or Amazon gave you">
        <input
          id="ticket_id"
          className="input font-mono"
          value={values.ticket_id}
          onChange={(e) => set("ticket_id", e.target.value)}
          maxLength={120}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={Boolean(errors.ticket_id)}
        />
      </Field>

      <div className="grid gap-4 min-[700px]:grid-cols-2">
        <Field label="Platform" htmlFor="platform" required error={errors.platform}>
          <select id="platform" className="input" value={values.platform} onChange={(e) => set("platform", e.target.value as Platform)}>
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_LABEL[p]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Issue type" htmlFor="issue_type" required error={errors.issue_type}>
          <select id="issue_type" className="input" value={values.issue_type} onChange={(e) => set("issue_type", e.target.value as IssueType)}>
            {ISSUE_TYPES.map((t) => (
              <option key={t} value={t}>
                {ISSUE_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="SKU" htmlFor="sku" error={errors.sku}>
        <input
          id="sku"
          className="input font-mono"
          value={values.sku}
          onChange={(e) => set("sku", e.target.value)}
          maxLength={120}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
        />
      </Field>

      <div className="grid gap-4 min-[700px]:grid-cols-2">
        <Field label="Raised on" htmlFor="raised_on" required error={errors.raised_on}>
          <input id="raised_on" type="date" className="input" value={values.raised_on} onChange={(e) => set("raised_on", e.target.value)} aria-invalid={Boolean(errors.raised_on)} />
        </Field>
        <Field label="Next follow-up" htmlFor="next_follow_up" error={errors.next_follow_up} hint="You get a reminder at 9:30 AM that day">
          <input id="next_follow_up" type="date" className="input" value={values.next_follow_up} onChange={(e) => set("next_follow_up", e.target.value)} aria-invalid={Boolean(errors.next_follow_up)} />
          <div className="mt-1.5 flex flex-wrap gap-2">
            {[
              { label: "Tomorrow", days: 1 },
              { label: "3 days", days: 3 },
              { label: "1 week", days: 7 },
            ].map((quick) => (
              <button
                key={quick.days}
                type="button"
                onClick={() => set("next_follow_up", addDays(today, quick.days))}
                className={buttonClass("secondary", "rounded-full")}
              >
                {quick.label}
              </button>
            ))}
            {values.next_follow_up ? (
              <button type="button" onClick={() => set("next_follow_up", "")} className={buttonClass("ghost", "rounded-full")}>
                No follow-up
              </button>
            ) : null}
          </div>
        </Field>
      </div>

      <Field label="Status" htmlFor="status" required error={errors.status}>
        <select id="status" className="input" value={values.status} onChange={(e) => set("status", e.target.value as TicketStatus)}>
          {TICKET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {TICKET_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Notes" htmlFor="resolution_notes" error={errors.resolution_notes}>
        <textarea id="resolution_notes" className="input" value={values.resolution_notes} onChange={(e) => set("resolution_notes", e.target.value)} maxLength={2000} />
      </Field>

      <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
        <button type="submit" disabled={pending} className={buttonClass("primary", "sm:min-w-40")}>
          {pending ? "Saving…" : "Save ticket"}
        </button>
        <button type="button" onClick={() => router.back()} className={buttonClass("secondary")}>
          Cancel
        </button>
      </div>
    </form>
    {aside ?? (linkedPost ? <LinkedPostCard post={linkedPost} /> : null)}
    </div>
  );
}
