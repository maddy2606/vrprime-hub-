"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { CameraIcon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { buttonClass, Field } from "@/components/ui";
import { PLATFORM_LABEL, PRIORITY_LABEL, TYPE_HINT, TYPE_LABEL } from "@/lib/labels";
import { checkWeight, weightWarning } from "@/lib/new-listing";
import type { PostFormValues } from "@/lib/post-options";
import { PLATFORMS, POST_TYPES, PRIORITIES, type Person, type Warehouse } from "@/lib/types";
import { fieldErrors, postSchema } from "@/lib/validation";
import { createPost, updatePost } from "@/server/actions/posts";
import { uploadPostPhotos } from "./upload-photos";

type Props = {
  postId?: string;
  initial: PostFormValues;
  people: Person[];
  warehouses: Warehouse[];
  /** Owner and admin only: the New listing type is not offered to anyone else. */
  canPostListings: boolean;
  /** The weight limit setting, for the new-listing weight check. */
  weightLimit: number;
};

const MAX_PHOTOS = 6;

/** Digits and one decimal point. */
function decimal(value: string): string {
  const cleaned = value.replace(/[^0-9.]/g, "");
  const [whole, ...rest] = cleaned.split(".");
  return rest.length ? `${whole}.${rest.join("")}` : whole;
}

function hasListingDetails(v: PostFormValues): boolean {
  return Boolean(v.product_name || v.reference_url || v.target_price || v.mrp || v.dim_l || v.dim_b || v.dim_h || v.weight_kg || v.details);
}

export function PostForm({ postId, initial, people, warehouses, canPostListings, weightLimit }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [values, setValues] = useState<PostFormValues>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const [more, setMore] = useState(() => hasListingDetails(initial));
  const [photos, setPhotos] = useState<File[]>([]);
  const photoInput = useRef<HTMLInputElement>(null);
  const editing = Boolean(postId);
  const type = values.type;
  const listing = type === "new_listing";

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
        {POST_TYPES.filter((t) => t !== "new_listing" || canPostListings).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setValues((v) => ({ ...v, type: t, platform: t === "new_listing" && !v.platform ? "flipkart" : v.platform }));
            }}
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
      if (result.ok && result.data) {
        if (photos.length) {
          const added = await uploadPostPhotos(result.data.id, photos);
          if (added < photos.length) toast.show(`${photos.length - added} of ${photos.length} photos could not be uploaded. Add them on the post.`, "bad");
        }
        router.push(`/posts/${result.data.id}`);
      } else if (!result.ok) setErrors(result.fieldErrors ?? {});
    });
  };

  // A new-listing request is only ever assigned to an owner or an admin.
  const activePeople = people.filter((p) => (p.active || p.id === values.assignee_id) && (!listing || p.role !== "warehouse"));
  const show = {
    title: type !== "restock",
    qty: type === "restock",
    platform: type === "problem",
  };
  const weight = listing ? checkWeight(values.dim_l, values.dim_b, values.dim_h, values.weight_kg, weightLimit) : null;

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
                  : "e.g. List rat spray 500 ml on Flipkart"
            }
          />
        </Field>
      ) : null}

      {!listing ? (
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
      ) : null}

      {!listing ? (
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
      ) : null}

      {!listing ? (
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
      ) : null}

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

      {listing ? (
        <details
          open={more}
          onToggle={(e) => setMore(e.currentTarget.open)}
          className="rounded-xl border border-line bg-surface"
        >
          <summary className="focus-ring flex min-h-12 cursor-pointer items-center justify-between px-4 text-sm font-extrabold">
            More details <span className="text-xs font-semibold text-muted">optional</span>
          </summary>
          <div className="flex flex-col gap-4 border-t border-line p-4">
            <Field label="Product name" htmlFor="product_name" error={errors.product_name}>
              <input id="product_name" className="input" value={values.product_name} onChange={(e) => set("product_name", e.target.value)} maxLength={200} />
            </Field>
            <Field label="Reference link" htmlFor="reference_url" error={errors.reference_url} hint="A product page to copy from">
              <input
                id="reference_url"
                className="input"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="https://"
                value={values.reference_url}
                onChange={(e) => set("reference_url", e.target.value)}
                maxLength={500}
                aria-invalid={Boolean(errors.reference_url)}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Platform" htmlFor="platform" error={errors.platform}>
                <select id="platform" className="input" value={values.platform} onChange={(e) => set("platform", e.target.value)}>
                  {PLATFORMS.map((p) => (
                    <option key={p} value={p}>
                      {PLATFORM_LABEL[p]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Target price (₹)" htmlFor="target_price" error={errors.target_price}>
                <input id="target_price" className="input" inputMode="decimal" value={values.target_price} onChange={(e) => set("target_price", decimal(e.target.value))} aria-invalid={Boolean(errors.target_price)} />
              </Field>
              <Field label="MRP (₹)" htmlFor="mrp" error={errors.mrp}>
                <input id="mrp" className="input" inputMode="decimal" value={values.mrp} onChange={(e) => set("mrp", decimal(e.target.value))} aria-invalid={Boolean(errors.mrp)} />
              </Field>
            </div>
            <fieldset>
              <legend className="mb-1.5 text-sm font-semibold">Size in cm (L × B × H) and weight</legend>
              <div className="grid grid-cols-4 gap-2">
                {(
                  [
                    ["dim_l", "L"],
                    ["dim_b", "B"],
                    ["dim_h", "H"],
                    ["weight_kg", "kg"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key}>
                    <input
                      aria-label={key === "weight_kg" ? "Weight in kg" : `${label} in cm`}
                      className="input"
                      inputMode="decimal"
                      placeholder={label}
                      value={values[key]}
                      onChange={(e) => set(key, decimal(e.target.value))}
                      aria-invalid={Boolean(errors[key])}
                    />
                    {errors[key] ? <p className="mt-1 text-xs font-semibold text-bad">{errors[key]}</p> : null}
                  </div>
                ))}
              </div>
              {weight?.over ? (
                <p role="status" className="mt-2 rounded-lg border border-warn/50 bg-warn-soft p-3 text-sm">
                  <span className="font-extrabold text-warn">Over the weight limit.</span> {weightWarning(weight)}
                </p>
              ) : weight ? (
                <p className="mt-2 text-sm text-muted">Within the weight limit ({Math.round(weight.total).toLocaleString("en-IN")} of {weight.limit.toLocaleString("en-IN")}).</p>
              ) : (
                <p className="mt-2 text-xs text-muted">Enter all four to check the weight limit ({weightLimit.toLocaleString("en-IN")}: size multiplied, plus grams).</p>
              )}
            </fieldset>
            <Field label="Notes" htmlFor="details" error={errors.details}>
              <textarea id="details" className="input" value={values.details} onChange={(e) => set("details", e.target.value)} maxLength={5000} />
            </Field>
            {!editing ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-semibold">Photos</p>
                <input
                  ref={photoInput}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    const picked = Array.from(e.target.files ?? []);
                    e.target.value = "";
                    setPhotos((current) => [...current, ...picked].slice(0, MAX_PHOTOS));
                  }}
                />
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" onClick={() => photoInput.current?.click()} className={buttonClass("secondary")}>
                    <CameraIcon className="h-5 w-5" />
                    Add photos
                  </button>
                  {photos.length ? (
                    <span className="text-sm text-muted">
                      {photos.length} selected ·{" "}
                      <button type="button" className="font-semibold text-accent-text underline" onClick={() => setPhotos([])}>
                        clear
                      </button>
                    </span>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted">Add or remove photos on the post itself.</p>
            )}
          </div>
        </details>
      ) : null}

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
