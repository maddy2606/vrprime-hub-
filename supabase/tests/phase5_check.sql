-- Phase 5 check: the three roles, the last-owner guard, and new-listing requests with the live check.
--
-- Runs in one transaction that is rolled back, so it is safe on production and leaves nothing behind.
-- Any failed check raises an error.
--
--   psql "$DATABASE_URL" -f supabase/tests/phase5_check.sql

begin;

do $$
declare
  u_own uuid := gen_random_uuid();   -- owner
  u_own2 uuid := gen_random_uuid();  -- second owner
  u_adm uuid := gen_random_uuid();   -- admin
  u_adm2 uuid := gen_random_uuid();  -- admin
  u_blr uuid := gen_random_uuid();   -- warehouse user, Bangalore only
  w_blr uuid;
  today date := (now() at time zone 'Asia/Kolkata')::date;
  p_open uuid;
  p_live uuid;
  p_over uuid;
  p_miss uuid;
  p_task uuid;
  run1 uuid;
  run2 uuid;
  res jsonb;
  n int;
  blocked boolean;
  post public.posts;
begin
  select id into strict w_blr from public.warehouses where name = 'Bangalore';

  insert into auth.users (id, instance_id, aud, role, email) values
    (u_own, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p5-own@example.test'),
    (u_own2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p5-own2@example.test'),
    (u_adm, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p5-adm@example.test'),
    (u_adm2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p5-adm2@example.test'),
    (u_blr, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p5-blr@example.test');
  insert into public.profiles (id, name, role, active) values
    (u_own, 'P5 Owner', 'owner', true),
    (u_own2, 'P5 Owner Two', 'owner', true),
    (u_adm, 'P5 Admin', 'admin', true),
    (u_adm2, 'P5 Admin Two', 'admin', true),
    (u_blr, 'P5 Bangalore', 'warehouse', true)
  on conflict (id) do update set name = excluded.name, role = excluded.role, active = excluded.active;
  insert into public.user_warehouses values (u_blr, w_blr);

  -- ---- The role list ---------------------------------------------------------------------
  blocked := false;
  begin
    update public.profiles set role = 'manager' where id = u_adm;
  exception when check_violation then blocked := true;
  end;
  assert blocked, 'manager is not a role any more';
  blocked := false;
  begin
    update public.profiles set role = 'listing' where id = u_adm;
  exception when check_violation then blocked := true;
  end;
  assert blocked, 'listing is not a role any more';
  assert not exists (select 1 from public.profiles where role not in ('owner', 'admin', 'warehouse')),
    'every user is an owner, an admin or a warehouse user';

  -- ---- The last active owner can never be demoted, deactivated or deleted ----------------------
  -- Park every other owner (allowed while a second one is active), leaving u_own alone.
  update public.profiles set active = false where role = 'owner' and id <> u_own and active;
  assert (select count(*) from public.profiles where role = 'owner' and active) = 1, 'exactly one active owner';

  blocked := false;
  begin
    update public.profiles set role = 'admin' where id = u_own;
  exception when check_violation then blocked := true;
  end;
  assert blocked, 'the last owner cannot be demoted';
  blocked := false;
  begin
    update public.profiles set active = false where id = u_own;
  exception when check_violation then blocked := true;
  end;
  assert blocked, 'the last owner cannot be deactivated';
  blocked := false;
  begin
    delete from public.profiles where id = u_own;
  exception when check_violation then blocked := true;
  end;
  assert blocked, 'the last owner cannot be deleted';
  update public.profiles set name = 'P5 Owner (renamed)' where id = u_own;  -- other edits are fine

  -- A second owner can be promoted, and then the first can be demoted.
  update public.profiles set role = 'owner', active = true where id = u_own2;
  update public.profiles set role = 'admin' where id = u_own;
  assert (select role from public.profiles where id = u_own) = 'admin', 'with a second owner the first can step down';
  update public.profiles set role = 'owner' where id = u_own;  -- back, for the rest

  -- ---- Settings and users are owner only (database level) --------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.app_settings set value = '1' where key = 'weight_alert_limit';
  get diagnostics n = row_count;
  assert n = 0, 'an admin cannot change a setting';
  update public.profiles set role = 'owner' where id = u_adm;
  get diagnostics n = row_count;
  assert n = 0, 'an admin cannot promote anyone, themselves included';
  update public.profiles set active = false where id = u_adm2;
  get diagnostics n = row_count;
  assert n = 0, 'an admin cannot deactivate a user';
  select count(*) into n from public.profiles;
  assert n >= 5, 'an admin can still read the people list';
  perform public.request_stock_sync();   -- Sync now is for admins too
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_own, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.app_settings set value = '2000' where key = 'weight_alert_limit';
  get diagnostics n = row_count;
  assert n = 1, 'an owner can change a setting';
  reset role;
  update public.stock_runs set status = 'done' where status in ('queued', 'running');

  -- ---- New-listing requests: who can post -----------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', u_blr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  blocked := false;
  begin
    insert into public.posts (type, title, created_by, warehouse_id) values ('new_listing', 'List a thing', u_blr, w_blr);
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'a warehouse user cannot post a new-listing request';
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.posts (type, title, created_by) values ('new_listing', 'List rat spray 500 ml on Flipkart', u_adm)
    returning id into p_open;
  insert into public.posts (type, title, created_by, platform, product_name, reference_url, target_price, mrp, dim_l, dim_b, dim_h, weight_kg)
    values ('new_listing', 'List a heavy thing', u_adm, 'flipkart', 'Heavy thing', 'https://example.test/x', 199, 299, 30, 20, 10, 1.25)
    returning id into p_over;
  reset role;
  assert (select count(*) from public.posts where id in (p_open, p_over)) = 2, 'an admin can post new-listing requests (title only is enough)';

  -- Nothing else is required on the request.
  assert (select sku from public.posts where id = p_open) is null, 'a request has no SKU until it is done';

  -- A warehouse user, even in the post's warehouse, sees none of them and cannot be assigned one.
  update public.posts set warehouse_id = w_blr where id = p_open;
  perform set_config('request.jwt.claims', json_build_object('sub', u_blr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.posts where type = 'new_listing';
  assert n = 0, 'a warehouse user sees no new-listing request';
  select count(*) into n from public.search_posts('rat spray');
  assert n = 0, 'a warehouse user cannot find one by search either';
  update public.posts set title = 'edited' where id = p_open;
  get diagnostics n = row_count;
  assert n = 0, 'a warehouse user cannot edit one';
  reset role;
  blocked := false;
  begin
    update public.posts set assignee_id = u_blr where id = p_open;
  exception when check_violation then blocked := true;
  end;
  assert blocked, 'a new-listing request cannot be assigned to a warehouse user';
  update public.posts set assignee_id = u_adm2 where id = p_open;   -- an admin is fine
  assert exists (select 1 from public.notifications where user_id = u_adm2 and kind = 'assigned' and post_id = p_open),
    'the assignee is told';

  -- ---- Marking done needs a SKU -------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', u_adm2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  blocked := false;
  begin
    update public.posts set status = 'done' where id = p_open;
  exception when check_violation then blocked := true;
  end;
  assert blocked, 'done without a SKU is refused';
  blocked := false;
  begin
    update public.posts set status = 'done', sku = '   ' where id = p_open;
  exception when check_violation then blocked := true;
  end;
  assert blocked, 'a blank SKU is refused';
  blocked := false;
  begin
    update public.posts set status = 'done', sku = ' P5-RAT ' where id = p_open;
  exception when check_violation then blocked := true;
  end;
  assert blocked, 'a SKU with spaces around it is refused';
  update public.posts set status = 'done', sku = 'P5-RAT' where id = p_open;
  select * into strict post from public.posts where id = p_open;
  assert post.status = 'done' and post.sku = 'P5-RAT' and post.done_listing_id is null, 'a SKU alone completes it (no FSN needed)';
  assert (select count(*) from public.search_posts('P5-RAT')) = 1, 'the SKU is searchable';
  assert exists (select 1 from public.post_events where post_id = p_open and kind = 'status' and changes ->> 'sku' = 'P5-RAT'),
    'the done event records the SKU';

  -- Tampering: a signed-in user cannot write the live-check result.
  update public.posts set live_found = true, live_status = 'ACTIVE', live_over_weight = true where id = p_open;
  reset role;
  select * into strict post from public.posts where id = p_open;
  assert post.live_found is null and post.live_status is null and post.live_over_weight is null,
    'the live-check columns cannot be written by a user';

  -- A request completed the old way (listing ID, no SKU) stays valid.
  insert into public.posts (type, title, created_by, status, done_listing_id)
    values ('new_listing', 'Old style', u_own, 'done', 'FSN123') returning id into p_task;
  assert (select count(*) from public.posts where id = p_task) = 1, 'an old done request with a listing ID is accepted';

  -- ---- The live check -------------------------------------------------------------------------------
  -- Three done requests: found and light, found and over the limit, not found. Dates are made old on purpose.
  update public.posts set status = 'open' where id = p_open;
  update public.posts set sku = 'P5-LIVE' where id = p_open;
  perform set_config('request.jwt.claims', json_build_object('sub', u_adm2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.posts set status = 'done' where id = p_open;
  reset role;
  p_live := p_open;
  perform set_config('request.jwt.claims', json_build_object('sub', u_adm2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.posts set status = 'done', sku = 'P5-OVER' where id = p_over;
  insert into public.posts (type, title, created_by) values ('new_listing', 'Will not be found', u_adm) returning id into p_miss;
  update public.posts set status = 'done', sku = 'P5-WRONG' where id = p_miss;
  reset role;

  -- The sync runs as the service role: no signed-in user.
  perform set_config('request.jwt.claims', '', true);
  delete from public.stock_runs;
  insert into public.stock_runs (trigger) values ('manual') returning id into run1;
  perform public.stock_run_begin(run1, array['P5-LIVE', 'P5-OVER']);
  perform public.stock_apply_batch(run1, jsonb_build_array(
    jsonb_build_object('sku', 'P5-LIVE', 'title', 'Live product', 'status', 'ACTIVE',
      'packages', jsonb_build_array(jsonb_build_object('dimensions', jsonb_build_object('length', 10, 'breadth', 5, 'height', 2), 'weight', 0.4))),
    jsonb_build_object('sku', 'P5-OVER', 'title', 'Heavy product', 'status', 'INACTIVE',
      'packages', jsonb_build_array(
        jsonb_build_object('dimensions', jsonb_build_object('length', 5, 'breadth', 5, 'height', 5), 'weight', 0.1),
        jsonb_build_object('dimensions', jsonb_build_object('length', 30, 'breadth', 20, 'height', 10), 'weight', 1.25)))
  ), 2, 0, 0);
  res := public.stock_run_finish(run1);
  assert (res ->> 'ok')::boolean, 'the sync finishes';

  select * into strict post from public.posts where id = p_live;
  assert post.live_found and post.live_status = 'ACTIVE' and post.live_since = today, 'found: live, active, since today';
  assert not post.live_over_weight and (post.live_package ->> 'total')::int = 500, 'real package 10x5x2 + 400 g = 500, under the limit';

  select * into strict post from public.posts where id = p_over;
  assert post.live_found and post.live_status = 'INACTIVE', 'found but inactive is reported as inactive';
  assert post.live_over_weight and (post.live_package ->> 'total')::int = 7250,
    'the heaviest package counts: 30x20x10 + 1250 g = 7250, over 2000';

  select * into strict post from public.posts where id = p_miss;
  assert post.live_found is false and post.live_alerted_at is null, 'not found yet, and no alert on day one';

  assert (select count(*) from public.notifications where kind = 'listing_live' and post_id = p_live and user_id = u_adm) = 1,
    'the person who posted it hears it is live';
  assert (select count(*) from public.notifications where kind = 'listing_not_found' and post_id = p_miss) = 0,
    'no not-found alert before 3 days';

  -- Same data again: nothing repeats.
  insert into public.stock_runs (trigger) values ('cron') returning id into run2;
  perform public.stock_run_begin(run2, array['P5-LIVE', 'P5-OVER']);
  perform public.stock_apply_batch(run2, jsonb_build_array(
    jsonb_build_object('sku', 'P5-LIVE', 'title', 'Live product', 'status', 'ACTIVE',
      'packages', jsonb_build_array(jsonb_build_object('dimensions', jsonb_build_object('length', 10, 'breadth', 5, 'height', 2), 'weight', 0.4))),
    jsonb_build_object('sku', 'P5-OVER', 'title', 'Heavy product', 'status', 'ACTIVE')), 2, 0, 0);
  perform public.stock_run_finish(run2);
  assert (select count(*) from public.notifications where kind = 'listing_live' and post_id = p_live) = 1, 'told once only';
  assert (select live_checked_at from public.posts where id = p_live) is not null, 'checked again';

  -- After 3 days not found: flagged, and the person who marked it done is told, once.
  alter table public.posts disable trigger posts_before_write;
  update public.posts set done_at = now() - interval '4 days' where id = p_miss;
  alter table public.posts enable trigger posts_before_write;
  insert into public.stock_runs (trigger) values ('cron') returning id into run1;
  perform public.stock_run_begin(run1, array['P5-LIVE']);
  perform public.stock_apply_batch(run1, jsonb_build_array(
    jsonb_build_object('sku', 'P5-LIVE', 'title', 'Live product', 'status', 'ACTIVE')), 1, 0, 0);
  perform public.stock_run_finish(run1);
  select * into strict post from public.posts where id = p_miss;
  assert post.live_found is false and post.live_alerted_at is not null, 'flagged once it is 3 days old and still not found';
  assert (select count(*) from public.notifications where kind = 'listing_not_found' and post_id = p_miss and user_id = u_adm2) = 1,
    'the person who marked it done is told (not the poster)';
  assert (select count(*) from public.notifications where kind = 'listing_not_found' and post_id = p_miss and user_id = u_adm) = 0,
    'the poster is not told about the wrong SKU';

  -- A Flipkart listing not seen by the latest run is not "live" for the check (and an old live one is left alone).
  select * into strict post from public.posts where id = p_over;
  assert post.live_found, 'a listing seen before and missing from one run keeps what we knew';

  -- Fixing the SKU starts the check over.
  update public.posts set sku = 'P5-LIVE' where id = p_miss;
  select * into strict post from public.posts where id = p_miss;
  assert post.live_found is null and post.live_alerted_at is null, 'a new SKU resets the live check';

  -- ---- Search for the product name; warehouse users still see their own tasks -----------------------
  assert (select count(*) from public.search_posts('Heavy thing')) >= 1, 'the product name is searchable';
  insert into public.posts (type, title, created_by, assignee_id) values ('task', 'Count shelf', u_adm, u_blr) returning id into p_task;
  perform set_config('request.jwt.claims', json_build_object('sub', u_blr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.posts where id = p_task;
  assert n = 1, 'a warehouse user still sees a task assigned to them';
  reset role;
end $$;

select 'All Phase 5 checks passed' as result;

rollback;
