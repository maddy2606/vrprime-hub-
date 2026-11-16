-- Order syncs were failing at their last step. Checked on 16 Nov 2026: 22 of 99 runs in three days ended with
-- "Finishing the run: canceling statement due to statement timeout". The step rebuilt the dispatch totals from EVERY
-- dispatched order since September (150,000 lines, 6.7 s on its own against the 8 s limit), and that grows every day.
-- A failed finish also skips marking orders that left the pending list, so the forecast's history lagged.
--
-- Orders dispatched more than three weeks ago no longer change, so each sync now rebuilds only the last 21 days of
-- totals (2.3 s cold, from an index), and leaves older days as they are. private.dispatch_daily_refresh(null)
-- still rebuilds everything, for a repair by hand.

create or replace function private.dispatch_daily_refresh(p_days integer default 21) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
  v_from timestamptz := case when p_days is null then '-infinity'::timestamptz
                             else (((now() at time zone 'Asia/Kolkata')::date - p_days)::timestamp at time zone 'Asia/Kolkata') end;
  v_day date := case when p_days is null then '-infinity'::date else (now() at time zone 'Asia/Kolkata')::date - p_days end;
begin
  merge into public.dispatch_daily d
  using (
    select i.platform, i.sku, (i.dispatch_by at time zone 'Asia/Kolkata')::date as dispatch_day, i.warehouse_id, sum(i.quantity)::integer as units
    from public.fk_order_items i
    where i.platform = 'flipkart' and i.stage = 'dispatched' and i.dispatch_by >= v_from and i.sku is not null
    group by 1, 2, 3, 4
  ) s
  on d.platform = s.platform and d.sku = s.sku and d.dispatch_day = s.dispatch_day
     and coalesce(d.warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(s.warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid)
  when matched and d.units is distinct from s.units then update set units = s.units
  when not matched by target then insert (platform, sku, dispatch_day, warehouse_id, units) values (s.platform, s.sku, s.dispatch_day, s.warehouse_id, s.units)
  -- Only days inside the window may be removed: older totals are outside what was just counted.
  when not matched by source and d.platform = 'flipkart' and d.dispatch_day >= v_day then delete;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function private.dispatch_daily_refresh(integer) from public, anon, authenticated;
grant execute on function private.dispatch_daily_refresh(integer) to service_role;

-- The old no-argument form would make "dispatch_daily_refresh()" ambiguous.
drop function if exists private.dispatch_daily_refresh();
