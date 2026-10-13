-- Forecasting tab: units dispatched per SKU per warehouse over a window of complete days, what is already booked to
-- dispatch in the next 1 / 7 / 30 days, and current stock.
--
-- The basis is the DISPATCH day (dispatch_by, as an India date), not the order day: orders placed on one day can be
-- scheduled to dispatch weeks later. History = stage 'dispatched'; booked = stage 'pending' or 'left_pending'.
-- The window ends yesterday (today is partial) and is cut to the history we have. The function runs as the caller,
-- so row level security gives warehouse users only their own warehouses, like the Stock tab.
--
-- Live, not cached: this index makes the read a range scan over the window, a few thousand rows.

create index if not exists fk_order_items_dispatch_idx
  on public.fk_order_items (platform, stage, dispatch_by) include (sku, warehouse_id, quantity);

create or replace function public.flipkart_forecast(p_days integer default 30) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_yesterday date := (now() at time zone 'Asia/Kolkata')::date - 1;
  v_days integer := case when p_days in (7, 14, 30) then p_days else 30 end;
  v_first date;
  v_start date;
  v_used integer;
  v_snapshot date := public.flipkart_snapshot_date();
  v_rows jsonb;
begin
  -- The first day we have dispatch history for (rows are only read for the caller's own warehouses).
  select min((i.dispatch_by at time zone 'Asia/Kolkata')::date) into v_first
  from public.fk_order_items i where i.platform = 'flipkart' and i.stage = 'dispatched';

  if v_first is null or v_first > v_yesterday then
    v_start := v_yesterday + 1;
    v_used := 0;
  else
    v_start := greatest(v_yesterday - v_days + 1, v_first);
    v_used := v_yesterday - v_start + 1;
  end if;

  with disp as (
    select i.sku, i.warehouse_id, sum(i.quantity)::bigint as units
    from public.fk_order_items i
    where i.platform = 'flipkart' and i.stage = 'dispatched' and i.sku is not null
      and i.dispatch_by >= ((v_start::timestamp) at time zone 'Asia/Kolkata')
      and i.dispatch_by < (((v_yesterday + 1)::timestamp) at time zone 'Asia/Kolkata')
    group by i.sku, i.warehouse_id
  ), booked as (
    select i.sku, i.warehouse_id,
           sum(i.quantity) filter (where i.dispatch_by < (((v_today + 1)::timestamp) at time zone 'Asia/Kolkata'))::bigint as b1,
           sum(i.quantity) filter (where i.dispatch_by < (((v_today + 7)::timestamp) at time zone 'Asia/Kolkata'))::bigint as b7,
           sum(i.quantity)::bigint as b30
    from public.fk_order_items i
    where i.platform = 'flipkart' and i.stage in ('pending', 'left_pending') and i.sku is not null
      and i.dispatch_by >= ((v_today::timestamp) at time zone 'Asia/Kolkata')
      and i.dispatch_by < (((v_today + 30)::timestamp) at time zone 'Asia/Kolkata')
    group by i.sku, i.warehouse_id
  ), stock as (
    select s.sku, s.warehouse_id, sum(s.inventory)::bigint as units
    from public.stock_levels s
    where s.platform = 'flipkart' and s.snapshot_date = v_snapshot
    group by s.sku, s.warehouse_id
  ), keys as (
    select sku, warehouse_id from disp
    union select sku, warehouse_id from booked
    union select sku, warehouse_id from stock where units > 0
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'sku', k.sku, 'wid', k.warehouse_id, 'title', l.title,
           'disp', coalesce(d.units, 0), 'b1', coalesce(b.b1, 0), 'b7', coalesce(b.b7, 0), 'b30', coalesce(b.b30, 0),
           'stock', coalesce(st.units, 0))), '[]'::jsonb)
  into v_rows
  from keys k
  left join disp d on d.sku = k.sku and d.warehouse_id is not distinct from k.warehouse_id
  left join booked b on b.sku = k.sku and b.warehouse_id is not distinct from k.warehouse_id
  left join stock st on st.sku = k.sku and st.warehouse_id is not distinct from k.warehouse_id
  left join public.stock_listings l on l.platform = 'flipkart' and l.sku = k.sku;

  return jsonb_build_object('today', v_today, 'window_start', v_start, 'window_end', v_yesterday, 'days', v_used,
                            'asked', v_days, 'history_from', v_first, 'snapshot', v_snapshot, 'rows', v_rows);
end $$;

revoke all on function public.flipkart_forecast(integer) from public, anon;
grant execute on function public.flipkart_forecast(integer) to authenticated, service_role;
