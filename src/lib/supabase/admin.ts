import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types";

/**
 * Service client that bypasses RLS. Only call it after checking, on the
 * server, that the signed-in user is allowed to do the thing.
 * Returns null when SUPABASE_SECRET_KEY is not set.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  return createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export const MISSING_SECRET_MESSAGE =
  "The server is missing SUPABASE_SECRET_KEY. Add it in Vercel > Settings > Environment Variables, then redeploy.";
