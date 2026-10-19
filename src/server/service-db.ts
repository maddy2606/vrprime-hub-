import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * An untyped service client for the tables the generated types do not list yet (WhatsApp and expenses). It bypasses RLS:
 * only use it after checking, on the server, that the signed-in person is the owner (or from server-only code).
 */
export function serverDb(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
