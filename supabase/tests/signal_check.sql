-- Signal Pro check: the dispatch_daily rollup and the Command Deck series follow the same access rules as the orders
-- they come from (owner and admin see everything, a warehouse user only their own warehouses, signed-out nobody).
-- Rolled back, so safe on production. Any failed check raises an error.
--   psql "$DATABASE_URL" -f supabase/tests/signal_check.sql

begin;

do $$
declare
  u_own uuid := gen_random_uuid();
  u_adm uuid := gen_random_uuid();
  u_blr uuid := gen_random_uuid();
  w_blr uuid;
  w_del uuid;
  today date := (now() at time zone 'Asia/Kolkata')::date;
  n int;
  js jsonb;
begin
  select id into strict w_blr from public.warehouses where name = 'Bangalore';
  select id into strict w_del from public.warehouses where name = 'Delhi';
  insert into auth.users (id, instance_id, aud, role, email) values
    (u_own, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sg-own@example.test'),
    (u_adm, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sg-adm@example.test'),
    (u_blr, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sg-blr@example.test');
  insert into public.profiles (id, name, role, active) values (u_own, 'SG Owner', 'owner', true), (u_adm, 'SG Admin', 'admin', true), (u_blr, 'SG Bangalore', 'warehouse', true)
  on conflict (id) do update set role = excluded.role, active = excluded.active;
  insert into public.user_warehouses values (u_blr, w_blr);

  -- two dispatched orders on the same IST day at different warehouses, one just after midnight IST (still that day)
  insert into public.fk_order_items (platform, order_item_id, order_id, sku, quantity, order_day, warehouse_id, stage, dispatch_by) values
    ('flipkart', 'SG-1', 'SG-1', 'SG-SKU', 7, today - 5, w_blr, 'dispatched', ((today - 3)::text || ' 00:30:00+05:30')::timestamptz),
    ('flipkart', 'SG-2', 'SG-2', 'SG-SKU', 5, today - 5, w_del, 'dispatched', ((today - 3)::text || ' 23:30:00+05:30')::timestamptz),
    ('flipkart', 'SG-3', 'SG-3', 'SG-SKU', 99, today - 5, w_del, 'pending', ((today - 3)::text || ' 12:00:00+05:30')::timestamptz);
  perform private.dispatch_daily_refresh();

  -- the day is the IST day, and only dispatched orders are in it
  select sum(units) into n from public.dispatch_daily where sku = 'SG-SKU' and dispatch_day = today - 3;
  assert n = 12, 'dispatch_day is the IST date of dispatch_by, pending orders are left out';

  -- owner and admin: both warehouses
  perform set_config('request.jwt.claims', json_build_object('sub', u_own, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.dispatch_daily where sku = 'SG-SKU';
  assert n = 2, 'owner sees both warehouses';
  js := public.deck_series(100);
  assert js ? 'stock' and js ? 'due' and js ? 'tickets', 'deck_series answers for the owner';
  assert jsonb_array_length(public.dispatch_series(7)) = 7, 'dispatch_series gives one point per day';
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.dispatch_daily where sku = 'SG-SKU';
  assert n = 2, 'admin sees both warehouses';
  reset role;

  -- warehouse user: only Bangalore
  perform set_config('request.jwt.claims', json_build_object('sub', u_blr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.dispatch_daily where sku = 'SG-SKU';
  assert n = 1, 'a warehouse user sees only their own warehouse';
  select sum((x ->> 'units')::int) into n from jsonb_array_elements(public.dispatch_series(7)) x;
  assert coalesce(n, 0) >= 7, 'their series counts their own dispatches';
  begin
    perform private.dispatch_daily_refresh();
    raise exception 'a signed-in user must not rebuild the rollup';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.dispatch_daily (sku, dispatch_day, units) values ('X', today, 1);
    raise exception 'a signed-in user must not write the rollup';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- signed out: nothing
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  begin
    perform count(*) from public.dispatch_daily;
    raise exception 'signed-out must not read dispatch_daily';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.deck_series(100);
    raise exception 'signed-out must not call deck_series';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.dispatch_series(7);
    raise exception 'signed-out must not call dispatch_series';
  exception when insufficient_privilege then null;
  end;
  reset role;

  raise notice 'All Signal Pro checks passed';
end $$;

select 'All Signal Pro checks passed' as result;

rollback;
