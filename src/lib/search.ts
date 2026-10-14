// What the Command Palette (Ctrl or Cmd + K) searches, and the pages it can jump to. Plain values, no server code.

export const SEARCH_KINDS = ["page", "sku", "order", "ticket", "post"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export const KIND_LABEL: Record<SearchKind, string> = { page: "PAGE", sku: "SKU", order: "ORDER", ticket: "TICKET", post: "WORK" };

export type SearchHit = { kind: SearchKind; id: string; label: string; sub: string; href: string };

type Role = "owner" | "admin" | "warehouse";

const PAGES: (SearchHit & { roles?: Role[]; words: string })[] = [
  { kind: "page", id: "p-deck", label: "Command Deck", sub: "What needs action right now", href: "/", words: "home deck dashboard overview" },
  { kind: "page", id: "p-work", label: "Work board", sub: "My work and everyone's posts", href: "/work", words: "work board tasks posts mine" },
  { kind: "page", id: "p-all", label: "All posts", sub: "Every post, filtered", href: "/all", words: "all posts everything" },
  { kind: "page", id: "p-new", label: "New post", sub: "Raise a task, problem, restock or new listing", href: "/posts/new", words: "new post create task problem restock listing" },
  { kind: "page", id: "p-tickets", label: "Tickets", sub: "Marketplace tickets and follow-ups", href: "/tickets", words: "tickets claims follow up" },
  { kind: "page", id: "p-flipkart", label: "Flipkart", sub: "Needs action, orders, stock, returns", href: "/flipkart", words: "flipkart needs action" },
  { kind: "page", id: "p-orders", label: "Flipkart · Orders", sub: "Orders waiting to be dispatched", href: "/flipkart?tab=orders", words: "orders dispatch late pending" },
  { kind: "page", id: "p-stock", label: "Flipkart · Stock", sub: "Stock across the warehouses", href: "/flipkart?tab=stock", words: "stock inventory out of stock low" },
  { kind: "page", id: "p-returns", label: "Flipkart · Returns", sub: "Returns and return rates", href: "/flipkart?tab=returns", words: "returns" },
  { kind: "page", id: "p-prices", label: "Flipkart · Prices", sub: "Selling prices and price changes", href: "/flipkart?tab=prices", words: "prices mrp", roles: ["owner", "admin"] },
  { kind: "page", id: "p-forecast", label: "Forecast", sub: "Expected dispatches and days of cover", href: "/flipkart?tab=forecast", words: "forecast cover demand" },
  { kind: "page", id: "p-overfill", label: "Flipkart · Overfill Orders", sub: "Orders waiting where the stock is 0", href: "/flipkart?tab=overfill", words: "overfill orders no stock" },
  { kind: "page", id: "p-notes", label: "Notifications", sub: "Your alerts", href: "/notifications", words: "notifications alerts bell" },
  { kind: "page", id: "p-people", label: "People", sub: "Users and warehouses", href: "/admin/users", words: "people users staff", roles: ["owner"] },
  { kind: "page", id: "p-settings", label: "Settings", sub: "Limits and switches", href: "/admin/settings", words: "settings limits", roles: ["owner"] },
  { kind: "page", id: "p-pw", label: "Change password", sub: "Your account", href: "/change-password", words: "password account" },
];

/** Pages the person may open, filtered by what they typed (all of them for an empty box). */
export function matchPages(q: string, role: Role, limit = 7): SearchHit[] {
  const t = q.trim().toLowerCase();
  return PAGES.filter((p) => !p.roles || p.roles.includes(role))
    .filter((p) => !t || p.label.toLowerCase().includes(t) || p.words.includes(t))
    .slice(0, limit)
    .map((p) => ({ kind: p.kind, id: p.id, label: p.label, sub: p.sub, href: p.href }));
}
