-- Phase 4 speed-up check: the database counts, groups and pages the orders (instead of the app receiving every line).
-- Seller Hub's tabs, shipments counted once, late only for Active orders not on hold, pick list, upcoming vs stock,
-- cancellations, paging and search, and that a warehouse user only gets their own warehouse.
--
-- Runs in one transaction that is rolled back. It clears the order tables inside that transaction only.
--
--   psql "$DATABASE_URL" -f supabase/tests/phase4_orders_rpcs_check.sql

begin;

do $$
declare
  u_own uuid := gen_random_uuid();
  u_blr uuid := gen_random_uuid();
  w_blr uuid;
  w_del uuid;
  today date := (now() at time zone 'Asia/Kolkata')::date;
  tomorrow_noon timestamptz := ((today + 1)::timestamp + time '12:00') at time zone 'Asia/Kolkata';
  srun uuid;
  res jsonb;
  c jsonb;
  n int;
begin
  select id into strict w_blr from public.warehouses where name = 'Bangalore';
  select id into strict w_del from public.warehouses where name = 'Delhi';

  insert into auth.users (id, instance_id, aud, role, email) values
    (u_own, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p4r-own@example.test'),
    (u_blr, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p4r-blr@example.test');
  insert into public.profiles (id, name, role, active) values (u_own, 'P4R Owner', 'owner', true), (u_blr, 'P4R Bangalore', 'warehouse', true)
  on conflict (id) do update set name = excluded.name, role = excluded.role, active = excluded.active;
  insert into public.user_warehouses values (u_blr, w_blr);

  delete from public.fk_order_items;
  delete from public.fk_returns;
  delete from public.stock_runs;

  -- A finished stock sync with stock for a few SKUs.
  insert into public.stock_runs (trigger) values ('manual') returning id into srun;
  perform public.stock_run_begin(srun, array['R-A', 'R-B', 'R-C']);
  perform public.stock_apply_batch(srun, jsonb_build_array(
    jsonb_build_object('sku', 'R-A', 'title', 'Steel bottle', 'status', 'ACTIVE', 'locations', jsonb_build_array(
      jsonb_build_object('id', (select flipkart_location_id from public.warehouses where id = w_blr), 'status', 'ACTIVE', 'inventory', 1),
      jsonb_build_object('id', (select flipkart_location_id from public.warehouses where id = w_del), 'status', 'ACTIVE', 'inventory', 0))),
    jsonb_build_object('sku', 'R-B', 'title', 'Brush', 'status', 'ACTIVE', 'locations', jsonb_build_array(
      jsonb_build_object('id', (select flipkart_location_id from public.warehouses where id = w_blr), 'status', 'ACTIVE', 'inventory', 50))),
    jsonb_build_object('sku', 'R-C', 'title', 'Cup', 'status', 'ACTIVE', 'locations', jsonb_build_array(
      jsonb_build_object('id', (select flipkart_location_id from public.warehouses where id = w_del), 'status', 'ACTIVE', 'inventory', 2)))), 3, 0, 0);
  perform public.stock_run_finish(srun);
  assert public.flipkart_snapshot_date() = today, 'the latest good snapshot is today';

  -- Bangalore: S1 holds two items (one shipment), S2 is late, S5 is under processing, S6 is on hold, S8 is due in 3 days.
  -- Delhi: S3 is due tomorrow, S4 is upcoming (dispatch-after in 3 days).
  insert into public.fk_order_items (order_item_id, order_id, shipment_id, sku, quantity, warehouse_id, stage, item_status, hold, dispatch_by, dispatch_after, order_date, order_day) values
    ('R-I1', 'R-O1', 'R-S1', 'R-A', 2, w_blr, 'pending', 'APPROVED', false, now() - interval '5 minutes', now() - interval '1 day', now(), today),
    ('R-I2', 'R-O1', 'R-S1', 'R-B', 1, w_blr, 'pending', 'APPROVED', false, now() - interval '5 minutes', now() - interval '1 day', now(), today),
    ('R-I3', 'R-O2', 'R-S2', 'R-A', 1, w_blr, 'pending', 'PACKED', false, now() - interval '1 hour', now() - interval '1 day', now(), today),
    ('R-I4', 'R-O3', 'R-S3', 'R-A', 1, w_del, 'pending', 'READY_TO_DISPATCH', false, tomorrow_noon, now() - interval '1 day', now(), today),
    ('R-I5', 'R-O4', 'R-S4', 'R-C', 5, w_del, 'pending', 'APPROVED', false, now() + interval '4 days', now() + interval '3 days', now(), today),
    ('R-I6', 'R-O5', 'R-S5', 'R-A', 1, w_blr, 'pending', 'PACKING_IN_PROGRESS', false, now() - interval '9 hours', now() - interval '1 day', now(), today),
    ('R-I7', 'R-O6', 'R-S6', 'R-A', 1, w_blr, 'pending', 'APPROVED', true, now() - interval '2 hours', now() - interval '1 day', now(), today),
    ('R-I8', 'R-O7', 'R-S8', 'R-A', 3, w_blr, 'pending', 'APPROVED', false, now() + interval '3 days', now() - interval '1 day', now(), today),
    ('R-I9', 'R-O8', 'R-S9', 'R-A', 1, w_blr, 'pending', 'CANCELLED', false, now(), now(), now(), today),
    ('R-X1', 'R-O9', 'R-S10', 'R-A', 1, w_blr, 'cancelled', 'CANCELLED', false, now(), now(), now(), today),
    ('R-X2', 'R-O10', 'R-S11', 'R-B', 1, w_del, 'cancelled', 'CANCELLED', false, now(), now(), now(), today);
  update public.fk_order_items set cancel_type = 'seller', cancelled_at = now(), cancel_reason = 'seller_cancellation' where order_item_id = 'R-X1';
  update public.fk_order_items set cancel_type = 'buyer', cancelled_at = now() - interval '2 days', cancel_reason = 'buyer_cancellation' where order_item_id = 'R-X2';

  insert into public.fk_returns (return_id, order_item_id, source, sku, quantity, warehouse_id, created_date, reason) values
    ('R-RT1', 'R-I1', 'customer_return', 'R-A', 2, w_blr, today, 'WRONG_ITEM'),
    ('R-RT2', 'R-I4', 'courier_return', 'R-A', 1, w_del, today - 40, 'RTO'),
    ('R-RT3', 'R-I4', 'courier_return', 'R-A', 1, w_del, today, 'RTO');

  perform set_config('request.jwt.claims', json_build_object('sub', u_own, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- ===== the cards =====
  res := public.flipkart_order_counts();
  select x into c from jsonb_array_elements(res) x where (x ->> 'warehouse_id') = w_blr::text;
  assert (c ->> 'to_accept')::int = 3 and (c ->> 'to_pack')::int = 1 and (c ->> 'processing')::int = 1 and (c ->> 'upcoming')::int = 0,
    'Bangalore: S1 (two items, counted once), S6 and S8 are To Accept; S2 To Pack; S5 Under Processing; the cancelled item in a pending shipment is in no tab';
  assert (c ->> 'active')::int = 4, 'Active = S1, S2, S6, S8';
  assert (c ->> 'held')::int = 1, 'S6 is on hold';
  assert (c ->> 'late')::int = 2, 'late: S1 and S2. Not S6 (on hold) and not S5 (Under Processing)';
  assert (c ->> 'today')::int = 0 and (c ->> 'tomorrow')::int = 0, 'nothing else is due today or tomorrow in Bangalore';
  select x into c from jsonb_array_elements(res) x where (x ->> 'warehouse_id') = w_del::text;
  assert (c ->> 'to_dispatch')::int = 1 and (c ->> 'upcoming')::int = 1 and (c ->> 'active')::int = 1, 'Delhi: S3 To Dispatch, S4 Upcoming (dispatch-after in the future)';
  assert (c ->> 'tomorrow')::int = 1 and (c ->> 'late')::int = 0, 'S3 is due tomorrow; Upcoming S4 is never late';

  -- ===== one row per SKU =====
  res := public.flipkart_order_skus(null, 'active', null, 'due', 'asc', 50, 0);
  assert (res ->> 'total')::int = 2, 'two SKUs have Active orders: R-A and R-B (R-C is only upcoming)';
  assert (res -> 'rows' -> 0 ->> 'sku') = 'R-A', 'the SKU with the earliest Active deadline first';
  select x into c from jsonb_array_elements(res -> 'rows') x where x ->> 'sku' = 'R-A';
  assert (c ->> 'orders')::int = 5, 'R-A: shipments S1, S2, S3, S6, S8';
  assert (c ->> 'units')::int = 8, 'R-A units: 2 + 1 + 1 + 1 + 3';
  assert (c -> 'by_wh' ->> w_blr::text)::int = 7 and (c -> 'by_wh' ->> w_del::text)::int = 1, 'units per warehouse';
  assert c ->> 'title' = 'Steel bottle', 'the title comes with the row';
  assert (c ->> 'to_accept')::int = 3 and (c ->> 'to_pack')::int = 1 and (c ->> 'to_dispatch')::int = 1, 'counts per tab';
  assert (c ->> 'active_due')::timestamptz < now(), 'the earliest Active deadline is the late one';

  res := public.flipkart_order_skus(w_blr, 'processing', null, 'due', 'asc', 50, 0);
  assert (res ->> 'total')::int = 1 and (res -> 'rows' -> 0 ->> 'sku') = 'R-A', 'the Under Processing tab at Bangalore has only R-A';
  res := public.flipkart_order_skus(w_del, 'upcoming', null, 'due', 'asc', 50, 0);
  assert (res -> 'rows' -> 0 ->> 'sku') = 'R-C' and (res -> 'rows' -> 0 ->> 'units')::int = 5, 'the Upcoming tab at Delhi has R-C';
  res := public.flipkart_order_skus(null, 'active', 'brush', 'due', 'asc', 50, 0);
  assert (res ->> 'total')::int = 1 and (res -> 'rows' -> 0 ->> 'sku') = 'R-B', 'search finds a SKU by part of its title';
  res := public.flipkart_order_skus(null, 'active', 'R-O2', 'due', 'asc', 50, 0);
  assert (res ->> 'total')::int = 1, 'search finds a SKU by one of its order IDs';
  res := public.flipkart_order_skus(null, 'active', '%', 'due', 'asc', 50, 0);
  assert (res ->> 'total')::int = 0, 'a percent sign is searched for, not treated as "anything"';
  res := public.flipkart_order_skus(null, 'active', null, 'units', 'desc', 1, 0);
  assert jsonb_array_length(res -> 'rows') = 1 and (res ->> 'total')::int = 2 and (res -> 'rows' -> 0 ->> 'sku') = 'R-A', 'a page of one, most units first, with the total of all';
  res := public.flipkart_order_skus(null, 'active', null, 'units', 'desc', 1, 1);
  assert (res -> 'rows' -> 0 ->> 'sku') = 'R-B', 'the second page';
  res := public.flipkart_order_skus(null, 'active', null, 'not_a_column; drop table x', 'sideways', 50, -5);
  assert (res ->> 'total')::int = 2, 'an odd sort word falls back to the normal order instead of reaching the SQL';

  -- ===== order lines =====
  res := public.flipkart_order_lines(w_blr, 'active', null, null, 'due', 'asc', 50, 0);
  assert (res ->> 'total')::int = 5, 'order lines at Bangalore: I1, I2, I3, I7, I8';
  assert (res -> 'rows' -> 0 ->> 'order_item_id') = 'R-I7', 'earliest dispatch-by first (the one on hold, due 2 hours ago, is still a line in the list)';
  res := public.flipkart_order_lines(null, 'active', 'R-A', null, 'due', 'asc', 100, 0);
  assert (res ->> 'total')::int = 5 and (res -> 'rows' -> 0 ->> 'bucket') is not null, 'the lines of one SKU, each with its tab';
  res := public.flipkart_order_lines(null, 'active', null, null, 'due', 'asc', 2, 4);
  assert jsonb_array_length(res -> 'rows') = 2 and (res ->> 'total')::int = 6, 'paging: lines 5 and 6 of 6 Active order lines';

  -- ===== pick list =====
  res := public.flipkart_pick_list(w_blr, true, null, 'units', 'desc', 50, 0);
  assert (res ->> 'total')::int = 2 and (res ->> 'units')::int = 4, 'due today or late at Bangalore: R-A 2 + 1 = 3 units, R-B 1 unit (not the one on hold, not the one due in 3 days)';
  assert (res -> 'rows' -> 0 ->> 'sku') = 'R-A' and (res -> 'rows' -> 0 ->> 'units')::int = 3, 'R-A first';
  assert (res -> 'rows' -> 0 ->> 'stock')::int = 1, 'with the stock at Bangalore (1: short)';
  assert (res -> 'rows' -> 0 ->> 'to_accept')::int = 2 and (res -> 'rows' -> 0 ->> 'to_pack')::int = 1, 'units still To Accept and To Pack';
  res := public.flipkart_pick_list(w_blr, false, null, 'units', 'desc', 50, 0);
  assert (res ->> 'units')::int = 7, 'all Active orders: 3 + 3 more of R-A (due in 3 days) + 1 of R-B';
  res := public.flipkart_pick_list(w_del, false, null, 'units', 'desc', 50, 0);
  assert (res ->> 'total')::int = 0, 'Delhi has nothing left to pack (S3 is To Dispatch, S4 is Upcoming)';

  -- ===== upcoming vs stock =====
  res := public.flipkart_upcoming_vs_stock(null, false, null, 'short', 'desc', 50, 0);
  assert (res ->> 'total')::int = 1 and (res -> 'rows' -> 0 ->> 'sku') = 'R-C', 'one upcoming SKU at a warehouse';
  assert (res -> 'rows' -> 0 ->> 'upcoming')::int = 5 and (res -> 'rows' -> 0 ->> 'stock')::int = 2 and (res -> 'rows' -> 0 ->> 'short')::int = 3, '5 upcoming against 2 in stock: short by 3';
  assert (res ->> 'short_count')::int = 1, 'one SKU is short';
  res := public.flipkart_upcoming_vs_stock(w_blr, false, null, 'short', 'desc', 50, 0);
  assert (res ->> 'total')::int = 0, 'nothing upcoming at Bangalore';

  -- ===== cancellations =====
  res := public.flipkart_cancel_summary(null);
  assert (res ->> 'seller_total')::int = 1 and (res ->> 'buyer_total')::int = 1, 'one seller and one buyer cancellation';
  assert jsonb_array_length(res -> 'days') = 14, 'fourteen days of counts';
  assert (res -> 'days' -> 0 ->> 'day')::date = today and (res -> 'days' -> 0 ->> 'seller')::int = 1, 'today has the seller cancellation, newest day first';
  res := public.flipkart_cancel_lines(null, 'buyer', null, 'date', 'desc', 50, 0);
  assert (res ->> 'total')::int = 1 and (res -> 'rows' -> 0 ->> 'order_id') = 'R-O10', 'only buyer cancellations when asked';
  res := public.flipkart_cancel_lines(w_blr, null, null, 'date', 'desc', 50, 0);
  assert (res ->> 'total')::int = 1, 'Bangalore has one cancellation';

  -- ===== returns, a page at a time =====
  res := public.flipkart_returns_summary(null);
  assert (res ->> 'customer_units')::int = 2 and (res ->> 'courier_units')::int = 1 and (res ->> 'courier_lines')::int = 1, 'the 30-day totals leave out the return from 40 days ago';
  res := public.flipkart_returns_page(null, null, null, 'date', 'desc', 50, 0);
  assert (res ->> 'total')::int = 2, 'two returns in the last 30 days';
  res := public.flipkart_returns_page(null, 'courier_return', null, 'date', 'desc', 50, 0);
  assert (res ->> 'total')::int = 1 and (res -> 'rows' -> 0 ->> 'return_id') = 'R-RT3', 'the courier filter';
  res := public.flipkart_returns_page(w_blr, null, 'wrong', 'qty', 'desc', 1, 0);
  assert (res ->> 'total')::int = 1 and (res -> 'rows' -> 0 ->> 'quantity')::int = 2, 'a warehouse, a search on the reason, a page of one';
  res := public.flipkart_returns_page(null, null, 'x', 'bad; sort', 'sideways', 50, -3);
  assert (res ->> 'total')::int = 0, 'an odd sort word is ignored, a search with no match finds nothing';

  -- ===== Needs action helpers =====
  res := public.flipkart_empty_with_orders();
  -- R-A has 0 units at Delhi, but its only Delhi order (S3) is To Dispatch: already packed, so nothing is waiting to be packed there.
  assert jsonb_array_length(res) = 0, 'Delhi R-A is empty but its order is already To Dispatch: not "waiting to be packed"';
  reset role;
  update public.fk_order_items set item_status = 'APPROVED' where order_item_id = 'R-I4';
  perform set_config('request.jwt.claims', json_build_object('sub', u_own, 'role', 'authenticated')::text, true);
  set local role authenticated;
  res := public.flipkart_empty_with_orders();
  assert jsonb_array_length(res) = 1 and (res -> 0 ->> 'sku') = 'R-A' and (res -> 0 ->> 'warehouse_id') = w_del::text, 'once it is To Accept, R-A is empty at Delhi with an order waiting';
  res := public.flipkart_stock_units();
  select count(*) into n from jsonb_array_elements(res) x where (x ->> 'sku') like 'R-%';
  assert n = 3 and not exists (select 1 from jsonb_array_elements(res) x where (x ->> 'units')::int <= 0), 'stock units: only SKUs with stock (R-A at Bangalore, R-B at Bangalore, R-C at Delhi)';
  assert public.flipkart_sku_stock('R-A') = jsonb_build_object(w_blr::text, 1, w_del::text, 0), 'one SKU''s stock per warehouse';
  reset role;

  -- ===== a warehouse user only gets their own warehouse =====
  perform set_config('request.jwt.claims', json_build_object('sub', u_blr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  res := public.flipkart_order_counts();
  assert jsonb_array_length(res) = 1 and (res -> 0 ->> 'warehouse_id') = w_blr::text, 'the cards hold only Bangalore';
  res := public.flipkart_order_skus(null, 'active', null, 'due', 'asc', 50, 0);
  assert (res ->> 'orders')::int = 5, 'SKU rows count only Bangalore shipments (R-A 4, R-B 1)';
  select x into c from jsonb_array_elements(res -> 'rows') x where x ->> 'sku' = 'R-A';
  assert (c -> 'by_wh' ->> w_del::text) is null, 'no Delhi units in a Bangalore user''s SKU row';
  res := public.flipkart_order_lines(null, 'active', null, null, 'due', 'asc', 50, 0);
  assert (res ->> 'total')::int = 5, 'only Bangalore order lines';
  res := public.flipkart_cancel_summary(null);
  assert (res ->> 'buyer_total')::int = 0, 'the Delhi cancellation is not counted for them';
  res := public.flipkart_upcoming_vs_stock(null, false, null, 'short', 'desc', 50, 0);
  assert (res ->> 'total')::int = 0, 'Delhi''s upcoming order is not theirs';
  res := public.flipkart_returns_page(null, null, null, 'date', 'desc', 50, 0);
  assert (res ->> 'total')::int = 1 and (res -> 'rows' -> 0 ->> 'return_id') = 'R-RT1', 'only Bangalore returns';
  res := public.flipkart_returns_summary(null);
  assert (res ->> 'courier_units')::int = 0, 'Delhi''s courier return is not counted for them';
  reset role;
end $$;

select 'All Phase 4 orders RPC checks passed' as result;

rollback;
