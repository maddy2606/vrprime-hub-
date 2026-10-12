// The six lists on the Stock page. A plain module, so server pages and the client screen can both use it
// (a server page importing a value from a "use client" file gets a stub, not the value).

export const VIEW_KEYS = ["low", "location", "out", "weight", "new", "inactive"] as const;
export type ViewKey = (typeof VIEW_KEYS)[number];

export function isViewKey(value: unknown): value is ViewKey {
  return typeof value === "string" && (VIEW_KEYS as readonly string[]).includes(value);
}
