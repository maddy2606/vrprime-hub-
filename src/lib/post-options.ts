// Plain values shared by server pages and client components.
// Keep this file free of "use client": a server page that imports a value from
// a client module gets a reference stub, not the value, and crashes at runtime.
import type { PostType, Priority } from "@/lib/types";

export type FilterValues = {
  q: string;
  type: string;
  status: string;
  warehouse: string;
  assignee: string;
  priority: string;
  overdue: boolean;
  /** New listings view: open requests, done and live, done but not found on Flipkart. */
  nl: string;
  sort: string;
};

export const SORTS = [
  { value: "updated", label: "Last update" },
  { value: "due", label: "Due date" },
  { value: "created", label: "Newest" },
  { value: "priority", label: "Priority" },
] as const;

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
  // New-listing request details (all optional)
  product_name: string;
  reference_url: string;
  target_price: string;
  mrp: string;
  dim_l: string;
  dim_b: string;
  dim_h: string;
  weight_kg: string;
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
  product_name: "",
  reference_url: "",
  target_price: "",
  mrp: "",
  dim_l: "",
  dim_b: "",
  dim_h: "",
  weight_kg: "",
};

export const NEW_LISTING_VIEWS = [
  { value: "open", label: "Open requests" },
  { value: "live", label: "Done and live" },
  { value: "missing", label: "Done, not found" },
] as const;
