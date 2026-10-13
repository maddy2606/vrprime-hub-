// What the Returns tab asks the server for, and what comes back. Plain values (no "use client", no server-only).
// The tab gets the totals and one page of returns at a time: there are thousands in 30 days.

import { z } from "zod";

export const RETURNS_PAGE_SIZE = 50;
export const RETURNS_INITIAL_PAGE_SIZE = 30;

export const returnsQuerySchema = z.object({
  source: z.enum(["all", "courier_return", "customer_return"]),
  wh: z.union([z.literal(""), z.string().uuid()]),
  q: z.string().max(100),
  sort: z.string().max(20),
  dir: z.enum(["asc", "desc"]),
  offset: z.number().int().min(0).max(100_000),
});
export type ReturnsQuery = z.infer<typeof returnsQuerySchema>;

export function defaultReturnsQuery(over: Partial<ReturnsQuery> = {}): ReturnsQuery {
  return { source: "all", wh: "", q: "", sort: "date", dir: "desc", offset: 0, ...over };
}

export type ReturnLine = {
  return_id: string;
  order_item_id: string;
  order_id: string | null;
  sku: string | null;
  quantity: number;
  warehouse_id: string | null;
  source: "courier_return" | "customer_return";
  return_status: string | null;
  reason: string | null;
  sub_reason: string | null;
  created_date: string | null;
};

export type ReturnsPage = { total: number; rows: ReturnLine[] };

export type ReturnsSummary = { courier_units: number; customer_units: number; courier_lines: number; customer_lines: number };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const num = (value: unknown): number => {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : 0;
};
const str = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

export function readReturnsPage(value: unknown): ReturnsPage {
  const o = isObject(value) ? value : {};
  const rows = Array.isArray(o.rows) ? o.rows.filter(isObject) : [];
  return {
    total: num(o.total),
    rows: rows
      .filter((r) => r.source === "courier_return" || r.source === "customer_return")
      .map((r) => ({
        return_id: String(r.return_id ?? ""),
        order_item_id: String(r.order_item_id ?? ""),
        order_id: str(r.order_id),
        sku: str(r.sku),
        quantity: num(r.quantity) || 1,
        warehouse_id: str(r.warehouse_id),
        source: r.source as "courier_return" | "customer_return",
        return_status: str(r.return_status),
        reason: str(r.reason),
        sub_reason: str(r.sub_reason),
        created_date: str(r.created_date),
      })),
  };
}

export function readReturnsSummary(value: unknown): ReturnsSummary {
  const o = isObject(value) ? value : {};
  return { courier_units: num(o.courier_units), customer_units: num(o.customer_units), courier_lines: num(o.courier_lines), customer_lines: num(o.customer_lines) };
}
