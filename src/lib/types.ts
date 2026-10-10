// Hand-written row types that mirror supabase/migrations. Keep them in step
// with the migrations when the schema changes.

export const ROLES = ["owner", "manager", "listing", "warehouse"] as const;
export type Role = (typeof ROLES)[number];

export const POST_TYPES = ["task", "new_listing", "problem", "restock"] as const;
export type PostType = (typeof POST_TYPES)[number];

export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const POST_STATUSES = ["open", "in_progress", "waiting", "done", "cancelled"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];
export const ACTIVE_STATUSES: PostStatus[] = ["open", "in_progress", "waiting"];

export const PLATFORMS = ["flipkart", "amazon", "other"] as const;
export type Platform = (typeof PLATFORMS)[number];

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Profile = {
  id: string;
  name: string;
  role: Role;
  phone: string | null;
  active: boolean;
  must_change_password: boolean;
  created_at: string;
};

export type Warehouse = {
  id: string;
  name: string;
  flipkart_location_id: string | null;
  sort_order: number;
};

export type UserWarehouse = { user_id: string; warehouse_id: string };

export type Post = {
  id: string;
  number: number;
  type: PostType;
  title: string;
  details: string | null;
  priority: Priority;
  priority_rank: number | null;
  status: PostStatus;
  sku: string | null;
  warehouse_id: string | null;
  platform: Platform | null;
  marketplace_account: string | null;
  qty_needed: number | null;
  assignee_id: string | null;
  created_by: string;
  due_date: string | null;
  done_at: string | null;
  done_by: string | null;
  done_ticket_id: string | null;
  done_no_ticket_reason: string | null;
  done_listing_id: string | null;
  done_qty: number | null;
  done_reference: string | null;
  done_note: string | null;
  created_at: string;
  updated_at: string;
};

export type PostComment = {
  id: string;
  post_id: string;
  author_id: string;
  body: string;
  created_at: string;
};

export type PostAttachment = {
  id: string;
  post_id: string;
  path: string;
  uploaded_by: string;
  created_at: string;
};

export type PostEvent = {
  id: number;
  post_id: string;
  actor_id: string | null;
  kind: "created" | "status" | "assignee" | "edit";
  changes: Json;
  created_at: string;
};

export type Ticket = {
  id: string;
  number: number;
  ticket_id: string;
  platform: Platform;
  marketplace_account: string | null;
  issue_type: "wrong_return" | "payment_missing" | "listing_blocked" | "claim" | "other";
  post_id: string | null;
  sku: string | null;
  amount_involved: number | null;
  raised_on: string;
  next_follow_up: string | null;
  status: "open" | "waiting_marketplace" | "resolved" | "rejected";
  resolution_notes: string | null;
  amount_recovered: number | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type PushSubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: string;
};

export type NotificationRow = {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string | null;
  post_id: string | null;
  ticket_id: string | null;
  read_at: string | null;
  created_at: string;
};

export type AppSetting = {
  key: string;
  value: Json;
  updated_at: string;
  updated_by: string | null;
};

type Table<Row> = { Row: Row; Insert: Partial<Row>; Update: Partial<Row>; Relationships: [] };

export type Database = {
  public: {
    Tables: {
      profiles: Table<Profile>;
      warehouses: Table<Warehouse>;
      user_warehouses: Table<UserWarehouse>;
      posts: Table<Post>;
      post_comments: Table<PostComment>;
      post_attachments: Table<PostAttachment>;
      post_events: Table<PostEvent>;
      tickets: Table<Ticket>;
      push_subscriptions: Table<PushSubscriptionRow>;
      notifications: Table<NotificationRow>;
      app_settings: Table<AppSetting>;
    };
    Views: { [_ in never]: never };
    Functions: {
      search_posts: { Args: { q: string }; Returns: Post[] };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

/** Result of every server action, shown to the user as a toast. */
export type ActionResult<T = undefined> =
  | { ok: true; message: string; data?: T }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

export type SessionUser = Profile & { email: string | null; warehouseIds: string[] };

export type Person = Pick<Profile, "id" | "name" | "role" | "active">;
