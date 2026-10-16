// Hand-written row types that mirror supabase/migrations. Keep them in step
// with the migrations when the schema changes.

export const ROLES = ["owner", "admin", "warehouse"] as const;
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

export const TICKET_STATUSES = ["open", "waiting_marketplace", "resolved", "rejected"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const OPEN_TICKET_STATUSES: TicketStatus[] = ["open", "waiting_marketplace"];

export const ISSUE_TYPES = ["wrong_return", "payment_missing", "listing_blocked", "claim", "other", "weight_overcharge", "wrong_fee"] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

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
  // New-listing requests: optional details, then what the stock sync found on Flipkart.
  product_name: string | null;
  reference_url: string | null;
  target_price: number | null;
  mrp: number | null;
  dim_l: number | null;
  dim_b: number | null;
  dim_h: number | null;
  weight_kg: number | null;
  live_found: boolean | null;
  live_status: string | null;
  live_since: string | null;
  live_checked_at: string | null;
  live_alerted_at: string | null;
  live_package: { l: number; b: number; h: number; kg: number; total: number } | null;
  live_over_weight: boolean | null;
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
  kind: "created" | "status" | "assignee" | "edit" | "ticket";
  changes: Json;
  created_at: string;
};

export type Ticket = {
  id: string;
  number: number;
  ticket_id: string;
  platform: Platform;
  marketplace_account: string | null;
  issue_type: IssueType;
  post_id: string | null;
  sku: string | null;
  amount_involved: number | null;
  raised_on: string;
  next_follow_up: string | null;
  status: TicketStatus;
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

export type StockRun = {
  id: string;
  platform: Platform;
  trigger: "cron" | "manual";
  requested_by: string | null;
  status: "queued" | "running" | "done" | "failed";
  stage: string | null;
  snapshot_date: string | null;
  first_sync: boolean;
  skus: string[];
  total: number;
  cursor: number;
  processed: number;
  skipped_fbf: number;
  missing: number;
  unmapped_locations: number;
  attempts: number;
  lease_until: string | null;
  error: string | null;
  notes: Json;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
};

export type StockListing = {
  platform: Platform;
  sku: string;
  listing_id: string | null;
  product_id: string | null;
  title: string | null;
  product_url: string | null;
  status: string;
  mrp: number | null;
  selling_price: number | null;
  currency: string | null;
  fulfillment_profile: string | null;
  fulfillment: Json | null;
  packages: Json;
  archived_status: string | null;
  first_seen_date: string;
  last_seen_date: string;
  last_run_id: string | null;
  inactive_since: string | null;
  inactive_before_tracking: boolean;
  hsn: string | null;
  tax_code: string | null;
  tax_read: boolean;
  updated_at: string;
};

export type StockPrice = {
  platform: Platform;
  snapshot_date: string;
  sku: string;
  mrp: number | null;
  selling_price: number | null;
};

export type PriceChangeRow = {
  id: string;
  platform: Platform;
  sku: string;
  change_date: string;
  old_mrp: number | null;
  new_mrp: number | null;
  old_selling_price: number | null;
  new_selling_price: number | null;
  created_at: string;
};

/** The columns of an order run that the app may read (Flipkart's page addresses and the plan are not among them). */
export type OrderRun = {
  id: string;
  platform: Platform;
  kind: "pending" | "daily" | "backfill" | "upcoming";
  trigger: "cron" | "manual";
  status: "queued" | "running" | "paused" | "done" | "failed";
  step: number;
  parts: number;
  pages: number;
  items_seen: number;
  items_saved: number;
  returns_saved: number;
  coverage_from: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
};

export type FkOrderItem = {
  platform: Platform;
  order_item_id: string;
  order_id: string;
  shipment_id: string | null;
  sku: string | null;
  quantity: number;
  order_date: string | null;
  order_day: string | null;
  location_id: string | null;
  warehouse_id: string | null;
  stage: "pending" | "dispatched" | "cancelled" | "left_pending";
  item_status: string | null;
  hold: boolean;
  dispatch_by: string | null;
  dispatch_after: string | null;
  cancel_type: "seller" | "buyer" | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  cancel_sub_reason: string | null;
  alerted_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  last_run_id: string | null;
};

export type FkReturn = {
  platform: Platform;
  return_id: string;
  order_item_id: string;
  order_id: string | null;
  source: "courier_return" | "customer_return";
  sku: string | null;
  quantity: number;
  location_id: string | null;
  warehouse_id: string | null;
  return_status: string | null;
  reason: string | null;
  sub_reason: string | null;
  shipment_status: string | null;
  order_date: string | null;
  created_date: string | null;
  updated_date: string | null;
  first_seen_at: string;
  last_run_id: string | null;
};

/** A master product: one product that several channel SKUs belong to. */
export type MasterProduct = { id: string; name: string; created_at: string };

/** Which master product a channel SKU belongs to (the SKU exactly as written). */
export type SkuMaster = { channel_sku: string; master_id: string; updated_at: string };

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
      stock_runs: Table<StockRun>;
      stock_listings: Table<StockListing>;
      stock_prices: Table<StockPrice>;
      price_changes: Table<PriceChangeRow>;
      order_runs: Table<OrderRun>;
      fk_order_items: Table<FkOrderItem>;
      fk_returns: Table<FkReturn>;
      master_products: Table<MasterProduct>;
      sku_master: Table<SkuMaster>;
    };
    Views: { [_ in never]: never };
    Functions: {
      search_posts: { Args: { q: string }; Returns: Post[] };
      search_tickets: { Args: { q: string }; Returns: Ticket[] };
      ticket_counts: {
        Args: { q?: string; p_platform?: string | null; p_issue?: string | null };
        Returns: { open_count: number; waiting_count: number; follow_up_due: number; closed_count: number }[];
      };
      stock_snapshot: { Args: { p_date: string }; Returns: Json };
      request_stock_sync: { Args: Record<string, never>; Returns: string };
      request_orders_sync: { Args: { p_kind: "pending" | "daily" | "upcoming" }; Returns: string };
      flipkart_in_transit: { Args: Record<string, never>; Returns: { warehouse_id: string | null; shipments: number }[] };
      flipkart_sales_rates: { Args: Record<string, never>; Returns: Json };
      flipkart_stock_drops: { Args: Record<string, never>; Returns: Json };
      flipkart_return_rates: { Args: { p_days?: number }; Returns: Json };
      flipkart_snapshot_date: { Args: Record<string, never>; Returns: string | null };
      flipkart_forecast: { Args: { p_days?: number }; Returns: Json };
      replace_master_skus: { Args: { p_rows: { master: string; sku: string }[] }; Returns: Json };
      deck_series: { Args: { p_low?: number }; Returns: Json };
      dispatch_series: { Args: { p_days?: number }; Returns: Json };
      flipkart_order_counts: { Args: Record<string, never>; Returns: Json };
      flipkart_order_skus: {
        Args: { p_wh?: string | null; p_status?: string; p_q?: string | null; p_sort?: string; p_dir?: string; p_limit?: number; p_offset?: number };
        Returns: Json;
      };
      flipkart_order_lines: {
        Args: { p_wh?: string | null; p_status?: string; p_sku?: string | null; p_q?: string | null; p_sort?: string; p_dir?: string; p_limit?: number; p_offset?: number };
        Returns: Json;
      };
      flipkart_sku_stock: { Args: { p_sku: string }; Returns: Json };
      flipkart_pick_list: {
        Args: { p_wh: string; p_today_only?: boolean; p_q?: string | null; p_sort?: string; p_dir?: string; p_limit?: number; p_offset?: number };
        Returns: Json;
      };
      flipkart_upcoming_vs_stock: {
        Args: { p_wh?: string | null; p_short_only?: boolean; p_q?: string | null; p_sort?: string; p_dir?: string; p_limit?: number; p_offset?: number };
        Returns: Json;
      };
      flipkart_cancel_summary: { Args: { p_wh?: string | null }; Returns: Json };
      flipkart_cancel_lines: {
        Args: { p_wh?: string | null; p_type?: string | null; p_q?: string | null; p_sort?: string; p_dir?: string; p_limit?: number; p_offset?: number };
        Returns: Json;
      };
      flipkart_empty_with_orders: { Args: Record<string, never>; Returns: Json };
      flipkart_returns_summary: { Args: { p_wh?: string | null }; Returns: Json };
      flipkart_returns_page: {
        Args: { p_wh?: string | null; p_source?: string | null; p_q?: string | null; p_sort?: string; p_dir?: string; p_limit?: number; p_offset?: number };
        Returns: Json;
      };
      flipkart_stock_units: { Args: Record<string, never>; Returns: Json };
      send_test_notification: { Args: Record<string, never>; Returns: undefined };
      register_push_subscription: {
        Args: { p_endpoint: string; p_p256dh: string; p_auth: string };
        Returns: undefined;
      };
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
