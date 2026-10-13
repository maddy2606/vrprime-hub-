import "server-only";
import { buildStockView, stockMeta, type StockMeta, type StockQuery, type StockViewData } from "@/lib/stock-view";
import { createClient } from "@/lib/supabase/server";
import type { SessionUser } from "@/lib/types";
import { coverBySku } from "@/lib/cover";
import { canSyncOrders, loadCover, loadFlipkartSettings, type CoverData } from "@/server/flipkart-data";
import { loadStockPage, type StockPage } from "@/server/stock-data";

export type StockDeskData =
  | { kind: "empty"; page: Extract<StockPage, { kind: "empty" }> }
  | {
      kind: "ready";
      page: Extract<StockPage, { kind: "ready" }>;
      meta: StockMeta;
      view: StockViewData;
      cover: CoverData;
      /** Days of cover for the warehouses this list is about (one if a warehouse is picked, else all). */
      soonest: ReturnType<typeof coverBySku>;
      /** Days of cover is flagged below this many days. */
      coverLimit: number;
    };

/**
 * Reads the snapshot and works the Stock tab out on the server. Only `view` (counts, tiles, cards and one page of the
 * list that is open) is sent to the browser; the snapshot itself never leaves the server.
 */
export async function loadStockDesk(user: SessionUser, q: StockQuery, limit?: number): Promise<StockDeskData> {
  const supabase = await createClient();
  const [page, settings, cover] = await Promise.all([loadStockPage(user, canSyncOrders(user)), loadFlipkartSettings(supabase), loadCover(supabase)]);
  if (page.kind === "empty") return { kind: "empty", page };
  // The same days of cover as Forecasting, for the warehouse picked (or all of them).
  const soonest = cover.state.state === "ready" ? coverBySku(cover.raw, cover.days, q.wh ? [q.wh] : null) : {};
  return {
    kind: "ready",
    page,
    meta: stockMeta(page.data),
    view: buildStockView(page.data, q, soonest, limit),
    cover,
    soonest,
    coverLimit: settings.runningOutDays,
  };
}
