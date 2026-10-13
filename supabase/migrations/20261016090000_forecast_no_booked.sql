-- The Forecasting tab no longer shows "booked" units, so the function stops working them out.
-- The forecast itself is untouched: units dispatched by dispatch day (dispatch_by, India date), over the window of
-- complete days that ends yesterday, cut to the history there is. Days of cover everywhere is stock / that rate.

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
  ), stock as (
    select s.sku, s.warehouse_id, sum(s.inventory)::bigint as units
    from public.stock_levels s
    where s.platform = 'flipkart' and s.snapshot_date = v_snapshot
    group by s.sku, s.warehouse_id
  ), keys as (
    select sku, warehouse_id from disp
    union select sku, warehouse_id from stock where units > 0
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'sku', k.sku, 'wid', k.warehouse_id, 'title', l.title,
           'disp', coalesce(d.units, 0), 'stock', coalesce(st.units, 0))), '[]'::jsonb)
  into v_rows
  from keys k
  left join disp d on d.sku = k.sku and d.warehouse_id is not distinct from k.warehouse_id
  left join stock st on st.sku = k.sku and st.warehouse_id is not distinct from k.warehouse_id
  left join public.stock_listings l on l.platform = 'flipkart' and l.sku = k.sku;

  return jsonb_build_object('today', v_today, 'window_start', v_start, 'window_end', v_yesterday, 'days', v_used,
                            'asked', v_days, 'history_from', v_first, 'snapshot', v_snapshot, 'rows', v_rows);
end $$;

revoke all on function public.flipkart_forecast(integer) from public, anon;
grant execute on function public.flipkart_forecast(integer) to authenticated, service_role;
