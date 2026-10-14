-- This database rejects DELETE or UPDATE without a WHERE clause (safe-update guard). The first version of the rollup
-- rebuild did `delete from public.dispatch_daily;`, which made every order sync fail. Same function, with a WHERE.

create or replace function private.dispatch_daily_refresh()
 returns integer language plpgsql security definer set search_path to ''
as $function$
declare n integer;
begin
  delete from public.dispatch_daily where true;
  insert into public.dispatch_daily (platform, sku, dispatch_day, warehouse_id, units)
  select i.platform, i.sku, (i.dispatch_by at time zone 'Asia/Kolkata')::date, i.warehouse_id, sum(i.quantity)::integer
  from public.fk_order_items i
  where i.stage = 'dispatched' and i.sku is not null and i.dispatch_by is not null
  group by 1, 2, 3, 4;
  get diagnostics n = row_count;
  return n;
end $function$;

revoke all on function private.dispatch_daily_refresh() from public, anon, authenticated;
grant execute on function private.dispatch_daily_refresh() to service_role;
