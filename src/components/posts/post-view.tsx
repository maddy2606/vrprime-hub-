import Link from "next/link";
import type { ReactNode } from "react";
import { BackIcon } from "@/components/icons";
import { CommentThread } from "@/components/posts/comment-form";
import { Photos, type Photo } from "@/components/posts/photos";
import { PostActions } from "@/components/posts/post-actions";
import { DueChip } from "@/components/posts/post-card";
import { buttonClass, Card, PriorityChip, StatusChip, TypeChip } from "@/components/ui";
import type { Lookups } from "@/lib/data";
import { formatDate, formatDateTime, formatNumber, postNumber } from "@/lib/format";
import { FIELD_LABEL, PLATFORM_LABEL, PRIORITY_LABEL, STATUS_LABEL } from "@/lib/labels";
import type { Json, Platform, Post, PostComment, PostEvent, PostStatus, Priority } from "@/lib/types";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-semibold">{children}</dd>
    </div>
  );
}

function asRecord(value: Json | undefined): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value: Json | undefined): string {
  return value === null || value === undefined || value === "" ? "none" : String(value);
}

function fieldValue(field: string, value: Json | undefined, lookups: Lookups, today: string): string {
  if (value === null || value === undefined || value === "") return "none";
  const s = String(value);
  if (field === "warehouse_id") return lookups.warehouseName(s);
  if (field === "priority") return PRIORITY_LABEL[s as Priority] ?? s;
  if (field === "platform") return PLATFORM_LABEL[s as Platform] ?? s;
  if (field === "due_date") return formatDate(s, today);
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}

/** Turns an audit event into one or more plain sentences. */
function describeEvent(event: PostEvent, lookups: Lookups, today: string): string[] {
  const c = asRecord(event.changes);
  switch (event.kind) {
    case "created":
      return ["created this post"];
    case "status": {
      const to = String(c.to) as PostStatus;
      const lines = [`marked it ${(STATUS_LABEL[to] ?? String(c.to)).toLowerCase()}`];
      if (c.ticket_id) lines.push(`Ticket ID: ${text(c.ticket_id)}`);
      if (c.no_ticket_reason) lines.push(`No ticket needed: ${text(c.no_ticket_reason)}`);
      if (c.listing_id) lines.push(`Listing ID: ${text(c.listing_id)}`);
      if (c.qty !== undefined) lines.push(`Quantity sent: ${text(c.qty)}`);
      if (c.reference) lines.push(`Invoice / challan: ${text(c.reference)}`);
      if (c.note) lines.push(`Note: ${text(c.note)}`);
      return lines;
    }
    case "assignee":
      return [c.to ? `assigned it to ${lookups.personName(String(c.to))}` : "removed the assignee"];
    case "edit":
      return Object.entries(c).map(([field, change]) => {
        const label = FIELD_LABEL[field] ?? field;
        if (field === "details") return "updated the details";
        const { from, to } = asRecord(change);
        return `changed ${label.toLowerCase()} from ${fieldValue(field, from, lookups, today)} to ${fieldValue(field, to, lookups, today)}`;
      });
  }
}

type Props = {
  post: Post;
  lookups: Lookups;
  today: string;
  comments: PostComment[];
  events: PostEvent[];
  photos: Photo[];
};

export function PostView({ post, lookups, today, comments, events, photos }: Props) {
  const done = post.status === "done";
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <Link prefetch={false} href="/all" className={buttonClass("ghost", "-ml-3 px-3")}>
          <BackIcon className="h-5 w-5" /> All posts
        </Link>
        <Link prefetch={false} href={`/posts/${post.id}/edit`} className={buttonClass("secondary")}>
          Edit
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-6">
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-sm font-medium text-muted">{postNumber(post.number)}</span>
              <TypeChip type={post.type} />
              <PriorityChip priority={post.priority} />
              <StatusChip status={post.status} />
              <DueChip post={post} today={today} />
            </div>
            <h1 className="mt-3 break-words text-xl font-extrabold leading-snug tracking-tight">{post.title}</h1>
            {post.details ? (
              <p className="mt-2 whitespace-pre-wrap break-words text-[15px] leading-relaxed">{post.details}</p>
            ) : null}

            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 sm:grid-cols-3">
              <Fact label="Assigned to">{lookups.personName(post.assignee_id)}</Fact>
              {post.warehouse_id ? <Fact label="Warehouse">{lookups.warehouseName(post.warehouse_id)}</Fact> : null}
              {post.platform ? <Fact label="Platform">{PLATFORM_LABEL[post.platform]}</Fact> : null}
              {post.sku ? (
                <Fact label="SKU">
                  <span className="font-mono">{post.sku}</span>
                </Fact>
              ) : null}
              {post.qty_needed !== null ? <Fact label="Quantity needed">{formatNumber(post.qty_needed)}</Fact> : null}
              <Fact label="Due">{post.due_date ? formatDate(post.due_date, today) : "No due date"}</Fact>
              <Fact label="Created by">{lookups.personName(post.created_by)}</Fact>
              <Fact label="Created">{formatDateTime(post.created_at)}</Fact>
            </dl>
          </Card>

          {done ? (
            <Card className="border-ok/40 bg-ok-soft p-4">
              <p className="text-sm font-extrabold text-ok">
                Done by {lookups.personName(post.done_by)}
                {post.done_at ? ` · ${formatDateTime(post.done_at)}` : ""}
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
                {post.done_ticket_id ? (
                  <Fact label="Ticket ID">
                    <span className="font-mono">{post.done_ticket_id}</span>
                  </Fact>
                ) : null}
                {post.done_no_ticket_reason ? <Fact label="No ticket needed">{post.done_no_ticket_reason}</Fact> : null}
                {post.done_listing_id ? (
                  <Fact label="FSN / listing ID">
                    <span className="font-mono">{post.done_listing_id}</span>
                  </Fact>
                ) : null}
                {post.done_qty !== null ? <Fact label="Quantity sent">{formatNumber(post.done_qty)}</Fact> : null}
                {post.done_reference ? (
                  <Fact label="Invoice / challan">
                    <span className="font-mono">{post.done_reference}</span>
                  </Fact>
                ) : null}
                {post.done_note ? <Fact label="Note">{post.done_note}</Fact> : null}
              </dl>
            </Card>
          ) : null}

          <PostActions post={post} />

          <Card className="p-4">
            <h2 className="mb-3 text-base font-extrabold">Photos</h2>
            <Photos postId={post.id} photos={photos} />
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Card className="p-4">
            <CommentThread
              postId={post.id}
              comments={comments}
              names={Object.fromEntries(lookups.people.map((person) => [person.id, person.name]))}
            />
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 text-base font-extrabold">History</h2>
            <ol className="flex flex-col gap-3 border-l-2 border-line pl-4">
              {events.map((event) => {
                const [first, ...rest] = describeEvent(event, lookups, today);
                return (
                  <li key={event.id} className="text-sm">
                    <p className="break-words">
                      <span className="font-bold">{event.actor_id ? lookups.personName(event.actor_id) : "System"}</span>{" "}
                      {first}
                    </p>
                    {rest.map((line) => (
                      <p key={line} className="break-words text-muted">
                        {line}
                      </p>
                    ))}
                    <p className="text-xs text-muted">{formatDateTime(event.created_at)}</p>
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}

