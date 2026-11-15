// Listing check screen (graphite-spec 12.3): the latest check's rows with their Review tracker link, counted and filtered.
// The page reading itself is in listing-check.ts (copied to the PC); this file is only for the screen.

export type CheckStatus = "buyable" | "out_of_stock" | "unavailable" | "not_read";

export type CheckRow = {
  rowNo: number;
  product: string;
  platform: string;
  priority: number | null;
  url: string;
  status: CheckStatus;
  price: number | null;
  expectedPrice: number | null;
};

export const STATUS_LABEL: Record<CheckStatus, string> = {
  buyable: "Buyable",
  out_of_stock: "Out of stock",
  unavailable: "Unavailable",
  not_read: "Not read",
};

/** The Status Chip: green, amber, red, neutral. */
export const STATUS_TONE: Record<CheckStatus, "ok" | "warn" | "bad" | "neutral"> = {
  buyable: "ok",
  out_of_stock: "warn",
  unavailable: "bad",
  not_read: "neutral",
};

const STATUSES = new Set<string>(["buyable", "out_of_stock", "unavailable", "not_read"]);

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Reads listing_check_rows joined with review_links (as `review_links`). */
export function readCheckRows(raw: unknown): CheckRow[] {
  if (!Array.isArray(raw)) return [];
  const out: CheckRow[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const l = (Array.isArray(o.review_links) ? o.review_links[0] : o.review_links) as Record<string, unknown> | null | undefined;
    const rowNo = num(o.row_no);
    if (rowNo === null || typeof o.status !== "string" || !STATUSES.has(o.status)) continue;
    out.push({
      rowNo,
      product: typeof l?.product === "string" ? l.product : `Row ${rowNo}`,
      platform: typeof l?.platform === "string" ? l.platform : "—",
      priority: num(l?.priority),
      url: typeof l?.url === "string" ? l.url : "",
      status: o.status as CheckStatus,
      price: num(o.price),
      expectedPrice: num(o.expected_price),
    });
  }
  return out.sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999) || a.rowNo - b.rowNo);
}

/** The page's price differs from ours by ₹1 or more (only when both are known). */
export function priceDiffers(r: Pick<CheckRow, "price" | "expectedPrice">): boolean {
  return r.price !== null && r.expectedPrice !== null && Math.abs(r.price - r.expectedPrice) >= 1;
}

/** A problem: anything not buyable, or a price that differs. */
export function isProblem(r: CheckRow): boolean {
  return r.status !== "buyable" || priceDiffers(r);
}

export function checkCounts(rows: CheckRow[]): { buyable: number; outOfStock: number; unavailable: number; differs: number; notRead: number } {
  return {
    buyable: rows.filter((r) => r.status === "buyable").length,
    outOfStock: rows.filter((r) => r.status === "out_of_stock").length,
    unavailable: rows.filter((r) => r.status === "unavailable").length,
    differs: rows.filter(priceDiffers).length,
    notRead: rows.filter((r) => r.status === "not_read").length,
  };
}
