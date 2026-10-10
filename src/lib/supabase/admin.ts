import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { redactSecrets } from "@/lib/redact";
import type { Database } from "@/lib/types";

type AdminClient = SupabaseClient<Database>;
export type AdminResult = { admin: AdminClient; problem: null } | { admin: null; problem: string };

const MISSING =
  "The server is missing SUPABASE_SECRET_KEY. Add it in Vercel > Settings > Environment Variables, then redeploy.";
const HAS_SPACE = "The secret key in Vercel contains a space. Paste it again.";

/**
 * Checks SUPABASE_SECRET_KEY without ever printing it. Returns the cleaned key,
 * or a message the owner can act on. Spaces and line breaks around the key are
 * removed; any left inside it are rejected, because such a key cannot be sent
 * as a header and the resulting error would contain the key itself.
 */
function readSecretKey(): { key: string; problem: null } | { key: null; problem: string } {
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!key) return { key: null, problem: MISSING };
  if (/\s/.test(key)) return { key: null, problem: HAS_SPACE };
  if (!/^[\x21-\x7E]+$/.test(key)) {
    return { key: null, problem: "The secret key in Vercel contains an unusual character. Paste it again." };
  }
  if (key.startsWith("sb_publishable_")) {
    return {
      key: null,
      problem:
        "SUPABASE_SECRET_KEY in Vercel holds the publishable key. Replace it with the secret key (starts with sb_secret_), then redeploy.",
    };
  }
  if (key.startsWith("sb_secret_")) return { key, problem: null };
  // Legacy keys are JWTs; the payload says which role they carry.
  const payload = key.split(".")[1];
  if (key.startsWith("eyJ") && payload) {
    try {
      const role: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).role;
      if (role === "service_role") return { key, problem: null };
      return {
        key: null,
        problem:
          "SUPABASE_SECRET_KEY in Vercel holds the anon key. Replace it with the secret key (starts with sb_secret_), then redeploy.",
      };
    } catch {
      // Fall through to the generic message.
    }
  }
  return {
    key: null,
    problem:
      "SUPABASE_SECRET_KEY in Vercel does not look like a Supabase secret key. It should start with sb_secret_. Paste it again, then redeploy.",
  };
}

/**
 * Service client that bypasses RLS. Only call it after checking, on the
 * server, that the signed-in user is allowed to do the thing.
 * When the key is missing or malformed, returns a safe message instead.
 */
export function getAdmin(): AdminResult {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const { key, problem } = readSecretKey();
  if (problem !== null) return { admin: null, problem };
  if (!url) return { admin: null, problem: "The server is missing NEXT_PUBLIC_SUPABASE_URL." };
  return {
    admin: createClient<Database>(url, key, { auth: { autoRefreshToken: false, persistSession: false } }),
    problem: null,
  };
}

/** Turns a failed service-client call into a message the owner can act on. Never contains the key. */
export function adminErrorMessage(what: string, error: { status?: number; code?: string; message: string }): string {
  const text = `${error.code ?? ""} ${error.message}`.toLowerCase();
  if (error.status === 401 || error.status === 403 || /invalid api key|unauthorized|not.?admin|bad.?jwt|no api key/.test(text)) {
    return "Supabase rejected SUPABASE_SECRET_KEY (invalid or revoked key, or a key from another project). Copy the secret key again from Supabase > Project Settings > API keys, update it in Vercel, then redeploy.";
  }
  return redactSecrets(`Could not ${what} (error ${error.status ?? "unknown"}: ${error.message}).`);
}
