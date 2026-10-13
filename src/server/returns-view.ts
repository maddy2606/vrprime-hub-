import "server-only";
import { logError } from "@/lib/redact";
import { readReturnsPage, readReturnsSummary, RETURNS_PAGE_SIZE, type ReturnsPage, type ReturnsQuery, type ReturnsSummary } from "@/lib/returns-view";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

function fail(where: string, error: unknown): never {
  logError(where, error);
  throw new Error("Could not load the returns");
}

const orNull = (s: string) => (s === "" ? null : s);

/** One page of returns (last 30 days): only the rows asked for leave the database. */
export async function loadReturnsPage(supabase: Supabase, q: ReturnsQuery, limit: number = RETURNS_PAGE_SIZE): Promise<ReturnsPage> {
  const { data, error } = await supabase.rpc("flipkart_returns_page", {
    p_wh: orNull(q.wh),
    p_source: q.source === "all" ? null : q.source,
    p_q: orNull(q.q),
    p_sort: q.sort,
    p_dir: q.dir,
    p_limit: limit,
    p_offset: q.offset,
  });
  if (error) fail("returns page", error);
  return readReturnsPage(data);
}

export async function loadReturnsSummary(supabase: Supabase, wh: string): Promise<ReturnsSummary> {
  const { data, error } = await supabase.rpc("flipkart_returns_summary", { p_wh: orNull(wh) });
  if (error) fail("returns summary", error);
  return readReturnsSummary(data);
}
