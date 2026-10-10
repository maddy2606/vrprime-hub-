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
