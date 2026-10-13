// "Raise ticket" links for what the money checks find. They open the new-ticket form with the SKU, the issue type
// and the order details filled in; nothing is sent to Flipkart (disputes are raised by hand in Seller Hub).

export type TicketHint = { issue: "weight_overcharge" | "wrong_fee" | "payment_missing"; sku: string | null; notes: string };

export function newTicketHref(hint: TicketHint): string {
  const params = new URLSearchParams({ platform: "flipkart", issue: hint.issue });
  if (hint.sku) params.set("sku", hint.sku);
  params.set("notes", hint.notes.slice(0, 900));
  return `/tickets/new?${params.toString()}`;
}

const inr = (v: number | null) => (v === null ? "unknown" : `Rs. ${Math.round(v * 100) / 100}`);

export function weightTicketNotes(r: { order_id: string | null; order_item_id: string; charged_slab: string; our_kg: number; our_slab_kg: number; extra_fee: number | null }): string {
  return `Order ${r.order_id ?? "-"} (item ${r.order_item_id}). Flipkart charged the ${r.charged_slab} kg weight slab; our package is ${r.our_kg} kg (slab up to ${r.our_slab_kg} kg). Extra shipping fee paid: ${inr(r.extra_fee)}.`;
}

export function feeTicketNotes(r: { order_id: string | null; order_item_id: string; problem: string; extra_fee: number | null }): string {
  return `Order ${r.order_id ?? "-"} (item ${r.order_item_id}). ${r.problem}. Amount in question: ${inr(r.extra_fee)}.`;
}

export function unpaidTicketNotes(r: { order_id: string; order_item_id: string; order_day: string }): string {
  return `Order ${r.order_id} (item ${r.order_item_id}), ordered ${r.order_day}, shipped but no settlement line yet.`;
}
