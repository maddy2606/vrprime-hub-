-- Business page (graphite-spec 12.1): the week's figures against the week before, owner only.
-- Written by the build, applied by hand after review. Read only: it changes no table.

-- The figures for p_days days from p_start (India dates), Flipkart only.
create or replace function private.business_week_data(p_start date, p_days integer) returns jsonb
language sql stable security definer set search_path = '' as $$
  with rng as (
    select p_start as d0, p_start + greatest(p_days, 1) - 1 as d1
  ), items as (
    select i.* from public.fk_order_items i, rng
    where i.platform = 'flipkart' and i.order_day between rng.d0 and rng.d1 and i.stage <> 'cancelled'
  ), canc as (
    select i.order_id, i.cancel_type from public.fk_order_items i, rng
    where i.platform = 'flipkart' and i.stage = 'cancelled' and i.cancelled_at is not null
      and (i.cancelled_at at time zone 'Asia/Kolkata')::date between rng.d0 and rng.d1
  ), rets as (
    select r.source, sum(coalesce(r.quantity, 1)) as units from public.fk_returns r, rng
    where r.platform = 'flipkart' and r.created_date between rng.d0 and rng.d1
      and r.return_status is distinct from 'cancelled'
    group by r.source
  ), prod2 as (
    -- One entry per master product (several listings can share one); a SKU with no master is its own entry.
    select m.master_id as id, coalesce(p.name, i.sku, '—') as name,
           sum(coalesce(i.quantity, 1) * coalesce(m.units_per_order, 1)) as units
    from items i
    left join public.sku_master m on m.channel_sku = i.sku
    left join public.master_products p on p.id = m.master_id
    group by m.master_id, coalesce(p.name, i.sku, '—')
  )
  select jsonb_build_object(
    'orders', (select count(distinct order_id) from items),
    'units', (select coalesce(sum(coalesce(quantity, 1)), 0) from items),
    'sales', (select coalesce(sum(selling_price), 0) from items where selling_price is not null),
    'cancelled', (select count(distinct order_id) from canc),
    'cancelled_by', (select coalesce(jsonb_object_agg(coalesce(t, 'unknown'), n), '{}'::jsonb)
                     from (select cancel_type as t, count(distinct order_id) as n from canc group by cancel_type) x),
    'returns_customer', coalesce((select units from rets where source = 'customer_return'), 0),
    'returns_courier', coalesce((select units from rets where source = 'courier_return'), 0),
    'dispatched_units', (select coalesce(sum(d.units), 0) from public.dispatch_daily d, rng
                         where d.platform = 'flipkart' and d.dispatch_day between rng.d0 and rng.d1),
    'late', (select count(distinct i.order_id) from public.fk_order_items i, rng
             where i.platform = 'flipkart' and i.alerted_at is not null
               and (i.alerted_at at time zone 'Asia/Kolkata')::date between rng.d0 and rng.d1),
    'ad_spend', (select round(coalesce(sum(a.spend), 0) * 1.18, 2) from public.ad_daily a, rng
                 where a.day between rng.d0 and rng.d1),
    'ads_read_to', (select max(a.day) from public.ad_daily a),
    'by_product', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'units', units) order by units desc), '[]'::jsonb)
                   from prod2)
  )
$$;
revoke all on function private.business_week_data(date, integer) from public, anon, authenticated;

-- The owner's Business page: this stretch of days and the same days one week earlier.
create or replace function public.business_week(p_start date, p_days integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.user_role() is distinct from 'owner' then
    raise exception 'Only the owner can see this' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'cur', private.business_week_data(p_start, p_days),
    'prev', private.business_week_data(p_start - 7, p_days)
  );
end
$$;
revoke all on function public.business_week(date, integer) from public, anon;
grant execute on function public.business_week(date, integer) to authenticated;

-- Monthly targets (Settings > Targets), whole rupees. Not set is saved as an empty string (value is not null).
insert into public.app_settings (key, value) values ('target_sales_month', '""'), ('target_profit_month', '""')
on conflict (key) do nothing;
