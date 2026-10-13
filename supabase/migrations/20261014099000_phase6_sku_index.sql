-- The SKU drill-down reads one SKU's lines in date order: an index for exactly that, in place of the SKU-only one.
create index money_settled_sku_date_idx on public.money_settled_lines (sku, payment_date desc, order_item_id);
drop index public.money_settled_sku_idx;
