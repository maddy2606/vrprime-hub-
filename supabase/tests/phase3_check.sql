-- Phase 3 check: saving a Flipkart sync, inactive tracking, retention, and who can see which units.
--
-- Like the other checks it runs in one transaction that is rolled back, so it is safe on
-- production and leaves nothing behind. It does delete finished sync runs, but only inside
-- that transaction, to be sure the first sync is treated as a first sync. Any failed check
-- raises an error.
--
--   psql "$DATABASE_URL" -f supabase/tests/phase3_check.sql

begin;

do $$
declare
  u_mgr uuid := gen_random_uuid();   -- manager
  u_lst uuid := gen_random_uuid();   -- listing
  u_blr uuid := gen_random_uuid();   -- warehouse user, Bangalore only
  w_blr uuid;
  w_del uuid;
  loc_blr text;
  loc_del text;
  today date := (now() at time zone 'Asia/Kolkata')::date;
  run1 uuid;
  run2 uuid;
  run3 uuid;
  run4 uuid;
  run5 uuid;
  res jsonb;
  n int;
  l public.stock_listings;
  blocked boolean;
begin
  select id, flipkart_location_id into strict w_blr, loc_blr from public.warehouses where name = 'Bangalore';
  select id, flipkart_location_id into strict w_del, loc_del from public.warehouses where name = 'Delhi';

  insert into auth.users (id, instance_id, aud, role, email) values
    (u_mgr, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p3-mgr@example.test'),
    (u_lst, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p3-lst@example.test'),
    (u_blr, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p3-blr@example.test');
  insert into public.profiles (id, name, role, active) values
    (u_mgr, 'P3 Manager', 'manager', true),
    (u_lst, 'P3 Listing', 'listing', true),
    (u_blr, 'P3 Bangalore', 'warehouse', true)
  on conflict (id) do update set name = excluded.name, role = excluded.role, active = excluded.active;
  insert into public.user_warehouses values (u_blr, w_blr);

  -- Start from "no sync has ever finished" (undone by the rollback).
  delete from public.stock_runs;

  -- ---- First sync ------------------------------------------------------------
  insert into public.stock_runs (trigger) values ('manual') returning id into run1;
  res := public.stock_run_begin(run1, array['P3-A', 'P3-B', 'P3-C', 'P3-D', 'P3-FBF']);
  assert (res ->> 'first_sync')::boolean, 'the first ever sync must be flagged as the first sync';
  assert (res ->> 'total')::int = 5, 'begin should record how many SKUs Flipkart listed';

  res := public.stock_apply_batch(run1, jsonb_build_array(
    jsonb_build_object('sku', 'P3-A', 'title', 'Fake product A', 'status', 'active', 'listing_id', 'LSTA',
      'packages', jsonb_build_array(jsonb_build_object('dimensions', jsonb_build_object('length', 10, 'breadth', 5, 'height', 2), 'weight', 0.4)),
      'locations', jsonb_build_array(
        jsonb_build_object('id', loc_blr, 'status', 'ACTIVE', 'inventory', 50),
        jsonb_build_object('id', loc_del, 'status', 'ACTIVE', 'inventory', 200),
        jsonb_build_object('id', 'LOCunknownlocation', 'status', 'ACTIVE', 'inventory', 5))),
    jsonb_build_object('sku', 'P3-B', 'title', 'Fake product B', 'status', 'INACTIVE',
      'locations', jsonb_build_array(jsonb_build_object('id', loc_blr, 'status', 'ACTIVE', 'inventory', 0))),
    jsonb_build_object('sku', 'P3-C', 'title', 'Fake product C', 'status', 'ACTIVE'),
    jsonb_build_object('sku', 'P3-D', 'title', 'Fake product D', 'status', 'ACTIVE',
      'locations', jsonb_build_array(
        jsonb_build_object('id', loc_del, 'status', 'ACTIVE', 'inventory', -5),
        jsonb_build_object('id', loc_blr, 'status', 'ACTIVE', 'inventory', null)))
  ), 5, 1, 0);
  assert (res ->> 'saved')::int = 4, 'four listings should be saved';
  assert (res ->> 'unmapped_locations')::int = 1, 'a location that is not one of our warehouses should be counted, not saved';

  select count(*) into n from public.stock_levels where snapshot_date = today and sku like 'P3-%';
  assert n = 5, 'A has two warehouses, B one, D two: five rows';
  select count(*) into n from public.stock_levels where snapshot_date = today and sku = 'P3-D' and inventory = 0;
  assert n = 2, 'a negative or missing inventory must be saved as 0';
  select count(*) into n from public.stock_snapshot_skus where snapshot_date = today and sku like 'P3-%';
  assert n = 4, 'every saved SKU is in the snapshot, even with no locations';

  select * into strict l from public.stock_listings where sku = 'P3-A';
  assert l.status = 'ACTIVE' and l.inactive_since is null and not l.inactive_before_tracking, 'active listing has no inactive date';
  select * into strict l from public.stock_listings where sku = 'P3-B';
  assert l.inactive_since = today and l.inactive_before_tracking,
    'listings already inactive on the first sync are marked "before tracking"';

  res := public.stock_run_finish(run1);
  assert (res ->> 'ok')::boolean, 'a complete first sync should finish';
  assert (select status from public.stock_runs where id = run1) = 'done', 'run should be marked done';
  assert (select skipped_fbf from public.stock_runs where id = run1) = 1, 'the FBF skip should be counted';

  -- ---- Second sync: inactive tracking, and a same-day rerun replaces numbers ----
  insert into public.stock_runs (trigger) values ('cron') returning id into run2;
  res := public.stock_run_begin(run2, array['P3-A', 'P3-B', 'P3-C', 'P3-F']);
  assert not (res ->> 'first_sync')::boolean, 'a later sync is not the first sync';

  perform public.stock_apply_batch(run2, jsonb_build_array(
    jsonb_build_object('sku', 'P3-A', 'title', 'Fake product A', 'status', 'INACTIVE',
      'locations', jsonb_build_array(jsonb_build_object('id', loc_blr, 'status', 'ACTIVE', 'inventory', 40))),
    jsonb_build_object('sku', 'P3-B', 'title', 'Fake product B', 'status', 'INACTIVE'),
    jsonb_build_object('sku', 'P3-C', 'title', 'Fake product C', 'status', 'ACTIVE'),
    jsonb_build_object('sku', 'P3-F', 'title', 'Fake new product F', 'status', 'INACTIVE')
  ), 4, 0, 0);

  select * into strict l from public.stock_listings where sku = 'P3-A';
  assert l.inactive_since = today and not l.inactive_before_tracking,
    'a listing that goes inactive after the first sync is a new inactive';
  select * into strict l from public.stock_listings where sku = 'P3-B';
  assert l.inactive_before_tracking, 'a listing that stays inactive keeps its "before tracking" mark';
  select * into strict l from public.stock_listings where sku = 'P3-F';
  assert l.inactive_since = today and not l.inactive_before_tracking, 'a new listing seen inactive counts as new inactive';

  select count(*) into n from public.stock_levels where snapshot_date = today and sku = 'P3-A';
  assert n = 1, 'a rerun on the same day replaces that SKU''s numbers (Delhi row is gone)';
  assert (select inventory from public.stock_levels where snapshot_date = today and sku = 'P3-A') = 40, 'the new number wins';
  select count(*) into n from public.stock_listings where sku = 'P3-FBF';
  assert n = 0, 'FBF listings are never saved';

  perform public.stock_run_finish(run2);

  -- ---- Third sync: coming back to active clears the inactive date --------------
  insert into public.stock_runs (trigger) values ('manual') returning id into run3;
  perform public.stock_run_begin(run3, array['P3-A']);
  perform public.stock_apply_batch(run3, jsonb_build_array(
    jsonb_build_object('sku', 'P3-A', 'title', 'Fake product A', 'status', 'ACTIVE')), 1, 0, 0);
  select * into strict l from public.stock_listings where sku = 'P3-A';
  assert l.inactive_since is null and not l.inactive_before_tracking, 'becoming active again clears the inactive date';
  perform public.stock_run_finish(run3);

  -- ---- Sanity checks refuse a bad sync ----------------------------------------
  insert into public.stock_runs (trigger) values ('manual') returning id into run4;
  perform public.stock_run_begin(run4, array['P3-1', 'P3-2', 'P3-3', 'P3-4', 'P3-5']);
  perform public.stock_apply_batch(run4, '[]'::jsonb, 5, 0, 3);
  res := public.stock_run_finish(run4);
  assert not (res ->> 'ok')::boolean and (select status from public.stock_runs where id = run4) = 'failed',
    'a sync where Flipkart gave details for too few listings must fail, not become the snapshot';

  insert into public.stock_runs (trigger) values ('manual') returning id into run5;
  perform public.stock_run_begin(run5, array[]::text[]);
  res := public.stock_run_finish(run5);
  assert not (res ->> 'ok')::boolean, 'an empty listing from Flipkart must fail the sync';

  -- ---- Keep 60 days ----------------------------------------------------------------
  insert into public.stock_snapshot_skus (snapshot_date, sku, listing_status) values (today - 61, 'P3-A', 'ACTIVE'), (today - 59, 'P3-A', 'ACTIVE');
  insert into public.stock_levels (snapshot_date, sku, warehouse_id, inventory) values (today - 61, 'P3-A', w_blr, 1), (today - 59, 'P3-A', w_blr, 1);
  insert into public.stock_runs (trigger) values ('manual') returning id into run5;
  perform public.stock_run_begin(run5, array['P3-A']);
  perform public.stock_apply_batch(run5, jsonb_build_array(
    jsonb_build_object('sku', 'P3-A', 'title', 'Fake product A', 'status', 'ACTIVE')), 1, 0, 0);
  perform public.stock_run_finish(run5);
  select count(*) into n from public.stock_levels where sku = 'P3-A' and snapshot_date = today - 61;
  assert n = 0, 'snapshots older than 60 days are removed';
  select count(*) into n from public.stock_levels where sku = 'P3-A' and snapshot_date = today - 59;
  assert n = 1, 'snapshots inside 60 days are kept';

  -- ---- Who sees which units ----------------------------------------------------------
  -- Today's numbers for SKU A: Bangalore 40 and Delhi 300.
  insert into public.stock_levels (snapshot_date, sku, warehouse_id, inventory)
    values (today, 'P3-A', w_blr, 40), (today, 'P3-A', w_del, 300)
    on conflict do nothing;

  perform set_config('request.jwt.claims', json_build_object('sub', u_blr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.stock_levels where warehouse_id = w_del;
  assert n = 0, 'a Bangalore warehouse user must NOT see Delhi units';
  select count(*) into n from public.stock_levels where warehouse_id = w_blr and sku like 'P3-%';
  assert n >= 1, 'a Bangalore warehouse user sees Bangalore units';
  res := public.stock_snapshot(today);
  assert res -> 'P3-A' -> 'w' ? w_blr::text, 'the snapshot includes their own warehouse';
  assert not (res -> 'P3-A' -> 'w' ? w_del::text), 'the snapshot must not leak other warehouses'' units';
  assert res ? 'P3-C', 'every SKU in the snapshot is listed, even with no units for this user';
  select count(*) into n from public.stock_listings where sku = 'P3-A';
  assert n = 1, 'any signed-in user can read the list of SKUs';

  blocked := false;
  begin
    update public.stock_levels set inventory = 999999 where sku = 'P3-A';
    get diagnostics n = row_count;
    blocked := (n = 0);
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'nobody can change stock numbers from the app';

  blocked := false;
  begin
    perform public.stock_apply_batch(run1, '[]'::jsonb, 0, 0, 0);
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'saving a sync is for the service role only';

  blocked := false;
  begin
    perform public.request_stock_sync();
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'a warehouse user must not be able to start a sync';
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', u_lst, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.stock_levels where warehouse_id = w_del;
  assert n >= 1, 'a listing user sees every warehouse';
  blocked := false;
  begin
    perform public.request_stock_sync();
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'a listing user must not be able to start a sync (owner and manager only)';
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.stock_levels where warehouse_id = w_del;
  assert n >= 1, 'a manager sees every warehouse';
  reset role;

  -- ---- Starting a sync -------------------------------------------------------------------
  -- Mark every run finished so we start clean, then ask twice: the second ask reuses the first run.
  update public.stock_runs set status = 'done' where status in ('queued', 'running');
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  run1 := public.request_stock_sync();
  run2 := public.request_stock_sync();
  reset role;
  assert run1 is not null and run1 = run2, 'asking for a sync while one is running must reuse it';
  assert (select requested_by from public.stock_runs where id = run1) = u_mgr, 'the run records who asked';

  -- ---- The watchdog ---------------------------------------------------------------------------
  update public.stock_runs set status = 'running', updated_at = now() - interval '10 minutes', lease_until = null, attempts = 2 where id = run1;
  perform private.resume_stalled_sync();
  assert (select attempts from public.stock_runs where id = run1) = 3, 'a silent run is restarted and the attempt counted';
  update public.stock_runs set updated_at = now() - interval '10 minutes', attempts = 8 where id = run1;
  perform private.resume_stalled_sync();
  assert (select status from public.stock_runs where id = run1) = 'failed', 'a run interrupted too often is given up on';
  update public.stock_runs set status = 'running', updated_at = now() - interval '10 minutes', lease_until = now() + interval '1 minute', attempts = 0 where id = run1;
  perform private.resume_stalled_sync();
  assert (select attempts from public.stock_runs where id = run1) = 0, 'a run with a live worker must be left alone';

  -- ---- The schedule ------------------------------------------------------------------------------
  select count(*) into n from cron.job where jobname = 'stock-sync-daily' and schedule = '30 2 * * *' and active;
  assert n = 1, 'the daily sync is scheduled for 02:30 UTC (08:00 IST)';
  select count(*) into n from cron.job where jobname = 'stock-sync-watchdog' and active;
  assert n = 1, 'the watchdog is scheduled';
end $$;

select 'All Phase 3 checks passed' as result;

rollback;
