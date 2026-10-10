import { z } from "zod";
import { PLATFORMS, POST_STATUSES, POST_TYPES, PRIORITIES, ROLES } from "@/lib/types";

// Shared by the forms (for instant feedback) and the server actions (the real check).

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters`)
    .nullish()
    .transform((v) => (v ? v : null));

const optionalUuid = z
  .union([z.uuid(), z.literal(""), z.null(), z.undefined()])
  .transform((v) => (v ? v : null));

const optionalDate = z
  .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid date"), z.literal(""), z.null(), z.undefined()])
  .transform((v) => (v ? v : null));

const optionalQty = (message: string) =>
  z
    .union([z.number(), z.string(), z.null(), z.undefined()])
    .transform((v) => (v === "" || v === null || v === undefined ? null : Number(v)))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 10_000_000), message);

export const postSchema = z
  .object({
    type: z.enum(POST_TYPES),
    title: optionalText(200),
    details: optionalText(5000),
    priority: z.enum(PRIORITIES).default("normal"),
    sku: optionalText(120),
    warehouse_id: optionalUuid,
    platform: z
      .union([z.enum(PLATFORMS), z.literal(""), z.null(), z.undefined()])
      .transform((v) => (v ? v : null)),
    qty_needed: optionalQty("Enter a whole number"),
    assignee_id: optionalUuid,
    due_date: optionalDate,
  })
  .superRefine((v, ctx) => {
    const need = (field: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [field], message });

    if (v.type !== "restock" && !v.title) need("title", "Give it a short title");
    if (v.type === "task" && !v.assignee_id) need("assignee_id", "Choose who should do this");
    if (v.type === "problem") {
      if (!v.details) need("details", "Describe what went wrong");
      if (!v.warehouse_id && !v.platform) need("warehouse_id", "Choose a warehouse or a platform");
    }
    if (v.type === "restock") {
      if (!v.sku) need("sku", "Enter the SKU");
      if (!v.warehouse_id) need("warehouse_id", "Choose the warehouse");
      if (!v.qty_needed || v.qty_needed < 1) need("qty_needed", "Enter how many units are needed");
    }
  });
export type PostInput = z.input<typeof postSchema>;

export const statusSchema = z.object({
  postId: z.uuid(),
  status: z.enum(POST_STATUSES).exclude(["done"]),
});

export const doneSchema = z.object({
  postId: z.uuid(),
  ticket_id: optionalText(120),
  no_ticket: z.boolean().default(false),
  no_ticket_reason: optionalText(500),
  listing_id: optionalText(120),
  qty: optionalQty("Enter a whole number"),
  reference: optionalText(120),
  note: optionalText(1000),
});
export type DoneInput = z.input<typeof doneSchema>;

export const commentSchema = z.object({
  postId: z.uuid(),
  body: z.string().trim().min(1, "Write something first").max(4000, "Keep this under 4000 characters"),
});

export const attachmentSchema = z.object({
  postId: z.uuid(),
  path: z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/, "Invalid file path"),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")),
  password: z.string().min(1, "Enter your password"),
});

const password = z
  .string()
  .min(8, "Use at least 8 characters")
  .max(72, "Use at most 72 characters");

export const changePasswordSchema = z
  .object({ password, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "The two passwords do not match" });

const userFields = {
  name: z.string().trim().min(1, "Enter a name").max(80, "Keep this under 80 characters"),
  role: z.enum(ROLES),
  phone: optionalText(20),
  warehouseIds: z.array(z.uuid()).max(50).default([]),
};

export const createUserSchema = z
  .object({
    ...userFields,
    email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")),
    password,
  })
  .refine((v) => v.role !== "warehouse" || v.warehouseIds.length > 0, {
    path: ["warehouseIds"],
    message: "Choose at least one warehouse",
  });
export type CreateUserInput = z.input<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    ...userFields,
    id: z.uuid(),
    active: z.boolean(),
    // Empty means "leave the password alone".
    newPassword: z.union([password, z.literal(""), z.undefined()]).transform((v) => (v ? v : null)),
  })
  .refine((v) => v.role !== "warehouse" || v.warehouseIds.length > 0, {
    path: ["warehouseIds"],
    message: "Choose at least one warehouse",
  });
export type UpdateUserInput = z.input<typeof updateUserSchema>;

/** First message per field, for showing under form inputs. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
