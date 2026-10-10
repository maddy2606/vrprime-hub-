import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/types";
import { supabaseEnv } from "./env";

/** Browser client, used only for uploading photos straight to Storage. */
export function createClient() {
  const { url, key } = supabaseEnv();
  return createBrowserClient<Database>(url, key);
}
