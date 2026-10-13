// Saves imported rows through the database functions (public.money_*), which only an owner (or the service role,
// for the import script) may call. Works with any Supabase client: the browser one runs as the signed-in owner.
import type { FinishInfo, ReportKind, Sink } from "./import.ts";

type RpcResult = { data: unknown; error: { message: string } | null };
export type RpcClient = { rpc(fn: string, args?: Record<string, unknown>): PromiseLike<RpcResult> };

async function call(client: RpcClient, fn: string, args: Record<string, unknown>): Promise<unknown> {
  let last = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { data, error } = await client.rpc(fn, args);
    if (!error) return data;
    last = error.message;
    // A refusal is not worth retrying.
    if (/not allowed|permission denied|violates|invalid input/i.test(last)) break;
    await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
  }
  throw new Error(`Saving failed (${fn}): ${last}`);
}

export function databaseSink(client: RpcClient): Sink {
  return {
    async begin(kind: ReportKind, filename: string) {
      return (await call(client, "money_begin_upload", { p_kind: kind, p_filename: filename })) as string;
    },
    async addSettled(upload, rows) {
      await call(client, "money_add_settled", { p_upload: upload, p_rows: rows });
    },
    async addOther(upload, rows) {
      await call(client, "money_add_other", { p_upload: upload, p_rows: rows });
    },
    async addPnl(upload, rows) {
      await call(client, "money_add_pnl", { p_upload: upload, p_rows: rows });
    },
    async finish(upload, summary) {
      return (await call(client, "money_finish_upload", { p_upload: upload, p_summary: summary })) as FinishInfo;
    },
    async fail(upload, message) {
      await call(client, "money_fail_upload", { p_upload: upload, p_error: message });
    },
  };
}
