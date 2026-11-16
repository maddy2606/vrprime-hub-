import "server-only";
import { getSessionUser } from "@/lib/auth";
import { shortCache } from "@/server/short-cache";

/** The lifetime of every cached loader (graphite-spec 10.2). */
export const SHORT_CACHE_MS = 30_000;

/**
 * `load` through the short cache, keyed by the signed-in user's id, the function name and the JSON of its arguments.
 * With nobody signed in it simply loads.
 */
export async function forUser<T>(name: string, args: unknown[], load: () => Promise<T>): Promise<T> {
  const user = await getSessionUser();
  if (!user) return load();
  return shortCache(`${user.id}:${name}:${JSON.stringify(args)}`, SHORT_CACHE_MS, load);
}
