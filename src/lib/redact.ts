// Keeps keys and tokens out of anything a person can read: pages, toasts,
// server action results and server logs. Some libraries put the whole
// Authorization header in their error text, e.g.
//   Headers.append: "Bearer sb_secret_..." is an invalid header value
// so no raw error message may be shown or logged without going through here.

const REDACTED = "[redacted]";

// Environment variables whose values must never appear in output.
const SECRET_ENV_NAMES = ["SUPABASE_SECRET_KEY", "VAPID_PRIVATE_KEY", "FLIPKART_APP_SECRET"];

const MARKER = String.raw`(?:sb_secret_|sb_publishable_|eyJ[A-Za-z0-9_-]{5,}|Bearer\s)`;
// A quoted string that contains a key or token: drop the whole quoted part,
// because a mis-pasted key can contain spaces.
const QUOTED = new RegExp(String.raw`(["'\`])[^"'\`\n]*${MARKER}[^"'\`\n]*\1`, "gi");
const BEARER = /Bearer\s+[^\s"'`,;)]+/gi;
const SUPABASE_KEY = /sb_(?:secret|publishable)_[^\s"'`,;)]*/gi;
const JWT = /eyJ[A-Za-z0-9_-]{5,}(?:\.[A-Za-z0-9_-]+){0,2}/g;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The configured secrets, whole and split at whitespace, longest first. */
function knownSecrets(): string[] {
  const found = new Set<string>();
  for (const name of SECRET_ENV_NAMES) {
    const raw = process.env[name];
    if (!raw) continue;
    for (const part of [raw, raw.trim(), ...raw.split(/\s+/)]) {
      if (part.length >= 8) found.add(part);
    }
  }
  return [...found].sort((a, b) => b.length - a.length);
}

/** Replaces anything that looks like a key or token with "[redacted]". */
export function redactSecrets(input: unknown): string {
  let text = typeof input === "string" ? input : String(input ?? "");
  for (const secret of knownSecrets()) {
    text = text.replace(new RegExp(escapeRegExp(secret), "g"), REDACTED);
  }
  return text
    .replace(QUOTED, REDACTED)
    .replace(BEARER, REDACTED)
    .replace(SUPABASE_KEY, REDACTED)
    .replace(JWT, REDACTED);
}

type ErrorLike = { name?: unknown; message?: unknown; status?: unknown; code?: unknown; details?: unknown; hint?: unknown };

/** A small, redacted description of any thrown value or Supabase error. */
export function safeError(error: unknown): Record<string, string | number> {
  if (error === null || typeof error !== "object") return { message: redactSecrets(error) };
  const e = error as ErrorLike;
  const out: Record<string, string | number> = {};
  if (typeof e.status === "number") out.status = e.status;
  for (const key of ["name", "code", "message", "details", "hint"] as const) {
    const value = e[key];
    if (typeof value === "string" && value) out[key] = redactSecrets(value);
  }
  if (!("message" in out)) out.message = "no message";
  return out;
}

/** The only way server code should write an error to the log. */
export function logError(where: string, error: unknown): void {
  console.error(`[${where}]`, JSON.stringify(safeError(error)));
}
