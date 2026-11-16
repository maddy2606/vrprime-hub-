import { Loader } from "@/components/ui";

/** What each Flipkart tab's loader says. */
const LOADING: Record<string, string> = {
  needs: "Loading what needs action…",
  orders: "Loading orders…",
  overfill: "Loading overfill orders…",
  stock: "Loading stock…",
  stockouts: "Loading stock changes…",
  forecast: "Loading forecast…",
  prices: "Loading prices…",
  health: "Loading listing health…",
  listingcheck: "Loading the listing check…",
  masters: "Loading master SKUs…",
  returns: "Loading returns…",
  claim: "Loading returns to claim…",
};

/** Shown straight away while a tab's numbers are on their way, under the page title and tabs, which stay. */
export function PanelLoader({ tab }: { tab: string }) {
  return <Loader label={LOADING[tab] ?? "Loading Flipkart…"} />;
}
