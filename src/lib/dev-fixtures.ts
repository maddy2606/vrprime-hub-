// Obviously fake data for the local-only /dev/preview screen. Never used in production.
import type { DeskData, DeskListing } from "@/lib/stock-analysis";
import type { SyncSummary } from "@/lib/stock-sync";
import type { NotificationRow, Person, Post, PostComment, PostEvent, Ticket, Warehouse } from "@/lib/types";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const FAKE_WAREHOUSES: Warehouse[] = ["Bangalore", "Bhiwandi", "Delhi", "Kolkata", "Lucknow"].map(
  (name, i) => ({ id: id(100 + i), name, flipkart_location_id: null, sort_order: i + 1 }),
);

export const FAKE_PEOPLE: Person[] = [
  { id: id(1), name: "Test Owner", role: "owner", active: true },
  { id: id(2), name: "Sample Manager", role: "manager", active: true },
  { id: id(3), name: "Demo Listing Person With A Long Name", role: "listing", active: true },
  { id: id(4), name: "Fake Warehouse BLR", role: "warehouse", active: true },
];

function day(offset: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(Date.now() + offset * 86_400_000);
}

const base: Post = {
  id: id(1000),
  number: 1001,
  type: "task",
  title: "",
  details: null,
  priority: "normal",
  priority_rank: 2,
  status: "open",
  sku: null,
  warehouse_id: null,
  platform: null,
  marketplace_account: null,
  qty_needed: null,
  assignee_id: id(1),
  created_by: id(2),
  due_date: null,
  done_at: null,
  done_by: null,
  done_ticket_id: null,
  done_no_ticket_reason: null,
  done_listing_id: null,
  done_qty: null,
  done_reference: null,
  done_note: null,
  created_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  updated_at: new Date(Date.now() - 3_600_000).toISOString(),
};

export const FAKE_POSTS: Post[] = [
  {
    ...base,
    id: id(1001),
    number: 1042,
    type: "problem",
    title: "Customer returned a different product for FAKE-SKU-RED-XL, box had a brick wrapped in newspaper inside",
    details: "Return received at the dock.\nOuter box was resealed with brown tape. Photos attached.",
    priority: "urgent",
    priority_rank: 4,
    status: "in_progress",
    sku: "FAKE-SKU-RED-XL-0001-VERYLONGSKUCODE-THAT-KEEPS-GOING",
    warehouse_id: id(100),
    platform: "flipkart",
    due_date: day(-3),
  },
  {
    ...base,
    id: id(1002),
    number: 1043,
    type: "restock",
    title: "Restock FAKE-SKU-BLU-M × 1,20,000 to Bhiwandi",
    sku: "FAKE-SKU-BLU-M",
    warehouse_id: id(101),
    qty_needed: 120000,
    priority: "high",
    priority_rank: 3,
    due_date: day(0),
  },
  {
    ...base,
    id: id(1003),
    number: 1044,
    type: "new_listing",
    title: "List the example steel bottle 750 ml",
    sku: "FAKE-BOTTLE-750",
    platform: "flipkart",
    status: "waiting",
    due_date: day(1),
    assignee_id: id(3),
  },
  { ...base, id: id(1004), number: 1045, title: "Count shelf C in the sample warehouse", due_date: day(9), warehouse_id: id(102) },
  { ...base, id: id(1005), number: 1046, title: "Call the pretend courier about pickup timing", priority: "low", priority_rank: 1 },
  {
    ...base,
    id: id(1006),
    number: 1039,
    type: "restock",
    title: "Restock FAKE-SKU-GRN-S × 400 to Delhi",
    sku: "FAKE-SKU-GRN-S",
    warehouse_id: id(102),
    qty_needed: 400,
    status: "done",
    done_at: new Date(Date.now() - 86_400_000).toISOString(),
    done_by: id(4),
    done_qty: 380,
    done_reference: "FAKE-INV-2026-0091",
    done_note: "20 units short, rest next week",
    due_date: day(-2),
  },
  {
    ...base,
    id: id(1007),
    number: 1006,
    type: "problem",
    title: "Wrong item returned",
    details: "Customer sent back a different colour.",
    status: "open",
    warehouse_id: id(102),
    platform: "flipkart",
    assignee_id: id(2),
  },
];

export const FAKE_COMMENTS: PostComment[] = [
  { id: id(2001), post_id: id(1001), author_id: id(4), body: "Opened the box on camera. Video is with me.", created_at: new Date(Date.now() - 7_200_000).toISOString() },
  { id: id(2002), post_id: id(1001), author_id: id(2), body: "Raise a wrong-return claim today please.", created_at: new Date(Date.now() - 3_600_000).toISOString() },
];

export const FAKE_EVENTS: PostEvent[] = [
  { id: 4, post_id: id(1001), actor_id: id(2), kind: "edit", changes: { priority: { from: "high", to: "urgent" }, due_date: { from: null, to: day(-3) } }, created_at: new Date(Date.now() - 3_000_000).toISOString() },
  { id: 3, post_id: id(1001), actor_id: id(2), kind: "assignee", changes: { from: null, to: id(1) }, created_at: new Date(Date.now() - 86_400_000).toISOString() },
  { id: 2, post_id: id(1001), actor_id: id(4), kind: "status", changes: { from: "open", to: "in_progress" }, created_at: new Date(Date.now() - 2 * 86_400_000).toISOString() },
  { id: 1, post_id: id(1001), actor_id: id(4), kind: "created", changes: { type: "problem" }, created_at: new Date(Date.now() - 3 * 86_400_000).toISOString() },
];

const ticketBase: Ticket = {
  id: id(3000),
  number: 118,
  ticket_id: "",
  platform: "flipkart",
  marketplace_account: null,
  issue_type: "other",
  post_id: null,
  sku: null,
  // The amount columns still exist in the database but are not used or shown anywhere.
  amount_involved: null,
  amount_recovered: null,
  raised_on: day(-6),
  next_follow_up: null,
  status: "open",
  resolution_notes: null,
  created_by: id(2),
  created_at: new Date(Date.now() - 6 * 86_400_000).toISOString(),
  updated_at: new Date(Date.now() - 86_400_000).toISOString(),
};

export const FAKE_TICKETS: Ticket[] = [
  {
    ...ticketBase,
    id: id(3001),
    number: 118,
    ticket_id: "FAKE-FK-CASE-2026-0004711-A-VERY-LONG-TICKET-REFERENCE",
    issue_type: "wrong_return",
    post_id: id(1001),
    sku: "FAKE-SKU-RED-XL",
    next_follow_up: day(-2),
  },
  {
    ...ticketBase,
    id: id(3002),
    number: 119,
    ticket_id: "FAKE-FK-CASE-0004712",
    issue_type: "payment_missing",
    post_id: id(1007),
    sku: "FAKE-SKU-BLU-M",
    next_follow_up: day(0),
  },
  {
    ...ticketBase,
    id: id(3003),
    number: 120,
    ticket_id: "FAKE-AMZ-0099",
    platform: "amazon",
    issue_type: "listing_blocked",
    status: "waiting_marketplace",
    next_follow_up: day(4),
  },
  {
    ...ticketBase,
    id: id(3004),
    number: 117,
    ticket_id: "FAKE-FK-CASE-0004650",
    issue_type: "claim",
    status: "resolved",
    resolution_notes: "Claim approved for 80%.",
  },
];

const note = (n: number, row: Omit<NotificationRow, "id" | "user_id" | "created_at" | "ticket_id" | "post_id"> & Partial<NotificationRow>): NotificationRow => ({
  id: id(4000 + n),
  user_id: id(1),
  post_id: null,
  ticket_id: null,
  created_at: new Date(Date.now() - n * 3_600_000 * 5).toISOString(),
  ...row,
});

export const FAKE_NOTIFICATIONS: NotificationRow[] = [
  note(0, { kind: "overdue", title: "2 overdue items", body: "VR-1042 Customer returned a different… · VR-1039 Count shelf C", read_at: null }),
  note(1, { kind: "assigned", title: "Assigned to you: VR-1046", body: "Call the pretend courier about pickup timing", post_id: id(1005), read_at: null }),
  note(2, { kind: "comment", title: "Sample Manager commented on VR-1042", body: "Raise a wrong-return claim today please.", post_id: id(1001), read_at: null }),
  note(3, { kind: "follow_up", title: "1 ticket follow-up due", body: "VR-T-119 (FAKE-FK-CASE-0004712)", ticket_id: id(3002), read_at: new Date().toISOString() }),
  note(4, { kind: "done", title: "VR-1039 marked done", body: "Fake Warehouse BLR marked it done: Restock FAKE-SKU-GRN-S × 400 to Delhi", post_id: id(1006), read_at: new Date().toISOString() }),
];

// --- Stock (fake) -----------------------------------------------------------------------------------

export const FAKE_SYNC: SyncSummary = {
  id: id(5000),
  status: "done",
  trigger: "cron",
  total: 66,
  cursor: 66,
  processed: 60,
  skippedFbf: 6,
  missing: 0,
  snapshotDate: day(0),
  finishedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  error: null,
};

/** 60 made-up SKUs with a mix of empty, low, healthy, inactive and heavy ones. */
export function fakeDesk(): DeskData {
  const warehouses = FAKE_WAREHOUSES.map((w) => ({ id: w.id, name: w.name }));
  const listings: DeskListing[] = Array.from({ length: 60 }, (_, k) => {
    const n = k + 1;
    const out = n % 11 === 0;
    const levels = (shift: number) =>
      warehouses.map((_, i) => {
        if ((n + i) % 6 === 0) return null;
        if (out) return 0;
        let qty = (n * 37 + i * 91 + shift) % 400;
        if ((n + i) % 5 === 0) qty = 0;
        else if ((n + i) % 4 === 0) qty %= 90;
        if (n === 3) qty = 120000 + i * 1500; // a big number, to check the Indian format
        return qty;
      });
    const now = levels(0);
    const inactive = n % 7 === 0;
    return {
      sku: n === 5 ? "FAKE-SKU-WITH-A-VERY-LONG-CODE-0005-EXTRA-LONG-PART" : `FAKE-SKU-${String(n).padStart(4, "0")}`,
      title: n === 5 ? "A pretend product with a very long title that has to wrap neatly onto more than one line in a narrow column" : `Fake Test Product ${n}`,
      status: inactive ? "INACTIVE" : "ACTIVE",
      listingId: `LSTFAKE${n}`,
      inactiveSince: inactive ? day(n % 14 === 0 ? 0 : -(n % 5)) : null,
      beforeTracking: inactive && n % 21 === 0,
      dims: n % 17 === 0 ? null : n % 13 === 0 ? { l: 30, b: 20, h: 10, kg: 1.2 } : { l: 3 + (n % 6), b: 3 + (n % 5), h: 2 + (n % 4), kg: 0.1 + (n % 5) * 0.2 },
      now,
      prev: levels(7).map((v, i) => (v === null ? null : n % 9 === 0 && i === 0 ? Math.max(v, 40) : v)),
      prevStatus: inactive && n % 14 === 0 ? "ACTIVE" : inactive ? "INACTIVE" : "ACTIVE",
    };
  });
  return {
    warehouses,
    listings,
    settings: { low: 100, weightLimit: 2000, newInactiveDays: 2 },
    today: day(0),
    snapshotDate: day(0),
    previousDate: day(-1),
    fullAccess: true,
  };
}
