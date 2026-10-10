"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useToast } from "@/components/toast";
import { buttonClass, Field } from "@/components/ui";
import { PLATFORM_LABEL, PRIORITY_LABEL, TYPE_HINT, TYPE_LABEL } from "@/lib/labels";
import { PLATFORMS, POST_TYPES, PRIORITIES, type Person, type PostType, type Priority, type Warehouse } from "@/lib/types";
import { fieldErrors, postSchema } from "@/lib/validation";
import { createPost, updatePost } from "@/server/actions/posts";

export type PostFormValues = {
  type: PostType | null;
  title: string;
  details: string;
  priority: Priority;
  sku: string;
  warehouse_id: string;
  platform: string;
  qty_needed: string;
  assignee_id: string;
  due_date: string;
};

export const EMPTY_POST: PostFormValues = {
  type: null,
  title: "",
  details: "",
  priority: "normal",
  sku: "",
  warehouse_id: "",
  platform: "",
  qty_needed: "",
  assignee_id: "",
  due_date: "",
};

type Props = {
  postId?: string;
  initial: PostFormValues;
  people: Person[];
  warehouses: Warehouse[];
};

export function PostForm({ postId, initial, people, warehouses }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [values, setValues] = useState<PostFormValues>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const editing = Boolean(postId);
  const type = values.type;

  const set = <K extends keyof PostFormValues>(key: K, value: PostFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => {
      if (!(key in e)) return e;
      const rest = { ...e };
      delete rest[key];
      return rest;
    });
  };

  if (!type) {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {POST_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => set("type", t)}
            className="focus-ring rounded-xl border border-line bg-surface p-4 text-left transition hover:border-accent"
          >
            <span className="block text-base font-extrabold">{TYPE_LABEL[t]}</span>
            <span className="mt-0.5 block text-sm text-muted">{TYPE_HINT[t]}</span>
          </button>
        ))}
      </div>
    );
  }

  const submit = () => {
    const parsed = postSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      toast.show("Check the highlighted fields.", "bad");
      return;
    }
    startTransition(async () => {
      if (postId) {
        const result = await updatePost(postId, values);
        if (!result.ok) setErrors(result.fieldErrors ?? {});
        if (toast.result(result)) router.push(`/posts/${postId}`);
        return;
      }
      const result = await createPost(values);
      toast.result(result);
      if (result.ok && result.data) router.push(`/posts/${result.data.id}`);
      else if (!result.ok) setErrors(result.fieldErrors ?? {});
    });
  };

  const activePeople = people.filter((p) => p.active || p.id === values.assignee_id);
  const show = {
    title: type !== "restock",
    qty: type === "restock",
    platform: type === "problem" || type === "new_listing",
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-4"
    >
      <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3">
        <div>
          <p className="text-xs font-semibold text-muted">Type</p>
          <p className="text-base font-extrabold">{TYPE_LABEL[type]}</p>
        </div>
        {!editing ? (
          <button type="button" onClick={() => set("type", null)} className={buttonClass("ghost")}>
            Change
          </button>
        ) : null}
      </div>

      {show.title ? (
        <Field label="Title" htmlFor="title" required error={errors.title}>
          <input
            id="title"
            className="input"
            value={values.title}
            onChange={(e) => set("title", e.target.value)}
            maxLength={200}
            aria-invalid={Boolean(errors.title)}
            placeholder={
              type === "task"
                ? "What needs to be done?"
                : type === "problem"
                  ? "What went wrong?"
                  : "Which product?"
            }
          />
        </Field>
      ) : null}

      <Field label="SKU" htmlFor="sku" required={type === "restock"} error={errors.sku}>
        <input
          id="sku"
          className="input font-mono"
          value={values.sku}
          onChange={(e) => set("sku", e.target.value)}
          maxLength={120}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={Boolean(errors.sku)}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Warehouse"
          htmlFor="warehouse_id"
          required={type === "restock"}
          error={errors.warehouse_id}
          hint={type === "problem" ? "Choose a warehouse or a platform (or both)" : undefined}
        >
          <select
            id="warehouse_id"
            className="input"
            value={values.warehouse_id}
            onChange={(e) => set("warehouse_id", e.target.value)}
            aria-invalid={Boolean(errors.warehouse_id)}
          >
            <option value="">No warehouse</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>

        {show.platform ? (
          <Field label="Platform" htmlFor="platform" error={errors.platform}>
            <select
              id="platform"
              className="input"
              value={values.platform}
              onChange={(e) => set("platform", e.target.value)}
            >
              <option value="">No platform</option>
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {PLATFORM_LABEL[p]}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        {show.qty ? (
          <Field label="Quantity needed" htmlFor="qty_needed" required error={errors.qty_needed}>
            <input
              id="qty_needed"
              className="input"
              inputMode="numeric"
              pattern="[0-9]*"
              value={values.qty_needed}
              onChange={(e) => set("qty_needed", e.target.value.replace(/\D/g, ""))}
              aria-invalid={Boolean(errors.qty_needed)}
            />
          </Field>
        ) : null}
      </div>

      <Field
        label={type === "restock" ? "Note" : "Details"}
        htmlFor="details"
        required={type === "problem"}
        error={errors.details}
      >
        <textarea
          id="details"
          className="input"
          value={values.details}
          onChange={(e) => set("details", e.target.value)}
          maxLength={5000}
          aria-invalid={Boolean(errors.details)}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Assign to" htmlFor="assignee_id" required={type === "task"} error={errors.assignee_id}>
          <select
            id="assignee_id"
            className="input"
            value={values.assignee_id}
            onChange={(e) => set("assignee_id", e.target.value)}
            aria-invalid={Boolean(errors.assignee_id)}
          >
            <option value="">Nobody yet</option>
            {activePeople.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Due date" htmlFor="due_date" error={errors.due_date}>
          <input
            id="due_date"
            type="date"
            className="input"
            value={values.due_date}
            onChange={(e) => set("due_date", e.target.value)}
          />
        </Field>
      </div>

      <fieldset>
        <legend className="mb-1.5 text-sm font-semibold">Priority</legend>
        <div className="grid grid-cols-4 gap-1 rounded-lg border border-line bg-surface p-1">
          {PRIORITIES.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={values.priority === p}
              onClick={() => set("priority", p)}
              className={`focus-ring min-h-10 rounded-md text-sm font-bold ${
                values.priority === p ? "bg-accent text-accent-ink" : "text-muted hover:bg-surface2"
              }`}
            >
              {PRIORITY_LABEL[p]}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
        <button type="submit" disabled={pending} className={buttonClass("primary", "sm:min-w-40")}>
          {pending ? "Saving…" : editing ? "Save changes" : `Create ${TYPE_LABEL[type].toLowerCase()}`}
        </button>
        <button type="button" onClick={() => router.back()} className={buttonClass("secondary")}>
          Cancel
        </button>
      </div>
    </form>
  );
}
