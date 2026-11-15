/**
 * A short in-memory cache for heavy read-only loaders (graphite-spec 10.2). Each key holds the promise of one load and
 * when it started; a caller within `ttlMs` gets the same promise. A rejected load is dropped at once so the next caller
 * tries again. At most 500 keys are kept (the oldest goes first). Keys start with the signed-in user's id (see
 * `forUser` in short-cache-user.ts) so one user never sees another's data.
 */
type Entry = { at: number; promise: Promise<unknown> };

const MAX_KEYS = 500;
const store = new Map<string, Entry>();

export function shortCache<T>(key: string, ttlMs: number, load: () => Promise<T>, now: () => number = Date.now): Promise<T> {
  const hit = store.get(key);
  const t = now();
  if (hit && t - hit.at < ttlMs) return hit.promise as Promise<T>;
  const promise = load();
  // Re-insert so the Map's order stays oldest first.
  store.delete(key);
  store.set(key, { at: t, promise });
  while (store.size > MAX_KEYS) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
  promise.catch(() => {
    if (store.get(key)?.promise === promise) store.delete(key);
  });
  return promise;
}

/** Forgets everything: called after a sync starts or a report is uploaded. */
export function clearShortCache(): void {
  store.clear();
}

/** How many keys are held (for tests). */
export function shortCacheSize(): number {
  return store.size;
}
