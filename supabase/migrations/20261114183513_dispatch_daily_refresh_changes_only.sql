-- 15 Nov 2026. Already applied to the live database (version 20261114183513). Safe to run twice.
-- A third of the order syncs were failing at their last step ("Finishing the run: canceling statement due
-- to statement timeout": 12 of 33 runs on 14 Nov, 17 of 33 on 12 Nov). orders_run_finish has 8 seconds, and
-- private.dispatch_daily_refresh alone took 5 of them on a quiet database: every run it deleted all 21,000 rows of
-- dispatch_daily and wrote them again.
--
-- It now works out the same totals and changes only the rows that differ (new, changed or gone). The table ends up
-- exactly as before: checked on the live database by damaging 151 rows inside a rolled-back transaction, after which
-- the table matched a fresh count row for row. Time: 5.0 s -> 0.2 to 1.8 s. It also stops churning 42,000 rows a run.
-- The function still returns the number of rows in the table.
--
-- Undo: run 20261017092000_dispatch_daily_refresh_where.sql again (the old delete-and-insert version).
create or replace function private.dispatch_daily_refresh() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  merge into public.dispatch_daily d
  using (
    select i.platform, i.sku, (i.dispatch_by at time zone 'Asia/Kolkata')::date as dispatch_day, i.warehouse_id, sum(i.quantity)::integer as units
    from public.fk_order_items i
    where i.stage = 'dispatched' and i.sku is not null and i.dispatch_by is not null
    group by 1, 2, 3, 4
  ) s
  on d.platform = s.platform and d.sku = s.sku and d.dispatch_day = s.dispatch_day
     and coalesce(d.warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(s.warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid)
  when matched and d.units is distinct from s.units then update set units = s.units
  when not matched by target then insert (platform, sku, dispatch_day, warehouse_id, units) values (s.platform, s.sku, s.dispatch_day, s.warehouse_id, s.units)
  when not matched by source then delete;
  select count(*) into n from public.dispatch_daily;
  return n;
end $$;
