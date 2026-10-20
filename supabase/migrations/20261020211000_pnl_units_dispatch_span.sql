-- P&L month units: first_day and last_day are now the first and last day with dispatched orders, so a month whose early
-- days have only cancellations (orders not loaded yet) shows where its shipped orders really start.

create or replace function public.pnl_month_units(p_from date)
returns table (month text, sku text, dispatched bigint, returned bigint, cancelled bigint, first_day date, last_day date)
language plpgsql stable security invoker set search_path = '' as $$
begin
  perform private.money_guard();
  return query
  with o as (
    select to_char(i.order_day, 'YYYY-MM') as m, i.sku as s,
           sum(case when i.stage = 'dispatched' then coalesce(i.quantity, 1) else 0 end) as d,
           sum(case when i.stage = 'cancelled' then coalesce(i.quantity, 1) else 0 end) as c,
           min(case when i.stage = 'dispatched' then i.order_day end) as f, max(case when i.stage = 'dispatched' then i.order_day end) as l
    from public.fk_order_items i
    where i.platform = 'flipkart' and i.order_day >= p_from and i.sku is not null
    group by 1, 2
  ), r as (
    select to_char(coalesce(oi.order_day, (x.order_date at time zone 'Asia/Kolkata')::date), 'YYYY-MM') as m, x.sku as s,
           sum(coalesce(x.quantity, 1)) as q
    from public.fk_returns x
    left join public.fk_order_items oi on oi.platform = x.platform and oi.order_item_id = x.order_item_id
    where x.platform = 'flipkart' and x.return_status <> 'cancelled' and x.sku is not null
      and coalesce(oi.order_day, (x.order_date at time zone 'Asia/Kolkata')::date) >= p_from
    group by 1, 2
  )
  select coalesce(o.m, r.m), coalesce(o.s, r.s), coalesce(o.d, 0)::bigint, coalesce(r.q, 0)::bigint, coalesce(o.c, 0)::bigint, o.f, o.l
  from o full join r on r.m = o.m and r.s = o.s;
end $$;
revoke all on function public.pnl_month_units(date) from public, anon;
grant execute on function public.pnl_month_units(date) to authenticated, service_role;
