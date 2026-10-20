-- P&L month units, counted the way Seller Hub counts them: per order month and Flipkart SKU, the units ordered (every
-- order not cancelled, shipped or still to ship), cancelled, returned by the customer and returned by the courier (RTO),
-- both counted in the month of their order. sold_value adds up the real selling price of the order items that were
-- neither cancelled nor returned; sold_priced_units is how many units that covers (older orders have no price saved, and
-- the page prices those at the listing price). first_day and last_day are the first and last day with shipped orders.

drop function if exists public.pnl_month_units(date);

create function public.pnl_month_units(p_from date)
returns table (month text, sku text, ordered bigint, cancelled bigint, cust_returned bigint, rto bigint, sold_value numeric, sold_priced_units bigint, first_day date, last_day date)
language plpgsql stable security invoker set search_path = '' as $$
begin
  perform private.money_guard();
  return query
  with returned as (
    select distinct x.order_item_id
    from public.fk_returns x
    where x.platform = 'flipkart' and x.return_status <> 'cancelled'
  ), items as (
    select to_char(i.order_day, 'YYYY-MM') as m, i.sku as s, i.stage, coalesce(i.quantity, 1) as q, i.selling_price as p, i.order_day,
           (rt.order_item_id is not null) as was_returned
    from public.fk_order_items i
    left join returned rt on rt.order_item_id = i.order_item_id
    where i.platform = 'flipkart' and i.order_day >= p_from and i.sku is not null
  ), o as (
    select it.m, it.s,
           sum(case when it.stage <> 'cancelled' then it.q else 0 end) as ordered,
           sum(case when it.stage = 'cancelled' then it.q else 0 end) as cancelled,
           sum(case when it.stage <> 'cancelled' and not it.was_returned and it.p is not null then it.p else 0 end) as sold_value,
           sum(case when it.stage <> 'cancelled' and not it.was_returned and it.p is not null then it.q else 0 end) as sold_priced_units,
           min(case when it.stage = 'dispatched' then it.order_day end) as f,
           max(case when it.stage = 'dispatched' then it.order_day end) as l
    from items it
    group by 1, 2
  ), r as (
    select to_char(coalesce(oi.order_day, (x.order_date at time zone 'Asia/Kolkata')::date), 'YYYY-MM') as m, x.sku as s,
           sum(case when x.source = 'customer_return' then coalesce(x.quantity, 1) else 0 end) as cust,
           sum(case when x.source = 'courier_return' then coalesce(x.quantity, 1) else 0 end) as courier
    from public.fk_returns x
    left join public.fk_order_items oi on oi.platform = x.platform and oi.order_item_id = x.order_item_id
    where x.platform = 'flipkart' and x.return_status <> 'cancelled' and x.sku is not null
      and coalesce(oi.order_day, (x.order_date at time zone 'Asia/Kolkata')::date) >= p_from
    group by 1, 2
  )
  select coalesce(o.m, r.m), coalesce(o.s, r.s), coalesce(o.ordered, 0)::bigint, coalesce(o.cancelled, 0)::bigint,
         coalesce(r.cust, 0)::bigint, coalesce(r.courier, 0)::bigint, coalesce(o.sold_value, 0), coalesce(o.sold_priced_units, 0)::bigint, o.f, o.l
  from o full join r on r.m = o.m and r.s = o.s;
end $$;
revoke all on function public.pnl_month_units(date) from public, anon;
grant execute on function public.pnl_month_units(date) to authenticated, service_role;
