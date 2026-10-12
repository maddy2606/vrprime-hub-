import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import type { z } from "zod";
import { logError } from "@/lib/redact";
import type { ActionResult } from "@/lib/types";
import { fieldErrors } from "@/lib/validation";

// Shared by the server actions. Not a "use server" file: these are plain helpers.

export const NOT_SIGNED_IN: ActionResult<never> = {
  ok: false,
  message: "You are signed out. Sign in again.",
};

/** Logs the (redacted) database error and returns a message that is safe to show. */
export function dbError(
  error: PostgrestError | { message: string; code?: string },
  what: string,
): ActionResult<never> {
  logError(what, error);
  if ("code" in error && error.code === "42501") {
    return { ok: false, message: "You do not have access to do that." };
  }
  return { ok: false, message: `Could not ${what}. Check your connection and try again.` };
}

export function invalid(error: z.ZodError): ActionResult<never> {
  return { ok: false, message: "Check the highlighted fields.", fieldErrors: fieldErrors(error) };
}
