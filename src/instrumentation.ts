import { redactSecrets } from "@/lib/redact";

// Safety net for the server log. Our own code logs through logError(), but
// Next.js and libraries also write errors (for example an uncaught exception in
// a page). Everything written to the console on the server is redacted here, so
// a key inside an error message can never reach the Vercel logs.
export function register() {
  const clean = (value: unknown): unknown => {
    if (typeof value === "string") return redactSecrets(value);
    if (value instanceof Error) {
      const digest = (value as Error & { digest?: unknown }).digest;
      const stack = value.stack ? `\n${redactSecrets(value.stack.split("\n").slice(1).join("\n"))}` : "";
      return `${value.name}: ${redactSecrets(value.message)}${typeof digest === "string" ? ` (digest ${digest})` : ""}${stack}`;
    }
    if (value && typeof value === "object") {
      try {
        return redactSecrets(JSON.stringify(value));
      } catch {
        return "[unprintable object]";
      }
    }
    return value;
  };

  for (const level of ["error", "warn", "log", "info"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => original(...args.map(clean));
  }
}
