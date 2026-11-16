-- 16 Nov 2026. P&L: leave out the most recent 15 days (VRPRIME's rule). Orders placed in the last 15 days still have
-- returns, courier returns and fees coming, so counting them makes a month look better than it ends up. The P&L page
-- and the Dashboard's money now count orders (and their returns) placed up to today minus 15 days (India date).
-- The every-15-days sync uploads ads and Flipkart's P&L report up to the same date, so both sides line up.
--
-- The number of days is the setting 'pnl_cutoff_days' (default 15; 0 counts up to today, as before).
-- The cache (private.pnl_units_cache) is rebuilt every 20 minutes, so the cut-off moves on by itself each day.
-- Undo: run private.pnl_month_units_live from 20261112110000_speed.sql again, or set pnl_cutoff_days to 0.

insert into public.app_settings (key, value) values ('pnl_cutoff_days', '15'::jsonb) on conflict (key) do nothing;

create or replace function private.pnl_month_units_live(p_from date)
returns table (month text, sku text, in_report boolean, ordered bigint, cancelled bigint, cust_returned bigint, rto bigint, sold_value numeric, sold_priced_units bigint, first_day date, last_day date)
language sql stable security definer set search_path = '' as $$
  with cut as (
    select (now() at time zone 'Asia/Kolkata')::date - greatest(0, least(60, private.money_setting('pnl_cutoff_days', 15)))::integer as upto
  ), rep as (
    select to_char(p.order_date, 'YYYY-MM') as m, max(p.order_date) as last
    from public.money_pnl_orders p
    where p.order_date >= p_from and p.order_date <= (select upto from cut)
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
    where i.platform = 'flipkart' and i.order_day >= p_from and i.order_day <= (select upto from cut) and i.sku is not null
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
    where d.day >= p_from and d.day <= (select upto from cut)
    group by 1, 2, 3
  )
  select coalesce(o.m, r.m), coalesce(o.s, r.s), coalesce(o.in_rep, r.in_rep), coalesce(o.ordered, 0)::bigint, coalesce(o.cancelled, 0)::bigint,
         coalesce(r.cust, 0)::bigint, coalesce(r.courier, 0)::bigint, coalesce(o.sold_value, 0), coalesce(o.sold_priced_units, 0)::bigint, o.f, o.l
  from o full join r on r.m = o.m and r.s = o.s and r.in_rep = o.in_rep
$$;
revoke all on function private.pnl_month_units_live(date) from public, anon, authenticated;

-- Rebuild the cache now, so the page shows the cut-off at once.
select private.refresh_pnl_cache();
