-- Fixes found while testing Phase 6 against the real reports.

create or replace function public.money_weight(p_from date, p_to date)
returns table (order_item_id text, order_id text, sku text, payment_date date, zone text, weight_type text,
               charged_slab text, charged_kg numeric, our_kg numeric, our_slab_kg numeric, fee_paid numeric,
               usual_fee numeric, extra_fee numeric)
language plpgsql stable security invoker set search_path = '' as $$
begin
  perform private.money_guard();
  return query
  with charged as (
    select l.*, nullif(split_part(l.weight_slab, '-', 2), '')::numeric as charged_upper,
           -(l.shipping_fee + l.reverse_shipping_fee) as fee
    from public.money_settled_lines l
    where l.weight_slab is not null and l.weight_slab ~ '^[0-9.]+-[0-9.]+$'
      and l.payment_date between p_from and p_to
  ), mine as (
    select c.*, pk.kg as our_kg
    from charged c
    left join lateral (
      select greatest(coalesce(d.kg, 0), d.l * d.b * d.h / 5000.0) as kg
      from public.stock_listings sl,
           lateral jsonb_array_elements(case when jsonb_typeof(sl.packages) = 'array' then sl.packages else '[]'::jsonb end) x,
           lateral (select private.try_num(x #>> '{dimensions,length}') as l, private.try_num(x #>> '{dimensions,breadth}') as b,
                           private.try_num(x #>> '{dimensions,height}') as h, private.try_num(x ->> 'weight') as kg) d
      where sl.platform = 'flipkart' and sl.sku = c.sku and d.l > 0 and d.b > 0 and d.h > 0
      order by d.l * d.b * d.h desc
      limit 1
    ) pk on true
  ), usual as (
    select m.zone, m.charged_upper, percentile_cont(0.5) within group (order by m.fee)::numeric as fee
    from mine m
    where m.our_kg is not null and private.money_slab_upper(m.our_kg) >= m.charged_upper and m.fee > 0
    group by m.zone, m.charged_upper
  )
  select m.order_item_id, m.order_id, m.sku, m.payment_date, m.zone, m.weight_type, m.weight_slab, m.charged_upper,
         round(m.our_kg, 3), private.money_slab_upper(m.our_kg), m.fee, u.fee,
         case when u.fee is null then null else greatest(m.fee - u.fee, 0) end
  from mine m
  left join usual u on u.zone is not distinct from m.zone and u.charged_upper = private.money_slab_upper(m.our_kg)
  where m.our_kg is not null and m.charged_upper > private.money_slab_upper(m.our_kg)
  order by m.payment_date desc, m.order_item_id;
end $$;


-- Settlement checker, wrong fees. The fixed fee is charged per unit and Flipkart changes it by order value and over time
-- (5, 6, 18 ... for the same SKU), so a fee is only called wrong when it is clearly above the highest fee the SKU
-- usually pays (its 95th percentile), by more than the allowed percentage points of the sale price. The commission
-- rate is compared with the SKU's usual (middle) rate. A fee charged twice for one order item is flagged as well.
create or replace function public.money_wrong_fees(p_points numeric default null)
returns table (order_item_id text, order_id text, sku text, payment_date date, problem text, sale numeric,
               fee_points numeric, usual_points numeric, extra_fee numeric)
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_points numeric := coalesce(p_points, private.money_setting('money_fee_deviation_points', 2));
begin
  perform private.money_guard();
  return query
  with sold as (
    select l.*, greatest(coalesce(l.qty, 1), 1) as units
    from public.money_settled_lines l
    where l.sale_amount > 0 and l.refund = 0 and l.sku is not null
  ), usual as (
    select s.sku,
           percentile_cont(0.5) within group (order by s.commission_rate) filter (where s.commission_rate is not null)::numeric as rate,
           percentile_cont(0.95) within group (order by -s.fixed_fee / s.units)::numeric as fixed_p95
    from sold s group by s.sku having count(*) >= 20
  ), rate_off as (
    select s.order_item_id, s.order_id, s.sku, s.payment_date, 'Commission % is far from usual'::text as problem, s.sale_amount as sale,
           s.commission_rate as fee_points, round(u.rate, 2) as usual_points,
           round(greatest(-s.commission - u.rate / 100 * s.sale_amount, 0), 2) as extra_fee
    from sold s join usual u on u.sku = s.sku
    where s.commission_rate is not null and u.rate is not null and abs(s.commission_rate - u.rate) > v_points
  ), fixed_off as (
    select s.order_item_id, s.order_id, s.sku, s.payment_date, 'Fixed fee above usual'::text, s.sale_amount,
           round(-s.fixed_fee / s.sale_amount * 100, 2), round(u.fixed_p95 / (s.sale_amount / s.units) * 100, 2),
           round((-s.fixed_fee / s.units - u.fixed_p95) * s.units, 2)
    from sold s join usual u on u.sku = s.sku
    where (-s.fixed_fee / s.units - u.fixed_p95) * s.units / s.sale_amount * 100 > v_points
  ), twice as (
    select l.order_item_id, min(l.order_id), min(l.sku), max(l.payment_date), 'Fee charged twice'::text, sum(l.sale_amount),
           null::numeric, null::numeric,
           round(-(sum(l.commission + l.fixed_fee + l.collection_fee) - min(l.commission + l.fixed_fee + l.collection_fee)), 2)
    from public.money_settled_lines l
    where l.refund = 0 and l.sale_amount > 0 and (l.commission + l.fixed_fee + l.collection_fee) <> 0
    group by l.order_item_id
    having count(*) > 1
  )
  select * from rate_off union all select * from fixed_off union all select * from twice
  order by 9 desc nulls last;
end $$;

-- How full the database is, for the Money page (the free plan holds 500 MB).
create or replace function public.money_db_size_mb() returns numeric
language plpgsql stable security invoker set search_path = '' as $$
begin
  perform private.money_guard();
  return round(pg_database_size(current_database()) / 1048576.0);
end $$;
revoke all on function public.money_db_size_mb() from public, anon;
grant execute on function public.money_db_size_mb() to authenticated, service_role;
