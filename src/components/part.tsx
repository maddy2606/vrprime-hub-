import type { ReactNode } from "react";

/** Waits for one part of a streamed page, then draws it. Put it inside a Suspense boundary. */
export async function Part<T>({ data, children }: { data: Promise<T>; children: (value: T) => ReactNode }) {
  return children(await data);
}
