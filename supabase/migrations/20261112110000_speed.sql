-- Faster pages. Two causes of slow opens, measured on 12 Nov 2026:
--
--  1. pnl_month_units (Dashboard and P&L) adds up every Flipkart order line since September on every open: 7.2 s when
--     the data is not in memory, 0.7 s when it is. Past months never change, so the answer is now kept in
--     private.pnl_units_cache, worked out again every 10 minutes; the function answers from it while it is under
--     30 minutes old, and works it out live otherwise (so a stale or missing cache is slower, never wrong).
--  2. The Command Deck, Team and Forecast read the order tables; when the sync jobs have pushed them out of memory the
--     first open reads them from disk (team_order_load 4.9 s, deck_series 3.7 s cold; 0.1 to 0.2 s warm). The busiest
--     tables and their indexes are now loaded back into memory every 5 minutes (pg_prewarm; already-loaded pages cost
--     next to nothing).

-- ---- 1. The P&L units, pre-counted --------------------------------------------------------------------------------------

-- The same work as before, under its own name (no owner check: it is private, and only the owner-checked function and
-- the refresh job call it).
create or replace function private.pnl_month_units_live(p_from date)
returns table (month text, sku text, in_report boolean, ordered bigint, cancelled bigint, cust_returned bigint, rto bigint, sold_value numeric, sold_priced_units bigint, first_day date, last_day date)
language sql stable security definer set search_path = '' as $$
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
  from o full join r on r.m = o.m and r.s = o.s and r.in_rep = o.in_rep
$$;
revoke all on function private.pnl_month_units_live(date) from public, anon, authenticated;

-- One row per start date asked for; the answer as a JSON array of rows.
create table if not exists private.pnl_units_cache (
  p_from date primary key,
  built_at timestamptz not null default now(),
  rows jsonb not null default '[]'::jsonb
);
alter table private.pnl_units_cache enable row level security;
revoke all on private.pnl_units_cache from public, anon, authenticated;

-- Works the cache out again for every start date in it (and for 1 Sep 2026, what the P&L page asks for). Never raises.
create or replace function private.refresh_pnl_cache() returns void
language plpgsql security definer set search_path = '' as $$
declare
  d date;
begin
  insert into private.pnl_units_cache (p_from, built_at, rows) values ('2026-09-01', '-infinity', '[]') on conflict (p_from) do nothing;
  for d in select c.p_from from private.pnl_units_cache c loop
    update private.pnl_units_cache
    set rows = coalesce((select jsonb_agg(to_jsonb(x)) from private.pnl_month_units_live(d) x), '[]'::jsonb), built_at = now()
    where p_from = d;
  end loop;
exception when others then
  raise warning 'refresh_pnl_cache failed: %', sqlerrm;
end $$;
revoke all on function private.refresh_pnl_cache() from public, anon, authenticated;

-- The owner's function: from the cache while it is under 30 minutes old, else worked out live.
create or replace function public.pnl_month_units(p_from date)
returns table (month text, sku text, in_report boolean, ordered bigint, cancelled bigint, cust_returned bigint, rto bigint, sold_value numeric, sold_priced_units bigint, first_day date, last_day date)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_rows jsonb;
begin
  perform private.money_guard();
  select c.rows into v_rows from private.pnl_units_cache c where c.p_from = pnl_month_units.p_from and c.built_at > now() - interval '30 minutes';
  if v_rows is not null then
    return query
    select x.month, x.sku, x.in_report, x.ordered, x.cancelled, x.cust_returned, x.rto, x.sold_value, x.sold_priced_units, x.first_day, x.last_day
    from jsonb_to_recordset(v_rows) as x(month text, sku text, in_report boolean, ordered bigint, cancelled bigint, cust_returned bigint, rto bigint, sold_value numeric, sold_priced_units bigint, first_day date, last_day date);
  else
    return query select * from private.pnl_month_units_live(pnl_month_units.p_from);
  end if;
end $$;
revoke all on function public.pnl_month_units(date) from public, anon;
grant execute on function public.pnl_month_units(date) to authenticated, service_role;

-- ---- 2. Keep the busiest tables in memory -------------------------------------------------------------------------------

create extension if not exists pg_prewarm with schema extensions;

create or replace function private.keep_warm() returns void
language plpgsql security definer set search_path = '' as $$
declare
  r regclass;
begin
  for r in
    select c.oid::regclass
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and (c.relname in ('fk_order_items', 'fk_returns', 'fk_pending_orders', 'stock_levels', 'dispatch_daily', 'stock_listings', 'ad_daily', 'money_pnl_orders')
           or c.oid in (select i.indexrelid from pg_index i join pg_class t on t.oid = i.indrelid join pg_namespace tn on tn.oid = t.relnamespace
                        where tn.nspname = 'public' and t.relname in ('fk_order_items', 'fk_returns', 'fk_pending_orders', 'stock_levels', 'dispatch_daily')))
  loop
    begin
      perform extensions.pg_prewarm(r, 'buffer');
    exception when others then
      null;
    end;
  end loop;
end $$;
revoke all on function private.keep_warm() from public, anon, authenticated;

select cron.unschedule(jobname) from cron.job where jobname in ('pnl-cache', 'keep-warm');
select cron.schedule('pnl-cache', '*/10 * * * *', $$select private.refresh_pnl_cache()$$);
select cron.schedule('keep-warm', '2-59/5 * * * *', $$select private.keep_warm()$$);

-- Build the cache now, so the first page open after this is fast.
select private.refresh_pnl_cache();
