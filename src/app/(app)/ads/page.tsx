import { redirect } from "next/navigation";

/** The Ads tracker page was removed on 16 Nov 2026: the Ads Desk covers it. Old links and bookmarks land there. */
export default function AdsPage() {
  redirect("/ads/desk");
}
