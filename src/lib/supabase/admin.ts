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

/**
 * Checks the shape of SUPABASE_SECRET_KEY without ever printing it.
 * Returns a message for the owner when the wrong kind of key was pasted.
 */
export function secretKeyProblem(): string | null {
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!key) return MISSING_SECRET_MESSAGE;
  if (key !== process.env.SUPABASE_SECRET_KEY) {
    return "SUPABASE_SECRET_KEY in Vercel has a space or line break around it. Paste it again without extra characters, then redeploy.";
  }
  if (key.startsWith("sb_publishable_")) {
    return "SUPABASE_SECRET_KEY in Vercel holds the publishable key. Replace it with the secret key (starts with sb_secret_), then redeploy.";
  }
  if (key.startsWith("sb_secret_")) return null;
  // Legacy keys are JWTs; the payload says which role they carry.
  const payload = key.split(".")[1];
  if (key.startsWith("eyJ") && payload) {
    try {
      const role: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).role;
      if (role === "service_role") return null;
      return "SUPABASE_SECRET_KEY in Vercel holds the anon key. Replace it with the secret key (starts with sb_secret_) or the service_role key, then redeploy.";
    } catch {
      // Fall through to the generic message.
    }
  }
  return "SUPABASE_SECRET_KEY in Vercel does not look like a Supabase secret key. It should start with sb_secret_. Paste it again, then redeploy.";
}

/** Turns a failed service-client call into a message the owner can act on. */
export function adminErrorMessage(error: { status?: number; code?: string; message: string }): string {
  const text = `${error.code ?? ""} ${error.message}`.toLowerCase();
  if (error.status === 401 || error.status === 403 || /invalid api key|unauthorized|not.?admin|bad.?jwt|no api key/.test(text)) {
    return "Supabase rejected SUPABASE_SECRET_KEY (invalid or revoked key, or a key from another project). Copy the secret key again from Supabase > Project Settings > API keys, update it in Vercel, then redeploy.";
  }
  return `Supabase could not list users (error ${error.status ?? "unknown"}: ${error.message}). Try again in a minute.`;
}

export const MISSING_SECRET_MESSAGE =
  "The server is missing SUPABASE_SECRET_KEY. Add it in Vercel > Settings > Environment Variables, then redeploy.";
