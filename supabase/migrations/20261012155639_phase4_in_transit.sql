-- In Transit: shipped and not delivered when last read (nightly for 14 days, every morning for 4).
-- Runs as the caller, so a warehouse user only counts their own warehouses.
create or replace function public.flipkart_in_transit() returns table (warehouse_id uuid, shipments bigint)
language sql stable security invoker set search_path = '' as $$
  select o.warehouse_id, count(distinct coalesce(o.shipment_id, o.order_item_id))
  from public.fk_order_items o
  where o.platform = 'flipkart' and o.stage = 'dispatched' and o.item_status = 'SHIPPED'
    and o.last_seen_at > now() - interval '26 hours'
  group by o.warehouse_id
$$;
revoke all on function public.flipkart_in_transit() from public, anon;
grant execute on function public.flipkart_in_transit() to authenticated, service_role;
