import type { IssueType, Platform, PostStatus, PostType, Priority, Role, TicketStatus } from "@/lib/types";

export type Tone = "neutral" | "accent" | "info" | "ok" | "warn" | "bad";

export const TYPE_LABEL: Record<PostType, string> = {
  task: "Task",
  new_listing: "New listing",
  problem: "Problem",
  restock: "Restock",
};

export const TYPE_HINT: Record<PostType, string> = {
  task: "Something a person needs to do",
  new_listing: "A product to list on a marketplace",
  problem: "Something went wrong and needs fixing",
  restock: "Send stock to a warehouse",
};

export const TYPE_TONE: Record<PostType, Tone> = {
  task: "accent",
  new_listing: "info",
  problem: "bad",
  restock: "warn",
};

export const STATUS_LABEL: Record<PostStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  waiting: "Waiting",
  done: "Done",
  cancelled: "Cancelled",
};

export const STATUS_TONE: Record<PostStatus, Tone> = {
  open: "info",
  in_progress: "accent",
  waiting: "warn",
  done: "ok",
  cancelled: "neutral",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export const PRIORITY_TONE: Record<Priority, Tone> = {
  low: "neutral",
  normal: "neutral",
  high: "warn",
  urgent: "bad",
};

export const PLATFORM_LABEL: Record<Platform, string> = {
  flipkart: "Flipkart",
  amazon: "Amazon",
  other: "Other",
};

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Open",
  waiting_marketplace: "Waiting for marketplace",
  resolved: "Resolved",
  rejected: "Rejected",
};

export const TICKET_STATUS_TONE: Record<TicketStatus, Tone> = {
  open: "info",
  waiting_marketplace: "warn",
  resolved: "ok",
  rejected: "bad",
};

export const ISSUE_LABEL: Record<IssueType, string> = {
  wrong_return: "Wrong return",
  payment_missing: "Payment missing",
  listing_blocked: "Listing blocked",
  claim: "Claim",
  other: "Other",
  weight_overcharge: "Weight overcharge",
  wrong_fee: "Wrong fee",
};

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  warehouse: "Warehouse",
};

export const ROLE_HINT: Record<Role, string> = {
  owner: "Everything, including settings and users. There can be several owners",
  admin: "Everything except settings and users: posts, new listings, tickets, Sync now",
  warehouse: "Only posts for their warehouses or assigned to them",
};

export const FIELD_LABEL: Record<string, string> = {
  type: "Type",
  title: "Title",
  details: "Details",
  priority: "Priority",
  sku: "SKU",
  warehouse_id: "Warehouse",
  platform: "Platform",
  marketplace_account: "Account",
  qty_needed: "Quantity needed",
  due_date: "Due date",
  product_name: "Product name",
  reference_url: "Reference link",
  target_price: "Target price",
  mrp: "MRP",
};

export const NOTIFICATION_ICON_LABEL: Record<string, string> = {
  assigned: "Assigned",
  comment: "Comment",
  done: "Done",
  overdue: "Overdue",
  follow_up: "Follow-up",
  test: "Test",
  dispatch_risk: "Dispatch",
  listing_live: "Live",
  listing_not_found: "Check SKU",
  money_reminder: "Money",
};
