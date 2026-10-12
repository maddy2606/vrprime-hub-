// Turning Flipkart's shipments and returns into what we save, and deciding what to ask for.
// Pure functions, no network: easy to test.
//
// PRIVACY: this is the only place that reads Flipkart's answers, and it copies named fields
// only. Anything else in the answer (buyer names, phones, addresses, prices paid, the free-text
// `comments` of a return, titles, tracking numbers) is never copied, so it cannot be saved or logged.

import type { ReturnsRequest, ShipmentsRequest } from "./flipkart.ts";

// --- The plan -----------------------------------------------------------------------------------------

export type Topic =
  | { t: "pre"; state: string; loc?: string; from?: string; to?: string }
  | { t: "post"; from: string; to: string; day?: string; only?: "SHIPPED" }
  | { t: "cancel"; type: "sellerCancellation" | "buyerCancellation"; from: string; to: string }
  | { t: "returns"; source: "courier_return" | "customer_return"; since: "createdAfter" | "modifiedAfter"; at: string };

export const PRE_DISPATCH_STATES = ["APPROVED", "PACKING_IN_PROGRESS", "PACKED", "READY_TO_DISPATCH", "FORM_FAILED"];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The plan was written by our own database, but it is checked anyway before it becomes a request. */
export function readTopic(value: unknown): Topic | null {
  if (!isObject(value)) return null;
  const iso = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(v);
  switch (value.t) {
    case "pre":
      if (typeof value.state !== "string" || !PRE_DISPATCH_STATES.includes(value.state)) return null;
      const loc = typeof value.loc === "string" && /^[A-Za-z0-9_-]{3,80}$/.test(value.loc) ? { loc: value.loc } : {};
      return iso(value.from) && iso(value.to) ? { t: "pre", state: value.state, ...loc, from: value.from, to: value.to } : { t: "pre", state: value.state, ...loc };
    case "post":
      // `only: SHIPPED` is the nightly In Transit read: shipped and not yet delivered.
      return iso(value.from) && iso(value.to) ? { t: "post", from: value.from, to: value.to, ...(value.only === "SHIPPED" ? { only: "SHIPPED" as const } : {}) } : null;
    case "cancel":
      return (value.type === "sellerCancellation" || value.type === "buyerCancellation") && iso(value.from) && iso(value.to)
        ? { t: "cancel", type: value.type, from: value.from, to: value.to }
        : null;
    case "returns":
      return (value.source === "courier_return" || value.source === "customer_return") &&
        (value.since === "createdAfter" || value.since === "modifiedAfter") &&
        iso(value.at)
        ? { t: "returns", source: value.source, since: value.since, at: value.at }
        : null;
    default:
      return null;
  }
}

/** What to ask Flipkart for, for one part of the plan. Returns are asked for differently from shipments. */
export function requestFor(topic: Topic): { kind: "shipments"; request: ShipmentsRequest } | { kind: "returns"; request: ReturnsRequest } {
  switch (topic.t) {
    case "pre":
      return {
        kind: "shipments",
        // PACKING_IN_PROGRESS with the dispatch-date sort makes Flipkart answer 500, so it is read unsorted.
        // Only orders due within the window: Flipkart lists orders scheduled weeks ahead too, thousands of them.
        request: {
          filter: { type: "preDispatch", states: [topic.state], ...(topic.loc ? { locationId: topic.loc } : {}), ...(topic.from && topic.to ? { dispatchByDate: { from: topic.from, to: topic.to } } : {}) },
          sorted: topic.state !== "PACKING_IN_PROGRESS",
        },
      };
    case "post":
      return {
        kind: "shipments",
        request: {
          filter: { type: "postDispatch", states: topic.only ? [topic.only] : ["SHIPPED", "DELIVERED"], shipmentTypes: ["NORMAL"], orderDate: { from: topic.from, to: topic.to } },
          sorted: true,
        },
      };
    case "cancel":
      return {
        kind: "shipments",
        request: {
          filter: { type: "cancelled", states: ["Cancelled"], cancellationType: topic.type, cancellationDate: { from: topic.from, to: topic.to } },
          sorted: true,
        },
      };
    case "returns":
      return { kind: "returns", request: { source: topic.source, since: topic.since, at: topic.at } };
  }
}

// --- Reading values ------------------------------------------------------------------------------------

/** A short piece of text with whitespace tidied. Not for SKUs (those keep their exact spelling). */
function text(value: unknown, max = 80): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned === "" ? null : cleaned.slice(0, max);
}

/** An identifier, exactly as given (no trimming inside), or null when it is empty. */
function id(value: unknown, max = 100): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string" || value.trim() === "") return null;
  return value.slice(0, max);
}

/** A SKU keeps its spaces: a SKU that starts or ends with one is a problem we want to show. */
function sku(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.slice(0, 200) : null;
}

function quantity(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 100_000) : 1;
}

function date(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

// --- Shipments -> order items -----------------------------------------------------------------------------

/** What orders_apply_page expects for each order item. */
export type OrderItemRow = {
  order_item_id: string;
  order_id: string;
  shipment_id: string | null;
  sku: string | null;
  quantity: number;
  order_date: string | null;
  location_id: string | null;
  status: string | null;
  hold: boolean;
  dispatch_by: string | null;
  dispatch_after: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  cancel_sub_reason: string | null;
};

export function normalizeShipments(shipments: unknown[]): { items: OrderItemRow[]; seen: number } {
  const items: OrderItemRow[] = [];
  let seen = 0;
  for (const shipment of shipments) {
    if (!isObject(shipment)) continue;
    const orderItems = Array.isArray(shipment.orderItems) ? shipment.orderItems : [];
    for (const raw of orderItems) {
      if (!isObject(raw)) continue;
      seen += 1;
      const orderItemId = id(raw.orderItemId);
      const orderId = id(raw.orderId);
      if (!orderItemId || !orderId) continue;
      items.push({
        order_item_id: orderItemId,
        order_id: orderId,
        shipment_id: id(shipment.shipmentId),
        sku: sku(raw.sku),
        quantity: quantity(raw.quantity),
        order_date: date(raw.orderDate),
        location_id: id(shipment.locationId),
        status: text(raw.status, 40),
        hold: shipment.hold === true,
        dispatch_by: date(shipment.dispatchByDate),
        dispatch_after: date(shipment.dispatchAfterDate),
        cancelled_at: date(raw.cancellationDate),
        cancel_reason: text(raw.cancellationReason),
        cancel_sub_reason: text(raw.cancellationSubReason),
      });
    }
  }
  return { items, seen };
}

// --- Returns -----------------------------------------------------------------------------------------------

/** What orders_apply_page expects for each return. There is no SKU: it is found from the order. */
export type ReturnRow = {
  return_id: string | null;
  order_item_id: string;
  order_id: string | null;
  quantity: number;
  location_id: string | null;
  status: string | null;
  reason: string | null;
  sub_reason: string | null;
  shipment_status: string | null;
  order_date: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export function normalizeReturns(items: unknown[]): ReturnRow[] {
  const rows: ReturnRow[] = [];
  for (const raw of items) {
    if (!isObject(raw)) continue;
    const orderItemId = id(raw.orderItemId);
    if (!orderItemId) continue;
    rows.push({
      return_id: id(raw.returnId),
      order_item_id: orderItemId,
      order_id: id(raw.orderId),
      quantity: quantity(raw.quantity),
      location_id: id(raw.locationId),
      status: text(raw.status, 40),
      reason: text(raw.reason),
      sub_reason: text(raw.subReason),
      shipment_status: text(raw.shipmentStatus, 40),
      order_date: date(raw.orderDate),
      created_at: date(raw.createdDate),
      updated_at: date(raw.updatedDate),
    });
  }
  return rows;
}

// --- The night window -------------------------------------------------------------------------------------------

/** IST 22:15 to 06:45: when the long backfill may run. The database has the same rule (private.is_night_ist). */
export function isNightIST(at: Date): boolean {
  const minutes = (at.getUTCHours() * 60 + at.getUTCMinutes() + 330) % 1440;
  return minutes >= 22 * 60 + 15 || minutes < 6 * 60 + 45;
}
