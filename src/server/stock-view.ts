import "server-only";
import { todayIST } from "@/lib/format";
import { buildStockView, stockMeta, type StockMeta, type StockQuery, type StockViewData } from "@/lib/stock-view";
import { createClient } from "@/lib/supabase/server";
import type { SessionUser } from "@/lib/types";
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
      /** Days of cover is flagged below this many days. */
      coverLimit: number;
    };

/**
 * Reads the snapshot and works the Stock tab out on the server. Only `view` (counts, tiles, cards and one page of the
 * list that is open) is sent to the browser; the snapshot itself never leaves the server.
 */
export async function loadStockDesk(user: SessionUser, q: StockQuery): Promise<StockDeskData> {
  const supabase = await createClient();
  const [page, settings, cover] = await Promise.all([loadStockPage(user, canSyncOrders(user)), loadFlipkartSettings(supabase), loadCover(supabase, todayIST())]);
  if (page.kind === "empty") return { kind: "empty", page };
  return {
    kind: "ready",
    page,
    meta: stockMeta(page.data),
    view: buildStockView(page.data, q, cover.soonest),
    cover,
    coverLimit: settings.runningOutDays,
  };
}
