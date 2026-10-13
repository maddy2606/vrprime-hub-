-- Phase 6 check: money data is owner only, the profit maths, the checkers and the reminder.
--
-- Runs in one transaction that is rolled back, so it is safe on production and leaves nothing behind (the real
-- uploaded reports are only read, never changed). Any failed check raises an error.
--
--   psql "$DATABASE_URL" -f supabase/tests/phase6_check.sql

begin;

do $$
declare
  u_own uuid := gen_random_uuid();
  u_adm uuid := gen_random_uuid();
  u_blr uuid := gen_random_uuid();
  w_blr uuid;
  up uuid;
  pay int;
  n int;
  t text;
  f text;
  blocked boolean;
  res jsonb;
  r record;
begin
  select id into strict w_blr from public.warehouses where name = 'Bangalore';
  insert into auth.users (id, instance_id, aud, role, email) values
    (u_own, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p6-own@example.test'),
    (u_adm, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p6-adm@example.test'),
    (u_blr, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p6-blr@example.test');
  insert into public.profiles (id, name, role, active) values
    (u_own, 'P6 Owner', 'owner', true), (u_adm, 'P6 Admin', 'admin', true), (u_blr, 'P6 Bangalore', 'warehouse', true)
  on conflict (id) do update set name = excluded.name, role = excluded.role, active = excluded.active;
  insert into public.user_warehouses values (u_blr, w_blr);

  -- ---- Test data: one SKU, a sale, a return, an old and a new cost -------------------------------------------------
  insert into public.money_uploads (kind, filename, status) values ('settled', 'p6-test.xlsx', 'done') returning id into up;
  insert into public.money_payments (neft_id, neft_type, payment_date) values ('P6-NEFT-1', 'Postpaid', '2026-09-20') returning id into pay;
  insert into public.money_settled_lines (key, upload_id, payment_id, payment_date, order_id, order_item_id, sku, order_date, qty,
      sale_amount, refund, fixed_fee, reverse_shipping_fee, gst_on_fees, tcs, tds, mp_fee, taxes, net, itc_gst_tcs, itc_tds,
      weight_slab, zone, weight_type, commission_rate)
  values
    (md5('p6-1')::uuid, up, pay, '2026-09-20', 'OD-P6-1', 'P6-ITEM-1', 'P6-SKU', '2026-09-10', 1, 200, 0, -20, 0, -3.6, -2, -0.4, -20, -6, 174, 5.6, 0.4, null, null, null, 0),
    (md5('p6-2')::uuid, up, pay, '2026-09-20', 'OD-P6-2', 'P6-ITEM-2', 'P6-SKU', '2026-09-10', 2, 400, 0, -40, 0, -7.2, -4, -0.8, -40, -12, 348, 11.2, 0.8, null, null, null, 0),
    (md5('p6-3')::uuid, up, pay, '2026-09-21', 'OD-P6-3', 'P6-ITEM-3', 'P6-SKU', '2026-09-11', 1, 200, -200, 0, -100, -18, 0, 0, -100, -18, -318, 18, 0, '0.5-1.0', 'Zonal', 'Volumetric', 0);
  insert into public.sku_costs (sku, effective_from, purchase_cost, packaging_cost, freight) values
    ('P6-SKU', '2026-01-01', 50, 5, 0), ('P6-SKU', '2026-09-15', 80, 5, 5);

  -- ---- The roles: admin and warehouse see and change nothing --------------------------------------------------------
  perform private.money_refresh_summary('2026-09-20', '2026-09-23');
  update public.money_flags_cache set computed_at = now();
  foreach t in array array['money_uploads', 'money_payments', 'money_settled_lines', 'money_other_lines', 'money_pnl_orders', 'sku_costs', 'money_sku_day', 'money_state', 'money_wrong_fee_rows', 'money_flags_cache'] loop
    perform set_config('request.jwt.claims', json_build_object('sub', u_own, 'role', 'authenticated')::text, true);
    set local role authenticated;
    if t in ('money_uploads', 'money_payments', 'money_settled_lines', 'sku_costs', 'money_sku_day', 'money_state') then
      execute format('select count(*) from public.%I', t) into n;
      assert n >= 1, 'the owner reads ' || t;
    end if;
    reset role;

    foreach f in array array[u_adm::text, u_blr::text] loop
      perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
      set local role authenticated;
      execute format('select count(*) from public.%I', t) into n;
      assert n = 0, 'a ' || (select role from public.profiles where id = f::uuid) || ' sees no row of ' || t;
      begin
        execute format('delete from public.%I', t);
        get diagnostics n = row_count;
      exception when insufficient_privilege then n := 0;
      end;
      assert n = 0, 'a non-owner deletes nothing from ' || t;
      reset role;
    end loop;
  end loop;

  foreach f in array array[u_adm::text, u_blr::text] loop
    perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
    set local role authenticated;
    blocked := false;
    begin
      insert into public.sku_costs (sku, effective_from, purchase_cost) values ('P6-HACK', '2026-10-01', 1);
    exception when insufficient_privilege then blocked := true;
    end;
    assert blocked, 'a non-owner cannot add a cost';
    blocked := false;
    begin
      insert into public.money_uploads (kind, filename) values ('settled', 'hack.xlsx');
    exception when insufficient_privilege then blocked := true;
    end;
    assert blocked, 'a non-owner cannot add an upload';

    -- every money function refuses them
    foreach t in array array[
      'select public.money_begin_upload(''settled'', ''x'')', 'select public.money_add_settled(gen_random_uuid(), ''[]'')',
      'select public.money_add_other(gen_random_uuid(), ''[]'')', 'select public.money_add_pnl(gen_random_uuid(), ''[]'')',
      'select public.money_finish_upload(gen_random_uuid(), ''{}'')', 'select public.money_fail_upload(gen_random_uuid(), ''x'')',
      'select * from public.money_profit(''2026-09-01'', ''2026-09-30'')', 'select * from public.money_account_lines(''2026-09-01'', ''2026-09-30'')',
      'select public.money_sku_lines(''P6-SKU'', ''2026-09-01'', ''2026-09-30'')', 'select * from public.money_estimate(''2026-09-01'', ''2026-09-30'')',
      'select public.money_crosscheck()', 'select * from public.money_weight(''2026-09-01'', ''2026-09-30'')', 'select * from public.money_unpaid()',
      'select * from public.money_wrong_fees()', 'select public.money_flags()', 'select public.money_db_size_mb()'] loop
      blocked := false;
      begin
        execute t;
      exception when insufficient_privilege then blocked := true;
      end;
      assert blocked, 'a non-owner is refused: ' || t;
    end loop;
    reset role;
  end loop;

  -- signed out
  set local role anon;
  blocked := false;
  begin
    perform count(*) from public.money_settled_lines;
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'a signed-out visitor cannot read money data';
  reset role;

  -- ---- The owner's numbers --------------------------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', u_own, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into strict r from public.money_profit('2026-09-20', '2026-09-21') where sku = 'P6-SKU';
  -- sold: lines 1 and 2 = 3 units; returned: line 3 = 1 unit
  assert r.units_sold = 3 and r.units_returned = 1, 'units sold and returned';
  assert r.gross_sales = 600 and r.refunds = -200, 'sales and refunds';
  assert r.net_payout = 204 and r.itc = 36, 'net payout 174+348-318 = 204, tax credits 6+12+18 = 36';
  assert r.reverse_shipping_fee = -100 and r.fixed_fee = -60, 'fees by type';
  -- cost: orders placed 10 and 11 Sep use the OLD cost (55); 3 sold units out, 1 returned back in: (1+2-1) x 55 = 110
  assert r.cost = 110, 'the cost in force on the order date is used, and a returned unit comes back';
  assert not r.cost_missing, 'cost is known';
  select count(*) into n from public.money_profit('2026-09-20', '2026-09-21') where sku = 'P6-SKU' and not cost_missing;
  delete from public.sku_costs where sku = 'P6-SKU';
  select * into strict r from public.money_profit('2026-09-20', '2026-09-21') where sku = 'P6-SKU';
  assert r.cost_missing, 'a SKU with sales and no cost is flagged';
  reset role;
  res := private.money_compute_flags();
  set local role authenticated;
  assert (res ->> 'cost_missing')::int >= 1, 'cost missing shows in the flags';
  assert (public.money_flags() ->> 'low_margin_percent') is not null, 'the saved Needs action answer can be read';
  res := public.money_sku_lines('P6-SKU', '2026-09-20', '2026-09-21', 10, 0);
  assert (res ->> 'total')::int = 3, 'the drill-down lists the lines of the SKU';

  -- weight overcharge: our listing package says 0.31 kg (slab up to 0.5), Flipkart charged 0.5-1.0 on a return
  reset role;
  insert into public.stock_listings (platform, sku, status, packages, first_seen_date, last_seen_date)
  values ('flipkart', 'P6-SKU', 'ACTIVE',
          '[{"dimensions": {"length": 23, "breadth": 9, "height": 7.5}, "weight": 0.3}]'::jsonb, current_date, current_date)
  on conflict (platform, sku) do update set packages = excluded.packages;
  perform set_config('request.jwt.claims', json_build_object('sub', u_own, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into strict r from public.money_weight('2026-09-01', '2026-09-30') where sku = 'P6-SKU';
  assert r.charged_kg = 1.0 and r.our_slab_kg = 0.5, 'charged slab 0.5-1.0 against our slab up to 0.5';
  assert round(r.our_kg, 2) = 0.31, 'volumetric 23 x 9 x 7.5 / 5000 = 0.31 beats the dead weight 0.3';
  assert r.fee_paid = 100, 'the shipping fee paid on that line';
  reset role;
  update public.stock_listings set packages = '[{"dimensions": {"length": 23, "breadth": 9, "height": 7.5}, "weight": 0.9}]'::jsonb
  where platform = 'flipkart' and sku = 'P6-SKU';
  perform set_config('request.jwt.claims', json_build_object('sub', u_own, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.money_weight('2026-09-01', '2026-09-30') where sku = 'P6-SKU';
  assert n = 0, 'when our package really is in that slab there is no overcharge';

  -- settlement checker: a fee charged twice for one order item
  reset role;
  insert into public.money_settled_lines (key, upload_id, payment_id, payment_date, order_id, order_item_id, sku, qty, sale_amount, fixed_fee, net)
  values (md5('p6-dup-1')::uuid, up, pay, '2026-09-22', 'OD-P6-D', 'P6-ITEM-D', 'P6-SKU', 1, 100, -18, 82),
         (md5('p6-dup-2')::uuid, up, pay, '2026-09-23', 'OD-P6-D', 'P6-ITEM-D', 'P6-SKU', 1, 100, -18, 82);
  perform set_config('request.jwt.claims', json_build_object('sub', u_own, 'role', 'authenticated')::text, true);
  set local role authenticated;
  reset role;
  select * into strict r from private.money_wrong_fees_compute() w where w.order_item_id = 'P6-ITEM-D';
  assert r.problem = 'Fee charged twice' and r.extra_fee = 18, 'a fee charged twice is found, with the amount';
  reset role;

  -- no double counting: the same key twice is one row
  perform set_config('request.jwt.claims', json_build_object('sub', u_own, 'role', 'authenticated')::text, true);
  set local role authenticated;
  res := public.money_add_settled(up, jsonb_build_array(
    jsonb_build_object('key', 'p6-1', 'neft_id', 'P6-NEFT-1', 'payment_date', '2026-09-20', 'order_item_id', 'P6-ITEM-1'),
    jsonb_build_object('key', 'p6-new', 'neft_id', 'P6-NEFT-1', 'payment_date', '2026-09-20', 'order_item_id', 'P6-ITEM-NEW')));
  assert (res ->> 'seen')::int = 2 and (res ->> 'added')::int = 1, 'a line seen before is skipped, a new one is added';

  -- a finished upload tells the background job there is work
  reset role;
  update public.money_state set summary_dirty = false, checks_dirty = false, flags_dirty = false;
  perform set_config('request.jwt.claims', json_build_object('sub', u_own, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.money_finish_upload(up, '{}'::jsonb);
  reset role;
  assert (select summary_dirty and checks_dirty and flags_dirty from public.money_state), 'finishing an upload marks the numbers as needing work';

  -- the reminder
  reset role;
  update public.money_uploads set created_at = now() - interval '20 days' where id = up;
  delete from public.notifications where kind = 'money_reminder';
  -- the other real uploads count too: age them all inside this transaction
  update public.money_uploads set created_at = now() - interval '20 days';
  assert private.money_upload_reminder() >= 1, 'owners are reminded after 14 days without an upload';
  assert exists (select 1 from public.notifications where kind = 'money_reminder' and user_id = u_own), 'this owner got it';
  assert not exists (select 1 from public.notifications where kind = 'money_reminder' and user_id in (u_adm, u_blr)), 'admins and warehouse users do not';
  assert private.money_upload_reminder() = 0, 'and not again within a week';
  assert exists (select 1 from cron.job where jobname = 'money-upload-reminder' and active), 'the reminder is scheduled';

  -- ticket issue types
  insert into public.tickets (ticket_id, issue_type, created_by) values ('P6-T1', 'weight_overcharge', u_own), ('P6-T2', 'wrong_fee', u_own);
  assert (select count(*) from public.tickets where ticket_id like 'P6-T%') = 2, 'weight overcharge and wrong fee are ticket issue types';
end $$;

select 'All Phase 6 checks passed' as result;

rollback;
