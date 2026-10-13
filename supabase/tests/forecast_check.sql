-- Forecasting check: dispatch-day basis, the window, booked units, stock, and who sees which warehouse.
--
-- Rolled back, so safe on production. Any failed check raises an error.
--   psql "$DATABASE_URL" -f supabase/tests/forecast_check.sql

begin;

do $$
declare
  u_own uuid := gen_random_uuid();
  u_blr uuid := gen_random_uuid();
  w_blr uuid;
  w_del uuid;
  today date := (now() at time zone 'Asia/Kolkata')::date;
  snap date;
  res jsonb;
  r jsonb;
  n int;
begin
  select id into strict w_blr from public.warehouses where name = 'Bangalore';
  select id into strict w_del from public.warehouses where name = 'Delhi';
  insert into auth.users (id, instance_id, aud, role, email) values
    (u_own, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fc-own@example.test'),
    (u_blr, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fc-blr@example.test');
  insert into public.profiles (id, name, role, active) values (u_own, 'FC Owner', 'owner', true), (u_blr, 'FC Bangalore', 'warehouse', true)
  on conflict (id) do update set role = excluded.role, active = excluded.active;
  insert into public.user_warehouses values (u_blr, w_blr);

  -- Fake orders for a SKU nobody has: history starts 10 days ago, so the window is cut to the history there is.
  -- Dispatched at Bangalore: 60 units over days -10..-1 (6 a day) plus 5 units TODAY (must be left out).
  -- Dispatched at Delhi: 40 units. A cancelled order and an order dated long ago but dispatching in the window.
  insert into public.fk_order_items (platform, order_item_id, order_id, sku, quantity, order_day, warehouse_id, stage, dispatch_by) values
    ('flipkart', 'FC-B1', 'FC-B1', 'FC-SKU', 30, today - 40, w_blr, 'dispatched', ((today - 10)::text || ' 12:00:00+05:30')::timestamptz),
    ('flipkart', 'FC-B2', 'FC-B2', 'FC-SKU', 30, today - 3, w_blr, 'dispatched', ((today - 1)::text || ' 12:00:00+05:30')::timestamptz),
    ('flipkart', 'FC-B3', 'FC-B3', 'FC-SKU', 5, today - 1, w_blr, 'dispatched', (today::text || ' 12:00:00+05:30')::timestamptz),
    ('flipkart', 'FC-D1', 'FC-D1', 'FC-SKU', 40, today - 5, w_del, 'dispatched', ((today - 4)::text || ' 12:00:00+05:30')::timestamptz),
    ('flipkart', 'FC-X1', 'FC-X1', 'FC-SKU', 99, today - 5, w_blr, 'cancelled', ((today - 4)::text || ' 12:00:00+05:30')::timestamptz),
    -- booked: today 2, tomorrow 3, in 3 days 4, in 20 days 5, in 40 days 6 (outside), and one left_pending today 1
    ('flipkart', 'FC-P1', 'FC-P1', 'FC-SKU', 2, today, w_blr, 'pending', (today::text || ' 18:00:00+05:30')::timestamptz),
    ('flipkart', 'FC-P2', 'FC-P2', 'FC-SKU', 3, today, w_blr, 'pending', ((today + 1)::text || ' 09:00:00+05:30')::timestamptz),
    ('flipkart', 'FC-P3', 'FC-P3', 'FC-SKU', 4, today, w_blr, 'pending', ((today + 3)::text || ' 09:00:00+05:30')::timestamptz),
    ('flipkart', 'FC-P4', 'FC-P4', 'FC-SKU', 5, today, w_del, 'pending', ((today + 20)::text || ' 09:00:00+05:30')::timestamptz),
    ('flipkart', 'FC-P5', 'FC-P5', 'FC-SKU', 6, today, w_del, 'pending', ((today + 40)::text || ' 09:00:00+05:30')::timestamptz),
    ('flipkart', 'FC-P6', 'FC-P6', 'FC-SKU', 1, today - 2, w_blr, 'left_pending', (today::text || ' 10:00:00+05:30')::timestamptz);

  snap := public.flipkart_snapshot_date();
  insert into public.stock_listings (platform, sku, title, status, first_seen_date, last_seen_date) values ('flipkart', 'FC-SKU', 'Forecast test product', 'ACTIVE', today, today);
  if snap is not null then
    insert into public.stock_levels (platform, snapshot_date, sku, warehouse_id, inventory) values
      ('flipkart', snap, 'FC-SKU', w_blr, 12), ('flipkart', snap, 'FC-SKU', w_del, 8)
    on conflict do nothing;
  end if;

  -- ---- Owner: everything ----------------------------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', u_own, 'role', 'authenticated')::text, true);
  set local role authenticated;
  res := public.flipkart_forecast(30);
  assert (res ->> 'window_end')::date = today - 1, 'the window ends yesterday: today is partial';
  select x into r from jsonb_array_elements(res -> 'rows') x where x ->> 'sku' = 'FC-SKU' and x ->> 'wid' = w_blr::text;
  assert (r ->> 'disp')::int = 60, 'Bangalore dispatched 30 + 30 = 60: the order dated 40 days ago counts on its DISPATCH day, today''s 5 and the cancelled order do not';
  select x into r from jsonb_array_elements(res -> 'rows') x where x ->> 'sku' = 'FC-SKU' and x ->> 'wid' = w_del::text;
  assert (r ->> 'disp')::int = 40, 'Delhi dispatched 40';
  select x into r from jsonb_array_elements(res -> 'rows') x where x ->> 'sku' = 'FC-SKU' and x ->> 'wid' = w_blr::text;
  assert (r ->> 'b1')::int = 2 + 1, 'booked today (1 day) = the pending 2 and the left_pending 1';
  assert (r ->> 'b7')::int = 2 + 3 + 4 + 1, 'booked in 7 days includes tomorrow and day 3';
  select x into r from jsonb_array_elements(res -> 'rows') x where x ->> 'sku' = 'FC-SKU' and x ->> 'wid' = w_del::text;
  assert (r ->> 'b30')::int = 5, 'booked in 30 days: day 20 yes, day 40 no';
  -- the whole window is the days of the history there is (never more than asked)
  assert (res ->> 'days')::int <= 30 and (res ->> 'days')::int >= 1, 'days used';
  res := public.flipkart_forecast(7);
  assert (res ->> 'days')::int = 7, 'a 7-day window is 7 complete days';
  select x into r from jsonb_array_elements(res -> 'rows') x where x ->> 'sku' = 'FC-SKU' and x ->> 'wid' = w_blr::text;
  assert (r ->> 'disp')::int = 30, 'in the last 7 days Bangalore dispatched only the 30 from yesterday';
  res := public.flipkart_forecast(5);
  assert (res ->> 'asked')::int = 30, 'a window that is not 7, 14 or 30 falls back to 30';
  reset role;

  -- ---- A warehouse user sees only their own warehouse --------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', u_blr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  res := public.flipkart_forecast(30);
  select count(*) into n from jsonb_array_elements(res -> 'rows') x where x ->> 'sku' = 'FC-SKU' and x ->> 'wid' = w_del::text;
  assert n = 0, 'a Bangalore user sees nothing of Delhi';
  select count(*) into n from jsonb_array_elements(res -> 'rows') x where x ->> 'sku' = 'FC-SKU' and x ->> 'wid' = w_blr::text;
  assert n = 1, 'and sees Bangalore';
  select count(*) into n from jsonb_array_elements(res -> 'rows') x where x ->> 'wid' is distinct from w_blr::text;
  assert n = 0, 'every row is one of their warehouses';
  reset role;

  -- signed out: no
  set local role anon;
  begin
    perform public.flipkart_forecast(30);
    assert false, 'a signed-out visitor must not read the forecast';
  exception when insufficient_privilege then null;
  end;
  reset role;
end $$;

select 'All forecast checks passed' as result;

rollback;
