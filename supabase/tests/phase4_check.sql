-- Phase 4 check: price history, saving orders and returns, dispatch alerts, access, rates.
--
-- Like the other checks it runs in one transaction that is rolled back, so it is safe on
-- production and leaves nothing behind (fake users, SKUs, orders and runs all disappear).
-- It clears the order tables and runs inside that transaction only, to start from nothing.
-- Any failed check raises an error.
--
--   psql "$DATABASE_URL" -f supabase/tests/phase4_check.sql

begin;

do $$
declare
  u_own uuid := gen_random_uuid();   -- owner
  u_mgr uuid := gen_random_uuid();   -- admin
  u_lst uuid := gen_random_uuid();   -- admin
  u_blr uuid := gen_random_uuid();   -- warehouse user, Bangalore only
  w_blr uuid;
  w_del uuid;
  loc_blr text;
  loc_del text;
  today date := (now() at time zone 'Asia/Kolkata')::date;
  srun uuid;
  run1 uuid;
  run2 uuid;
  run3 uuid;
  res jsonb;
  n int;
  v_staff int;
  v_parts int := jsonb_array_length(private.order_plan('pending'));
  o public.fk_order_items;
  blocked boolean;
  soon text := to_char(now() + interval '2 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  later text := to_char(now() + interval '30 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  ago2 text := to_char(now() - interval '2 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  ago9 text := to_char(now() - interval '9 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  ago30m text := to_char(now() - interval '30 minutes', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  yday text := to_char(now() - interval '30 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
begin
  select count(*) into v_staff from public.profiles where active and role in ('owner', 'admin');   -- the real ones count too, from the moment the test users exist
  select id, flipkart_location_id into strict w_blr, loc_blr from public.warehouses where name = 'Bangalore';
  select id, flipkart_location_id into strict w_del, loc_del from public.warehouses where name = 'Delhi';

  insert into auth.users (id, instance_id, aud, role, email) values
    (u_own, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p4-own@example.test'),
    (u_mgr, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p4-mgr@example.test'),
    (u_lst, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p4-lst@example.test'),
    (u_blr, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p4-blr@example.test');
  insert into public.profiles (id, name, role, active) values
    (u_own, 'P4 Owner', 'owner', true),
    (u_mgr, 'P4 Admin', 'admin', true),
    (u_lst, 'P4 Admin 2', 'admin', true),
    (u_blr, 'P4 Bangalore', 'warehouse', true)
  on conflict (id) do update set name = excluded.name, role = excluded.role, active = excluded.active;
  insert into public.user_warehouses values (u_blr, w_blr);

  -- ===== Stock sync: tax details and price history =====================================
  delete from public.stock_runs;
  insert into public.stock_runs (trigger) values ('manual') returning id into srun;
  perform public.stock_run_begin(srun, array['P4-A', ' P4-SPACE']);
  perform public.stock_apply_batch(srun, jsonb_build_array(
    jsonb_build_object('sku', 'P4-A', 'status', 'ACTIVE', 'mrp', 500, 'selling_price', 400, 'hsn', ' 33012400 ', 'tax_code', 'GST_5',
      'locations', jsonb_build_array(jsonb_build_object('id', loc_blr, 'status', 'ACTIVE', 'inventory', 30))),
    jsonb_build_object('sku', ' P4-SPACE', 'status', 'ACTIVE', 'mrp', 100, 'selling_price', 100)), 2, 0, 0);
  assert (select hsn from public.stock_listings where sku = 'P4-A') = '33012400', 'HSN is saved (trimmed)';
  assert (select tax_code from public.stock_listings where sku = 'P4-A') = 'GST_5', 'tax code is saved';
  assert (select tax_read from public.stock_listings where sku = 'P4-A'), 'tax_read says the tax fields were looked at';
  assert exists (select 1 from public.stock_listings where sku = ' P4-SPACE'), 'a SKU with a leading space is kept exactly as Flipkart sent it';
  assert (select selling_price from public.stock_prices where sku = 'P4-A' and snapshot_date = today) = 400, 'the day''s price is saved';
  assert not exists (select 1 from public.price_changes where sku = 'P4-A'), 'the first time a SKU is seen is not a price change';
  perform public.stock_run_finish(srun);

  -- the same day again with a new price: logged once, old -> new
  insert into public.stock_runs (trigger) values ('manual') returning id into srun;
  perform public.stock_run_begin(srun, array['P4-A']);
  perform public.stock_apply_batch(srun, jsonb_build_array(
    jsonb_build_object('sku', 'P4-A', 'status', 'ACTIVE', 'mrp', 500, 'selling_price', 300, 'hsn', '33012400', 'tax_code', 'GST_5')), 1, 0, 0);
  select count(*) into n from public.price_changes where sku = 'P4-A';
  assert n = 1, 'one price change is logged';
  assert (select old_selling_price from public.price_changes where sku = 'P4-A') = 400
     and (select new_selling_price from public.price_changes where sku = 'P4-A') = 300, 'old -> new is recorded';
  perform public.stock_run_finish(srun);

  -- changing it again the same day keeps the first old value
  insert into public.stock_runs (trigger) values ('manual') returning id into srun;
  perform public.stock_run_begin(srun, array['P4-A']);
  perform public.stock_apply_batch(srun, jsonb_build_array(
    jsonb_build_object('sku', 'P4-A', 'status', 'ACTIVE', 'mrp', 500, 'selling_price', 250)), 1, 0, 0);
  assert (select old_selling_price from public.price_changes where sku = 'P4-A') = 400
     and (select new_selling_price from public.price_changes where sku = 'P4-A') = 250, 'two changes in a day are one line, from the first old value';
  -- and back to where it began: no change at all
  perform public.stock_apply_batch(srun, jsonb_build_array(
    jsonb_build_object('sku', 'P4-A', 'status', 'ACTIVE', 'mrp', 500, 'selling_price', 400)), 0, 0, 0);
  assert not exists (select 1 from public.price_changes where sku = 'P4-A'), 'a change undone the same day is not a change';
  perform public.stock_run_finish(srun);

  -- retention
  insert into public.price_changes (sku, change_date, old_selling_price, new_selling_price)
    values ('P4-A', today - 400, 1, 2), ('P4-A', today - 300, 2, 3);
  insert into public.stock_prices (snapshot_date, sku, selling_price) values (today - 61, 'P4-A', 1), (today - 30, 'P4-A', 1);
  insert into public.stock_runs (trigger) values ('manual') returning id into srun;
  perform public.stock_run_begin(srun, array['P4-A']);
  perform public.stock_apply_batch(srun, jsonb_build_array(jsonb_build_object('sku', 'P4-A', 'status', 'ACTIVE', 'mrp', 500, 'selling_price', 400)), 1, 0, 0);
  perform public.stock_run_finish(srun);
  assert not exists (select 1 from public.price_changes where change_date = today - 400), 'price changes older than 12 months go';
  assert exists (select 1 from public.price_changes where change_date = today - 300), 'price changes inside 12 months stay';
  assert not exists (select 1 from public.stock_prices where snapshot_date = today - 61), 'daily prices older than 60 days go';
  assert exists (select 1 from public.stock_prices where snapshot_date = today - 30), 'daily prices inside 60 days stay';

  -- ===== Order runs: plans and starting ====================================================
  delete from public.order_runs;
  delete from public.fk_order_items;
  delete from public.fk_returns;
  delete from public.notifications;

  assert jsonb_array_length(private.order_plan('pending')) = 5 * (select count(*) from public.warehouses where flipkart_location_id is not null), 'a pending sweep reads each of the five pre-dispatch states at each warehouse';
  assert jsonb_array_length(private.order_plan('daily')) = 8, 'the daily run reads 4 days of shipped orders, 2 cancellation kinds, 2 return kinds';
  assert jsonb_array_length(private.order_plan('backfill')) = 34, 'the backfill reads 30 days, 2 cancellation kinds, 2 return kinds';
  assert (private.order_plan('backfill') -> 0 ->> 'day')::date = today, 'the backfill starts with today and works backwards';
  assert (private.order_plan('backfill') -> 29 ->> 'day')::date = today - 29, 'and ends 29 days ago';
  assert jsonb_array_length(private.order_plan('backfill', today - 10)) = 4 + 19, 'a restarted backfill skips days it already finished';
  assert not (private.order_plan('pending') @> '[{"t":"post"}]'::jsonb), 'a pending sweep does not read shipped orders';
  assert jsonb_array_length(private.order_plan('upcoming')) = 12 * (select count(*) from public.warehouses where flipkart_location_id is not null) + 14,
    'the upcoming sweep reads APPROVED in 8 date chunks and the other 4 states whole, at each warehouse, plus 14 days of shipped orders';
  assert (private.order_plan('upcoming') @> '[{"t":"post","only":"SHIPPED"}]'::jsonb), 'the upcoming sweep reads orders in transit';

  run1 := private.start_order_run('pending', 'manual', u_mgr);
  run2 := private.start_order_run('pending', 'cron', null);
  assert run1 = run2, 'asking for a sync while one is running reuses it';
  update public.order_runs set status = 'running', lease_until = now() + interval '1 minute' where id = run1;

  -- ===== Saving pending orders ===================================================================
  -- A: Bangalore, due in 2 hours (at risk). B: Delhi, due in 30 hours. C: Bangalore, overdue by 9 hours.
  -- D: Bangalore, 2 hours late. E: on hold, due in 2 hours. J: Bangalore, 30 minutes late (just missed).
  res := public.orders_apply_page(run1, 0, jsonb_build_array(
    jsonb_build_object('order_item_id', 'P4-OI-A', 'order_id', 'P4-OD-1', 'shipment_id', 'P4-SH-1', 'sku', 'P4-A', 'quantity', 2,
      'order_date', ago2, 'location_id', loc_blr, 'status', 'APPROVED', 'hold', false, 'dispatch_by', soon, 'dispatch_after', ago2),
    jsonb_build_object('order_item_id', 'P4-OI-B', 'order_id', 'P4-OD-2', 'sku', 'P4-A', 'quantity', 1,
      'order_date', ago2, 'location_id', loc_del, 'status', 'APPROVED', 'dispatch_by', later),
    jsonb_build_object('order_item_id', 'P4-OI-C', 'order_id', 'P4-OD-3', 'sku', 'P4-A', 'quantity', 1,
      'order_date', yday, 'location_id', loc_blr, 'status', 'APPROVED', 'dispatch_by', ago9),
    jsonb_build_object('order_item_id', 'P4-OI-D', 'order_id', 'P4-OD-4', 'sku', 'P4-A', 'quantity', 1,
      'order_date', yday, 'location_id', loc_blr, 'status', 'APPROVED', 'dispatch_by', ago2),
    jsonb_build_object('order_item_id', 'P4-OI-E', 'order_id', 'P4-OD-5', 'sku', 'P4-A', 'quantity', 1,
      'order_date', ago2, 'location_id', loc_blr, 'status', 'APPROVED', 'hold', true, 'dispatch_by', soon),
    jsonb_build_object('order_item_id', '', 'order_id', 'P4-OD-6', 'sku', 'P4-A'),
    jsonb_build_object('order_item_id', 'P4-OI-J', 'order_id', 'P4-OD-11', 'sku', 'P4-A', 'quantity', 1,
      'order_date', yday, 'location_id', loc_blr, 'status', 'APPROVED', 'dispatch_by', ago30m),
    jsonb_build_object('order_item_id', 'P4-OI-F', 'order_id', 'P4-OD-7', 'sku', 'P4-A', 'location_id', 'LOCunknown', 'status', 'APPROVED', 'dispatch_by', later),
    -- K: Bangalore, dispatch-after and dispatch-by 10 days away (Upcoming). P: Under Processing, due in 2 hours.
    jsonb_build_object('order_item_id', 'P4-OI-K', 'order_id', 'P4-OD-12', 'sku', 'P4-A', 'location_id', loc_blr, 'status', 'APPROVED',
      'dispatch_after', to_char(now() + interval '9 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'dispatch_by', to_char(now() + interval '10 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
    jsonb_build_object('order_item_id', 'P4-OI-P', 'order_id', 'P4-OD-13', 'sku', 'P4-A', 'location_id', loc_blr, 'status', 'PACKING_IN_PROGRESS', 'dispatch_by', soon, 'dispatch_after', ago2)
  ), null, 'next-page-address', 10);
  assert (res ->> 'saved')::int = 9, 'nine orders saved; the one with no order item ID is skipped';
  assert (select step from public.order_runs where id = run1) = 0, 'with a next page the run stays on the same part';
  assert (select next_path from public.order_runs where id = run1) = 'next-page-address', 'and remembers the next page';

  blocked := false;
  begin
    perform public.orders_apply_page(run1, 3, '[]'::jsonb, null, null, 0);
  exception when others then blocked := true;
  end;
  assert blocked, 'saving a page for the wrong part of the plan is refused';

  select * into strict o from public.fk_order_items where order_item_id = 'P4-OI-A';
  assert o.stage = 'pending' and o.warehouse_id = w_blr and o.quantity = 2 and o.order_day = today, 'order A saved with its warehouse and day';
  assert (select warehouse_id from public.fk_order_items where order_item_id = 'P4-OI-F') is null, 'an unknown location leaves the warehouse empty';

  -- finish the other four states with nothing in them
  perform public.orders_apply_page(run1, 0, '[]'::jsonb, null, null, 0);
  for n in 1..(v_parts - 2) loop perform public.orders_apply_page(run1, n, '[]'::jsonb, null, null, 0); end loop;
  res := public.orders_run_finish(run1);
  assert not (res ->> 'ok')::boolean and (select status from public.order_runs where id = run1) = 'failed',
    'a run that has not read every part must fail, not count as a full sweep';

  update public.order_runs set status = 'running', error = null, finished_at = null where id = run1;
  perform public.orders_apply_page(run1, v_parts - 1, '[]'::jsonb, null, null, 0);
  res := public.orders_run_finish(run1);
  assert (res ->> 'ok')::boolean, 'a run that read everything finishes';

  -- alerts
  assert (res ->> 'alerted')::int = 2, 'two orders need an alert: A (due in 2 hours) and J (30 minutes late); B is far away, E is on hold, P is Under Processing';
  assert (select alerted_at from public.fk_order_items where order_item_id = 'P4-OI-P') is null, 'Under Processing is never alerted';
  select count(*) into n from public.notifications where kind = 'dispatch_risk';
  assert n = v_staff + 3, 'every active owner and admin is told (the three test ones and any real ones), nobody else';
  assert not exists (select 1 from public.notifications where kind = 'dispatch_risk' and user_id = u_blr), 'a warehouse user gets no dispatch alert';
  assert (select title from public.notifications where kind = 'dispatch_risk' and user_id = u_own) like '2 orders%', 'the alert says how many';
  assert (select body from public.notifications where kind = 'dispatch_risk' and user_id = u_own) like 'Bangalore 2%', 'and where';
  assert (select alerted_at from public.fk_order_items where order_item_id = 'P4-OI-A') is not null, 'order A is marked alerted';
  assert (select alerted_at from public.fk_order_items where order_item_id = 'P4-OI-C') is not null, 'an order first seen long overdue is marked without an alert';
  assert (select alerted_at from public.fk_order_items where order_item_id = 'P4-OI-D') is not null, 'an order more than an hour late is marked without an alert';
  assert (select alerted_at from public.fk_order_items where order_item_id = 'P4-OI-J') is not null, 'an order that has only just missed its deadline is alerted';
  assert (select alerted_at from public.fk_order_items where order_item_id = 'P4-OI-B') is null, 'order B is not at risk yet';
  assert (select alerted_at from public.fk_order_items where order_item_id = 'P4-OI-E') is null, 'an order on hold is not alerted';

  -- A second sweep does not repeat the alert, and an order whose deadline comes closer is alerted once
  update public.fk_order_items set dispatch_by = now() + interval '3 hours' where order_item_id = 'P4-OI-B';
  run2 := private.start_order_run('pending', 'cron', null);
  assert run2 <> run1, 'a finished run does not block the next one';
  update public.order_runs set status = 'running', lease_until = now() + interval '1 minute' where id = run2;
  perform public.orders_apply_page(run2, 0, jsonb_build_array(
    jsonb_build_object('order_item_id', 'P4-OI-A', 'order_id', 'P4-OD-1', 'sku', 'P4-A', 'quantity', 2, 'location_id', loc_blr, 'status', 'PACKED', 'dispatch_by', soon),
    jsonb_build_object('order_item_id', 'P4-OI-B', 'order_id', 'P4-OD-2', 'sku', 'P4-A', 'quantity', 1, 'location_id', loc_del, 'status', 'APPROVED'),
    jsonb_build_object('order_item_id', 'P4-OI-G', 'order_id', 'P4-OD-8', 'sku', 'P4-A', 'quantity', 4, 'location_id', loc_del, 'status', 'APPROVED', 'dispatch_by', later)
  ), null, null, 3);
  for n in 1..(v_parts - 1) loop perform public.orders_apply_page(run2, n, '[]'::jsonb, null, null, 0); end loop;
  res := public.orders_run_finish(run2);
  assert (res ->> 'alerted')::int = 1, 'only order B is newly at risk; A is not alerted twice';
  select count(*) into n from public.notifications where kind = 'dispatch_risk';
  assert n = 2 * (v_staff + 3), 'one more alert per owner and admin, not a repeat of the first';
  assert (select stage from public.fk_order_items where order_item_id = 'P4-OI-A') = 'pending'
     and (select item_status from public.fk_order_items where order_item_id = 'P4-OI-A') = 'PACKED', 'an order''s status is updated in place';
  assert (select stage from public.fk_order_items where order_item_id = 'P4-OI-C') = 'left_pending', 'orders no longer listed as pending are marked left_pending';
  assert (res ->> 'left_pending')::int = 5, 'C, D, E, J and P left the pending list';
  assert (select stage from public.fk_order_items where order_item_id = 'P4-OI-K') = 'pending',
    'an order due later than the sweep looked (10 days) is still Upcoming, not gone';
  assert (select stage from public.fk_order_items where order_item_id = 'P4-OI-F') = 'pending',
    'an order at a warehouse the sweep did not read is not marked gone';

  -- ===== Shipped and cancelled orders ==================================================================
  run3 := private.start_order_run('daily', 'cron', null);
  update public.order_runs set status = 'running', lease_until = now() + interval '1 minute' where id = run3;
  for n in 0..2 loop perform public.orders_apply_page(run3, n, '[]'::jsonb, null, null, 0); end loop;
  perform public.orders_apply_page(run3, 3, jsonb_build_array(
    jsonb_build_object('order_item_id', 'P4-OI-C', 'order_id', 'P4-OD-3', 'sku', 'P4-A', 'quantity', 1, 'location_id', loc_blr, 'status', 'DELIVERED', 'dispatch_by', ago9),
    jsonb_build_object('order_item_id', 'P4-OI-H', 'order_id', 'P4-OD-9', 'sku', 'P4-A', 'quantity', 5, 'order_date', to_char(now() - interval '3 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'location_id', loc_del, 'status', 'SHIPPED')
  ), null, null, 2);
  assert (select stage from public.fk_order_items where order_item_id = 'P4-OI-C') = 'dispatched', 'a shipped order becomes dispatched';
  -- cancelled shipments carry no location: the warehouse we already know is kept
  perform public.orders_apply_page(run3, 4, jsonb_build_array(
    jsonb_build_object('order_item_id', 'P4-OI-D', 'order_id', 'P4-OD-4', 'sku', 'P4-A', 'quantity', 1, 'status', 'CANCELLED',
      'cancelled_at', ago2, 'cancel_reason', 'seller_cancellation', 'cancel_sub_reason', 'order_over_sla')
  ), null, null, 1);
  select * into strict o from public.fk_order_items where order_item_id = 'P4-OI-D';
  assert o.stage = 'cancelled' and o.cancel_type = 'seller' and o.warehouse_id = w_blr and o.cancel_reason = 'seller_cancellation',
    'a seller cancellation is saved as seller and keeps the warehouse we knew';
  perform public.orders_apply_page(run3, 5, jsonb_build_array(
    jsonb_build_object('order_item_id', 'P4-OI-X', 'order_id', 'P4-OD-10', 'sku', 'P4-A', 'quantity', 1, 'status', 'CANCELLED',
      'cancelled_at', ago2, 'cancel_reason', 'buyer_cancellation')
  ), null, null, 1);
  assert (select cancel_type from public.fk_order_items where order_item_id = 'P4-OI-X') = 'buyer', 'a buyer cancellation is saved as buyer';

  -- returns: the SKU is found from the order; one for an unknown order stays empty
  perform public.orders_apply_page(run3, 6, '[]'::jsonb, jsonb_build_array(
    jsonb_build_object('return_id', 'P4-R1', 'order_item_id', 'P4-OI-C', 'order_id', 'P4-OD-3', 'quantity', 1, 'location_id', loc_blr,
      'status', 'created', 'reason', 'WRONG_ITEM', 'sub_reason', 'x', 'created_at', ago2),
    jsonb_build_object('return_id', 'P4-R2', 'order_item_id', 'P4-OI-UNKNOWN', 'order_id', 'P4-OD-99', 'quantity', 1, 'location_id', loc_del,
      'status', 'completed', 'reason', 'DAMAGED', 'created_at', ago2)
  ), null, 2);
  perform public.orders_apply_page(run3, 7, '[]'::jsonb, jsonb_build_array(
    jsonb_build_object('return_id', 'P4-R3', 'order_item_id', 'P4-OI-H', 'order_id', 'P4-OD-9', 'quantity', 1, 'location_id', loc_del,
      'status', 'created', 'reason', 'NOT_NEEDED', 'created_at', ago2)
  ), null, 1);
  assert (select source from public.fk_returns where return_id = 'P4-R1') = 'courier_return', 'the return kind comes from the part of the plan';
  assert (select source from public.fk_returns where return_id = 'P4-R3') = 'customer_return', 'customer returns are told apart';
  assert (select sku from public.fk_returns where return_id = 'P4-R1') = 'P4-A', 'a return finds its SKU from the order';
  assert (select sku from public.fk_returns where return_id = 'P4-R2') is null, 'a return for an order older than our history has no SKU';
  res := public.orders_run_finish(run3);
  assert (res ->> 'ok')::boolean, 'the daily run finishes';

  -- ===== Rates ========================================================================================
  -- Fake history: 7 days of 3 units a day at Bangalore, SKU P4-A (the shipped orders above are 'today' or 3 days ago)
  delete from public.fk_order_items where order_item_id like 'P4-OI-%';
  delete from public.fk_returns where return_id like 'P4-R%';
  insert into public.fk_order_items (order_item_id, order_id, sku, quantity, order_date, order_day, warehouse_id, stage)
  select 'P4-S' || i, 'P4-SO' || i, 'P4-A', 3, now() - (i || ' days')::interval, today - i, w_blr, 'dispatched'
  from generate_series(1, 7) i;
  insert into public.fk_order_items (order_item_id, order_id, sku, quantity, order_date, order_day, warehouse_id, stage)
  values ('P4-S20', 'P4-SO20', 'P4-A', 100, now() - interval '2 days', today - 2, w_blr, 'cancelled'),
         ('P4-S21', 'P4-SO21', 'P4-A', 100, now(), today, w_blr, 'dispatched');
  select public.flipkart_sales_rates() into res;
  assert (select (x ->> 'u7')::int from jsonb_array_elements(res -> 'rows') x where x ->> 'sku' = 'P4-A' and x ->> 'wid' = w_blr::text) = 21,
    'units in the last 7 whole days: cancelled orders and today are left out';
  assert (select (x ->> 'u14')::int from jsonb_array_elements(res -> 'rows') x where x ->> 'sku' = 'P4-A' and x ->> 'wid' = w_blr::text) = 21,
    '14-day units';

  insert into public.fk_returns (return_id, order_item_id, source, sku, quantity, created_date)
  values ('P4-R10', 'P4-S1', 'customer_return', 'P4-A', 2, today - 1), ('P4-R11', 'P4-S2', 'courier_return', 'P4-A', 1, today - 5),
         ('P4-R12', 'P4-S3', 'customer_return', 'P4-A', 9, today - 40);
  select public.flipkart_return_rates(30) into res;
  assert (select (x ->> 'returned')::int from jsonb_array_elements(res) x where x ->> 'sku' = 'P4-A') = 3, 'returns count by creation day inside 30 days';
  assert (select (x ->> 'sold')::int from jsonb_array_elements(res) x where x ->> 'sku' = 'P4-A') = 121,
    'sold counts shipped orders in 30 days (21 + today''s 100), not the cancelled one';

  -- stock drops: 100 -> 90 -> 70 -> 100 (restock, ignored) -> 80 over four days at Bangalore
  delete from public.stock_levels where sku = 'P4-A';
  insert into public.stock_levels (snapshot_date, sku, warehouse_id, inventory) values
    (today - 4, 'P4-A', w_blr, 100), (today - 3, 'P4-A', w_blr, 90), (today - 2, 'P4-A', w_blr, 70),
    (today - 1, 'P4-A', w_blr, 100), (today, 'P4-A', w_blr, 80);
  select public.flipkart_stock_drops() into res;
  assert (res ->> 'first_snapshot')::date = today - 4, 'the first snapshot date is reported';
  assert (select (x ->> 'lost7')::int from jsonb_array_elements(res -> 'rows') x where x ->> 'sku' = 'P4-A') = 10 + 20 + 20, 'units lost: the restock day is left out';
  assert (select (x ->> 'days7')::int from jsonb_array_elements(res -> 'rows') x where x ->> 'sku' = 'P4-A') = 3, 'and so are its days';

  -- ===== Who sees what ==================================================================================
  delete from public.fk_order_items where order_item_id like 'P4-S%';
  insert into public.fk_order_items (order_item_id, order_id, sku, quantity, order_date, order_day, warehouse_id, stage, dispatch_by) values
    ('P4-V1', 'P4-VO1', 'P4-A', 1, now(), today, w_blr, 'pending', now() + interval '5 hours'),
    ('P4-V2', 'P4-VO2', 'P4-A', 1, now(), today, w_del, 'pending', now() + interval '5 hours'),
    ('P4-V3', 'P4-VO3', 'P4-A', 1, now(), today, null, 'pending', now() + interval '5 hours');
  insert into public.fk_returns (return_id, order_item_id, source, sku, warehouse_id, created_date) values
    ('P4-VR1', 'P4-V1', 'customer_return', 'P4-A', w_blr, today), ('P4-VR2', 'P4-V2', 'customer_return', 'P4-A', w_del, today);

  perform set_config('request.jwt.claims', json_build_object('sub', u_blr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.fk_order_items where order_item_id like 'P4-V%';
  assert n = 1, 'a Bangalore warehouse user sees only Bangalore orders (not Delhi, not unknown-warehouse ones)';
  select count(*) into n from public.fk_returns where return_id like 'P4-VR%';
  assert n = 1, 'and only Bangalore returns';
  select count(*) into n from public.price_changes;
  assert n = 0, 'a warehouse user sees no price changes';
  select count(*) into n from public.stock_prices;
  assert n = 0, 'a warehouse user sees no prices history';
  res := public.flipkart_sales_rates();
  assert true, 'the rate functions run for a warehouse user';
  blocked := false;
  begin
    update public.fk_order_items set quantity = 999;
    get diagnostics n = row_count;
    blocked := (n = 0);
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'nobody can change orders from the app';
  blocked := false;
  begin
    perform public.orders_apply_page(run3, 0, '[]'::jsonb, null, null, 0);
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'saving a page is for the service role only';
  blocked := false;
  begin
    perform public.request_orders_sync('pending');
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'a warehouse user cannot start an order sync';
  blocked := false;
  begin
    perform next_path from public.order_runs limit 1;
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'Flipkart''s page addresses are not readable from the app';
  perform id, kind, status, error from public.order_runs limit 1;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', u_lst, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.fk_order_items where order_item_id like 'P4-V%';
  assert n = 3, 'an admin sees every order';
  select count(*) into n from public.price_changes;
  assert n >= 1, 'an admin sees price changes';
  perform public.request_orders_sync('pending');
  reset role;

  update public.order_runs set status = 'done', finished_at = now() where status in ('queued', 'running', 'paused');
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  run1 := public.request_orders_sync('pending');
  run2 := public.request_orders_sync('pending');
  reset role;
  assert run1 = run2, 'asking twice reuses the run';
  assert (select requested_by from public.order_runs where id = run1) = u_mgr, 'the run records who asked';

  -- ===== A manual run pauses the backfill; the watchdog keeps it asleep by day ============================
  update public.order_runs set status = 'done', finished_at = now() where status in ('queued', 'running', 'paused');
  run1 := private.start_order_backfill();
  assert run1 is not null and (select status from public.order_runs where id = run1) = 'paused', 'the backfill is created asleep, the worker wakes it at night';
  assert private.start_order_backfill() = run1, 'asking again returns the same backfill';
  update public.order_runs set status = 'running', lease_until = now() + interval '1 minute' where id = run1;
  run2 := private.start_order_run('pending', 'manual', u_mgr);
  assert (select status from public.order_runs where id = run1) = 'paused', 'a manual run pauses a running backfill';
  assert run2 <> run1, 'and gets its own run';
  update public.order_runs set status = 'done', finished_at = now() where id in (run2);
  update public.order_runs set status = 'done', finished_at = now(), coverage_from = today - 20 where id = run1;
  assert private.start_order_backfill() is null, 'once the backfill is done it never starts again';

  -- ===== The watchdog ====================================================================================================
  update public.order_runs set status = 'done', finished_at = now() where status in ('queued', 'running', 'paused');
  insert into public.order_runs (kind, trigger, plan, status, updated_at, attempts) values ('daily', 'cron', private.order_plan('daily'), 'running', now() - interval '10 minutes', 2)
    returning id into run1;
  perform private.resume_stalled_orders();
  assert (select attempts from public.order_runs where id = run1) = 3, 'a silent run is restarted and the attempt counted';
  update public.order_runs set updated_at = now() - interval '10 minutes', attempts = 8 where id = run1;
  perform private.resume_stalled_orders();
  assert (select status from public.order_runs where id = run1) = 'failed', 'a run interrupted too often is given up on';
  insert into public.order_runs (kind, trigger, plan, status, updated_at, lease_until, attempts) values ('daily', 'cron', private.order_plan('daily'), 'running', now() - interval '10 minutes', now() + interval '1 minute', 0)
    returning id into run1;
  perform private.resume_stalled_orders();
  assert (select attempts from public.order_runs where id = run1) = 0, 'a run with a live worker is left alone';
  update public.order_runs set status = 'done', finished_at = now() where id = run1;

  -- a stock sync that is working holds the order runs back
  insert into public.order_runs (kind, trigger, plan, status, updated_at, attempts) values ('pending', 'cron', private.order_plan('pending'), 'queued', now() - interval '10 minutes', 0)
    returning id into run1;
  insert into public.stock_runs (trigger, status, updated_at) values ('manual', 'running', now());
  assert public.orders_other_sync_active(run1), 'a running stock sync is noticed';
  perform private.resume_stalled_orders();
  assert (select attempts from public.order_runs where id = run1) = 0, 'the watchdog does not restart an order run while a stock sync is working';
  delete from public.stock_runs where status = 'running';
  assert not public.orders_other_sync_active(run1), 'and lets go when it is over';
  update public.order_runs set status = 'done', finished_at = now() where id = run1;

  -- the backfill sleeps by day: the watchdog only wakes it inside the night window
  insert into public.order_runs (kind, trigger, plan, status, updated_at, attempts) values ('backfill', 'cron', private.order_plan('backfill'), 'paused', now() - interval '10 minutes', 0)
    returning id into run1;
  perform private.resume_stalled_orders();
  assert (select attempts from public.order_runs where id = run1) = (case when private.is_night_ist() then 1 else 0 end),
    'a paused backfill is only woken inside the nightly window (22:15 to 06:45 IST)';

  -- ===== The schedule ====================================================================================================
  select count(*) into n from cron.job where jobname = 'orders-pending-a' and schedule = '30 1-16 * * *' and active;
  assert n = 1, 'pending orders are read at :30 UTC from 01:30 to 16:30 (07:00 to 22:00 IST)';
  select count(*) into n from cron.job where jobname = 'orders-pending-b' and schedule = '0 2-16 * * *' and active;
  assert n = 1, 'and at :00 UTC from 02:00 to 16:00 (07:30 to 21:30 IST): every 30 minutes, 7 AM to 10 PM';
  select count(*) into n from cron.job where jobname = 'orders-daily' and schedule = '40 3 * * *' and active;
  assert n = 1, 'the daily read is at 03:40 UTC (09:10 IST), after the 08:00 stock sync';
  select count(*) into n from cron.job where jobname = 'orders-backfill' and schedule = '45 16 * * *' and active;
  assert n = 1, 'the backfill is offered every night at 16:45 UTC (22:15 IST)';
  select count(*) into n from cron.job where jobname = 'orders-watchdog' and active;
  assert n = 1, 'the watchdog is scheduled';
end $$;

select 'All Phase 4 checks passed' as result;

rollback;
