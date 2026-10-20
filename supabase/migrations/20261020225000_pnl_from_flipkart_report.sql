-- P&L from Flipkart's own figures where its Profit and Loss Report covers, synced orders only after that.
--
--   pnl_report_units(d)  per order month and Flipkart SKU, from money_pnl_orders (Flipkart's report, one row per order
--                        item): gross units, returned and cancelled units, net units, order item value (what Seller Hub
--                        calls sales), final selling price x net units, accounted net sales (the seller price: your revenue) and net earnings.
--   pnl_month_units(d)   as before, plus in_report: true for orders on or before the last order day the report has for
--                        that month. The page counts money from the report for those and from the orders after it.

create or replace function public.pnl_report_units(p_from date)
returns table (month text, sku text, gross numeric, ret_canc numeric, net numeric, item_value numeric, fsp_value numeric, sales numeric, earnings numeric, first_day date, last_day date)
language plpgsql stable security invoker set search_path = '' as $$
begin
  perform private.money_guard();
  return query
  select to_char(p.order_date, 'YYYY-MM'), p.sku,
         coalesce(sum(p.gross_units), 0), coalesce(sum(p.returned_units), 0), coalesce(sum(p.net_units), 0),
         coalesce(sum(p.order_item_value), 0), coalesce(sum(coalesce(p.fsp, 0) * coalesce(p.net_units, 0)), 0), coalesce(sum(p.accounted_sales), 0), coalesce(sum(p.net_earnings), 0),
         min(p.order_date), max(p.order_date)
  from public.money_pnl_orders p
  where p.order_date >= p_from and p.sku is not null
  group by 1, 2;
end $$;
revoke all on function public.pnl_report_units(date) from public, anon;
grant execute on function public.pnl_report_units(date) to authenticated, service_role;

drop function if exists public.pnl_month_units(date);

create function public.pnl_month_units(p_from date)
returns table (month text, sku text, in_report boolean, ordered bigint, cancelled bigint, cust_returned bigint, rto bigint, sold_value numeric, sold_priced_units bigint, first_day date, last_day date)
language plpgsql stable security invoker set search_path = '' as $$
begin
  perform private.money_guard();
  return query
  with rep as (
    select to_char(p.order_date, 'YYYY-MM') as m, max(p.order_date) as last
    from public.money_pnl_orders p
    where p.order_date >= p_from
    group by 1
  ), returned as (
    select distinct x.order_item_id
    from public.fk_returns x
    where x.platform = 'flipkart' and x.return_status <> 'cancelled'
  ), items as (
    select to_char(i.order_day, 'YYYY-MM') as m, i.sku as s, i.stage, coalesce(i.quantity, 1) as q, i.selling_price as p, i.order_day,
           (rt.order_item_id is not null) as was_returned,
           coalesce(i.order_day <= rp.last, false) as in_rep
    from public.fk_order_items i
    left join returned rt on rt.order_item_id = i.order_item_id
    left join rep rp on rp.m = to_char(i.order_day, 'YYYY-MM')
    where i.platform = 'flipkart' and i.order_day >= p_from and i.sku is not null
  ), o as (
    select it.m, it.s, it.in_rep,
           sum(case when it.stage <> 'cancelled' then it.q else 0 end) as ordered,
           sum(case when it.stage = 'cancelled' then it.q else 0 end) as cancelled,
           sum(case when it.stage <> 'cancelled' and not it.was_returned and it.p is not null then it.p else 0 end) as sold_value,
           sum(case when it.stage <> 'cancelled' and not it.was_returned and it.p is not null then it.q else 0 end) as sold_priced_units,
           min(case when it.stage = 'dispatched' then it.order_day end) as f,
           max(case when it.stage = 'dispatched' then it.order_day end) as l
    from items it
    group by 1, 2, 3
  ), r as (
    select to_char(d.day, 'YYYY-MM') as m, d.s, coalesce(d.day <= rp.last, false) as in_rep,
           sum(case when d.source = 'customer_return' then d.q else 0 end) as cust,
           sum(case when d.source = 'courier_return' then d.q else 0 end) as courier
    from (
      select coalesce(oi.order_day, (x.order_date at time zone 'Asia/Kolkata')::date) as day, x.sku as s, x.source, coalesce(x.quantity, 1) as q
      from public.fk_returns x
      left join public.fk_order_items oi on oi.platform = x.platform and oi.order_item_id = x.order_item_id
      where x.platform = 'flipkart' and x.return_status <> 'cancelled' and x.sku is not null
    ) d
    left join rep rp on rp.m = to_char(d.day, 'YYYY-MM')
    where d.day >= p_from
    group by 1, 2, 3
  )
  select coalesce(o.m, r.m), coalesce(o.s, r.s), coalesce(o.in_rep, r.in_rep), coalesce(o.ordered, 0)::bigint, coalesce(o.cancelled, 0)::bigint,
         coalesce(r.cust, 0)::bigint, coalesce(r.courier, 0)::bigint, coalesce(o.sold_value, 0), coalesce(o.sold_priced_units, 0)::bigint, o.f, o.l
  from o full join r on r.m = o.m and r.s = o.s and r.in_rep = o.in_rep;
end $$;
revoke all on function public.pnl_month_units(date) from public, anon;
grant execute on function public.pnl_month_units(date) to authenticated, service_role;
