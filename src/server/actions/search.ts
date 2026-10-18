"use server";

import { getActiveUser } from "@/lib/auth";
import { formatDate, postNumber, ticketNumber } from "@/lib/format";
import { logError } from "@/lib/redact";
import { createClient } from "@/lib/supabase/server";
import { SEARCH_KINDS, type SearchHit } from "@/lib/search";

/** Characters that mean something to a LIKE pattern or to the PostgREST filter syntax are dropped from the term. */
function clean(q: string): string {
  return q.replace(/[%_\\,()*"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

const LIMIT = 5;

/**
 * The Command Palette's search: SKUs, orders, tickets and work posts. Every query runs as the signed-in person, so
 * row security decides what they can find (a warehouse user finds only their own warehouses' orders and stock).
 */
export async function searchAll(raw: string): Promise<SearchHit[]> {
  const user = await getActiveUser();
  if (!user) return [];
  const q = clean(typeof raw === "string" ? raw : "");
  if (q.length < 2) return [];
  const supabase = await createClient();
  const like = `%${q}%`;
  const prefix = `${q}%`;
  const num = /^(?:vr-?t?-?)?(\d{1,9})$/i.exec(q.replace(/\s/g, ""));
  const isTicketNumber = /^vr-?t-?\d+$/i.test(q.replace(/\s/g, ""));
  const asNumber = num ? Number(num[1]) : null;

  const [skus, orders, tickets, posts] = await Promise.all([
    supabase
      .from("stock_listings")
      .select("sku, title, status")
      .eq("platform", "flipkart")
      .or(`sku.ilike.${like},title.ilike.${like}`)
      .order("sku")
      .limit(LIMIT),
    supabase
      .from("fk_order_items")
      .select("order_id, sku, quantity, stage, dispatch_by")
      .eq("platform", "flipkart")
      .in("stage", ["pending", "cancelled"])
      .ilike("order_id", prefix)
      .limit(LIMIT * 3),
    supabase
      .from("tickets")
      .select("id, number, ticket_id, status, sku, issue_type")
      .or(asNumber !== null && isTicketNumber ? `number.eq.${asNumber}` : `ticket_id.ilike.${like},sku.ilike.${like}`)
      .order("number", { ascending: false })
      .limit(LIMIT),
    supabase
      .from("posts")
      .select("id, number, title, status, sku")
      .or(asNumber !== null && !isTicketNumber ? `number.eq.${asNumber},title.ilike.${like},sku.ilike.${like}` : `title.ilike.${like},sku.ilike.${like}`)
      .order("number", { ascending: false })
      .limit(LIMIT),
  ]);
  for (const r of [skus, orders, tickets, posts]) if (r.error) logError("palette search", r.error);

  const hits: SearchHit[] = [];
  for (const s of skus.data ?? []) {
    hits.push({ kind: "sku", id: `sku-${s.sku}`, label: s.sku, sub: `${s.title ?? "No title"} · ${s.status === "ACTIVE" ? "Active" : s.status === "INACTIVE" ? "Inactive" : s.status}`, href: `/flipkart?tab=stock&q=${encodeURIComponent(s.sku)}` });
  }
  const seen = new Set<string>();
  for (const o of orders.data ?? []) {
    if (seen.has(o.order_id)) continue;
    seen.add(o.order_id);
    const stage = o.stage === "pending" ? "Waiting to dispatch" : o.stage === "dispatched" ? "Dispatched" : o.stage === "cancelled" ? "Cancelled" : "Left the pending list";
    hits.push({
      kind: "order",
      id: `order-${o.order_id}`,
      label: o.order_id,
      sub: `${o.sku ?? "No SKU"} × ${o.quantity} · ${stage}${o.stage === "pending" && o.dispatch_by ? `, due ${formatDate(o.dispatch_by.slice(0, 10))}` : ""}`,
      href: o.stage === "cancelled" ? `/flipkart?tab=orders&view=cancelled&q=${encodeURIComponent(o.order_id)}` : `/flipkart?tab=orders&view=list&q=${encodeURIComponent(o.order_id)}`,
    });
    if (seen.size >= LIMIT) break;
  }
  for (const t of tickets.data ?? []) {
    hits.push({ kind: "ticket", id: `ticket-${t.id}`, label: ticketNumber(t.number), sub: `${t.ticket_id}${t.sku ? ` · ${t.sku}` : ""} · ${t.status.replace("_", " ")}`, href: `/tickets/${t.id}` });
  }
  for (const p of posts.data ?? []) {
    hits.push({ kind: "post", id: `post-${p.id}`, label: postNumber(p.number), sub: `${p.title} · ${p.status.replace("_", " ")}`, href: `/posts/${p.id}` });
  }
  return hits.sort((a, b) => SEARCH_KINDS.indexOf(a.kind) - SEARCH_KINDS.indexOf(b.kind));
}

/** The latest finished sync of any kind (Flipkart orders, Flipkart stock, VR Prime stock): what the "Synced Xs ago" label counts from. */
export async function lastSyncedAt(): Promise<string | null> {
  const user = await getActiveUser();
  if (!user) return null;
  const supabase = await createClient();
  const [orders, stock, vrprime] = await Promise.all([
    supabase.from("order_runs").select("finished_at").eq("status", "done").order("finished_at", { ascending: false }).limit(1),
    supabase.from("stock_runs").select("finished_at").eq("status", "done").order("finished_at", { ascending: false }).limit(1),
    supabase.from("inventory_sync_state").select("last_ok_at").limit(1),
  ]);
  const times = [orders.data?.[0]?.finished_at, stock.data?.[0]?.finished_at, vrprime.data?.[0]?.last_ok_at]
    .filter((t): t is string => typeof t === "string")
    .sort((a, b) => Date.parse(b) - Date.parse(a));
  return times[0] ?? null;
}
