-- Orders per warehouse in Seller Hub's tabs, counted the way Seller Hub counts them (shipments),
-- to compare with Seller Hub. Read-only. The app works these out the same way (bucketOf in
-- src/lib/flipkart-analysis.ts).

with pending as (
  select o.warehouse_id, coalesce(o.shipment_id, o.order_item_id) as shipment,
    case
      when o.item_status = 'PACKING_IN_PROGRESS' then 'Under Processing'
      when o.item_status not in ('APPROVED', 'FORM_FAILED', 'PACKED', 'READY_TO_DISPATCH') then null
      when o.dispatch_after > now() then 'Upcoming'
      when o.item_status = 'PACKED' then 'To Pack'
      when o.item_status = 'READY_TO_DISPATCH' then 'To Dispatch'
      else 'To Accept'
    end as tab
  from public.fk_order_items o
  where o.platform = 'flipkart' and o.stage = 'pending'
), transit as (
  select warehouse_id, shipments from public.flipkart_in_transit()
)
select w.name as warehouse,
  count(distinct p.shipment) filter (where p.tab = 'To Accept') as to_accept,
  count(distinct p.shipment) filter (where p.tab = 'To Pack') as to_pack,
  count(distinct p.shipment) filter (where p.tab = 'To Dispatch') as to_dispatch,
  count(distinct p.shipment) filter (where p.tab in ('To Accept', 'To Pack', 'To Dispatch')) as active,
  count(distinct p.shipment) filter (where p.tab = 'Upcoming') as upcoming,
  count(distinct p.shipment) filter (where p.tab = 'Under Processing') as under_processing,
  coalesce(max(t.shipments), 0) as in_transit
from public.warehouses w
left join pending p on p.warehouse_id = w.id
left join transit t on t.warehouse_id = w.id
where w.flipkart_location_id is not null
group by w.name, w.sort_order
order by w.sort_order;
