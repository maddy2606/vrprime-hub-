import { redirect } from "next/navigation";

// The Stock page is now the Stock tab of the Flipkart page. Old links and bookmarks land there.
export default async function StockRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const params = new URLSearchParams({ tab: "stock" });
  for (const key of ["view", "wh", "q", "hide"]) {
    const value = Array.isArray(sp[key]) ? sp[key][0] : sp[key];
    if (typeof value === "string" && value) params.set(key, value.slice(0, 100));
  }
  redirect(`/flipkart?${params.toString()}`);
}
