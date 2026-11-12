-- Faster Dashboard and P&L, part 2. Measured on 12 Nov 2026: alone, pnl_report_units takes 0.3 s, but the Dashboard asks
-- about 25 questions at once and on this small database each then waits on the others: pnl_report_units averaged 4.3 s
-- there, the slowest of them all. Its data (Flipkart's payment report) only changes when a report is uploaded, so the
-- answer is now kept in private.pnl_report_cache, like the units in 20261112110000_speed.sql:
--   * refreshed with the units every 10 minutes (private.refresh_pnl_cache),
--   * emptied the moment report rows change (a statement trigger on money_pnl_orders), so an upload shows at once:
--     until the next refresh the function works it out live, as before.

create or replace function private.pnl_report_units_live(p_from date)
returns table (month text, sku text, gross numeric, ret_canc numeric, net numeric, item_value numeric, fsp_value numeric, sales numeric, earnings numeric, first_day date, last_day date)
language sql stable security definer set search_path = '' as $$
  select to_char(p.order_date, 'YYYY-MM'), p.sku,
         coalesce(sum(p.gross_units), 0), coalesce(sum(p.returned_units), 0), coalesce(sum(p.net_units), 0),
         coalesce(sum(p.order_item_value), 0), coalesce(sum(coalesce(p.fsp, 0) * coalesce(p.net_units, 0)), 0), coalesce(sum(p.accounted_sales), 0), coalesce(sum(p.net_earnings), 0),
         min(p.order_date), max(p.order_date)
  from public.money_pnl_orders p
  where p.order_date >= p_from and p.sku is not null
  group by 1, 2
$$;
revoke all on function private.pnl_report_units_live(date) from public, anon, authenticated;

create table if not exists private.pnl_report_cache (
  p_from date primary key,
  built_at timestamptz not null default now(),
  rows jsonb not null default '[]'::jsonb
);
alter table private.pnl_report_cache enable row level security;
revoke all on private.pnl_report_cache from public, anon, authenticated;

-- Report rows changed: forget the cached answer (the start dates stay, so the next refresh rebuilds them).
create or replace function private.pnl_report_cache_clear() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update private.pnl_report_cache set built_at = '-infinity', rows = '[]'::jsonb;
  return null;
end $$;
revoke all on function private.pnl_report_cache_clear() from public, anon, authenticated;

drop trigger if exists money_pnl_orders_cache_clear on public.money_pnl_orders;
create trigger money_pnl_orders_cache_clear
after insert or update or delete or truncate on public.money_pnl_orders
for each statement execute function private.pnl_report_cache_clear();

-- The refresh job now rebuilds both caches. Never raises.
create or replace function private.refresh_pnl_cache() returns void
language plpgsql security definer set search_path = '' as $$
declare
  d date;
begin
  insert into private.pnl_units_cache (p_from, built_at, rows) values ('2026-09-01', '-infinity', '[]') on conflict (p_from) do nothing;
  insert into private.pnl_report_cache (p_from, built_at, rows) values ('2026-09-01', '-infinity', '[]') on conflict (p_from) do nothing;
  for d in select c.p_from from private.pnl_units_cache c loop
    update private.pnl_units_cache
    set rows = coalesce((select jsonb_agg(to_jsonb(x)) from private.pnl_month_units_live(d) x), '[]'::jsonb), built_at = now()
    where p_from = d;
  end loop;
  for d in select c.p_from from private.pnl_report_cache c loop
    update private.pnl_report_cache
    set rows = coalesce((select jsonb_agg(to_jsonb(x)) from private.pnl_report_units_live(d) x), '[]'::jsonb), built_at = now()
    where p_from = d;
  end loop;
exception when others then
  raise warning 'refresh_pnl_cache failed: %', sqlerrm;
end $$;
revoke all on function private.refresh_pnl_cache() from public, anon, authenticated;

-- The owner's function: from the cache while it is valid (under 30 minutes old and not cleared), else worked out live.
create or replace function public.pnl_report_units(p_from date)
returns table (month text, sku text, gross numeric, ret_canc numeric, net numeric, item_value numeric, fsp_value numeric, sales numeric, earnings numeric, first_day date, last_day date)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_rows jsonb;
begin
  perform private.money_guard();
  select c.rows into v_rows from private.pnl_report_cache c where c.p_from = pnl_report_units.p_from and c.built_at > now() - interval '30 minutes';
  if v_rows is not null then
    return query
    select x.month, x.sku, x.gross, x.ret_canc, x.net, x.item_value, x.fsp_value, x.sales, x.earnings, x.first_day, x.last_day
    from jsonb_to_recordset(v_rows) as x(month text, sku text, gross numeric, ret_canc numeric, net numeric, item_value numeric, fsp_value numeric, sales numeric, earnings numeric, first_day date, last_day date);
  else
    return query select * from private.pnl_report_units_live(pnl_report_units.p_from);
  end if;
end $$;
revoke all on function public.pnl_report_units(date) from public, anon;
grant execute on function public.pnl_report_units(date) to authenticated, service_role;

select private.refresh_pnl_cache();
