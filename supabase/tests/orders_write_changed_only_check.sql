-- Write-only-changed-lines check (supabase/proposals/20261116110000_orders_write_changed_only.sql).
--
-- Runs the same order-sync input through the OLD logic (the live functions before the change, copied below into
-- pg_temp) and the NEW logic (public.orders_apply_page / orders_run_finish with the proposal applied), each in a
-- sub-block that is rolled back, and checks:
--   1. fk_order_items: every column identical, except last_seen_at and last_run_id on lines that did not change;
--   2. fk_returns: every column identical, except last_run_id on returns that did not change;
--   3. the run rows the Sync page reads (status, step, parts, pages, items_seen, items_saved, returns_saved,
--      coverage_from, error, finished_at, notes.left_pending, notes.alerted) identical;
--   4. flipkart_in_transit() and dispatch_daily identical;
--   5. the new logic wrote only the inserted or changed lines (notes.changed), and the seen table is emptied;
--   6. if the seen table is emptied by a restart mid-run, nothing is moved off the pending list.
--
-- Needs a database with the proposal applied: a TEST project, never the live one. Everything is in one transaction
-- that is rolled back.
--
--   psql "$TEST_DATABASE_URL" -f supabase/proposals/20261116110000_orders_write_changed_only.sql
--   psql "$TEST_DATABASE_URL" -f supabase/tests/orders_write_changed_only_check.sql

begin;

-- ---------------------------------------------------------------------------------------------------------------
-- The old logic, exactly as live on 16 Nov 2026 (from the rollback file), renamed into pg_temp.
-- ---------------------------------------------------------------------------------------------------------------

CREATE FUNCTION pg_temp.old_orders_apply_page(p_run uuid, p_step integer, p_items jsonb, p_returns jsonb, p_next text, p_seen integer)
 RETURNS jsonb
 LANGUAGE plpgsql

 SET search_path TO ''
AS $function$
declare
  r public.order_runs;
  topic jsonb;
  v_t text;
  v_stage text;
  v_cancel text;
  it jsonb;
  v_wid uuid;
  v_loc text;
  v_date timestamptz;
  v_saved integer := 0;
  v_returns integer := 0;
  v_created timestamptz;
  v_day date;
begin
  select * into r from public.order_runs where id = p_run for update;
  if not found or r.status <> 'running' then
    raise exception 'run is not running';
  end if;
  if r.step <> p_step then
    raise exception 'run is at step %, not %', r.step, p_step;
  end if;

  topic := r.plan -> r.step;
  v_t := topic ->> 't';
  v_stage := case v_t when 'pre' then 'pending' when 'post' then 'dispatched' when 'cancel' then 'cancelled' end;
  v_cancel := case topic ->> 'type' when 'sellerCancellation' then 'seller' when 'buyerCancellation' then 'buyer' end;

  if v_t in ('pre', 'post', 'cancel') then
    for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
      if coalesce(it ->> 'order_item_id', '') = '' or coalesce(it ->> 'order_id', '') = '' then
        continue;
      end if;
      v_loc := nullif(it ->> 'location_id', '');
      v_wid := null;
      if v_loc is not null then
        select id into v_wid from public.warehouses where flipkart_location_id = v_loc;
      end if;
      v_date := nullif(it ->> 'order_date', '')::timestamptz;

      insert into public.fk_order_items as t (
        platform, order_item_id, order_id, shipment_id, sku, quantity, order_date, order_day, location_id, warehouse_id,
        stage, item_status, hold, dispatch_by, dispatch_after, cancel_type, cancelled_at, cancel_reason, cancel_sub_reason,
        selling_price, last_run_id)
      values (
        'flipkart', it ->> 'order_item_id', it ->> 'order_id', nullif(it ->> 'shipment_id', ''), nullif(it ->> 'sku', ''),
        case when jsonb_typeof(it -> 'quantity') = 'number' then least(greatest((it ->> 'quantity')::numeric, 0), 100000)::integer else 1 end,
        v_date, case when v_date is null then null else (v_date at time zone 'Asia/Kolkata')::date end,
        v_loc, v_wid,
        v_stage, left(it ->> 'status', 40), coalesce((it ->> 'hold')::boolean, false),
        nullif(it ->> 'dispatch_by', '')::timestamptz, nullif(it ->> 'dispatch_after', '')::timestamptz,
        v_cancel, nullif(it ->> 'cancelled_at', '')::timestamptz,
        left(it ->> 'cancel_reason', 80), left(it ->> 'cancel_sub_reason', 80),
        case when jsonb_typeof(it -> 'selling_price') = 'number' then least(greatest((it ->> 'selling_price')::numeric, 0), 9999999) end,
        p_run)
      on conflict (platform, order_item_id) do update set
        order_id = excluded.order_id,
        shipment_id = coalesce(excluded.shipment_id, t.shipment_id),
        sku = coalesce(excluded.sku, t.sku),
        quantity = excluded.quantity,
        order_date = coalesce(excluded.order_date, t.order_date),
        order_day = coalesce(excluded.order_day, t.order_day),
        location_id = coalesce(excluded.location_id, t.location_id),
        warehouse_id = coalesce(excluded.warehouse_id, t.warehouse_id),
        stage = excluded.stage,
        item_status = excluded.item_status,
        hold = excluded.hold,
        dispatch_by = coalesce(excluded.dispatch_by, t.dispatch_by),
        dispatch_after = coalesce(excluded.dispatch_after, t.dispatch_after),
        cancel_type = coalesce(excluded.cancel_type, t.cancel_type),
        cancelled_at = coalesce(excluded.cancelled_at, t.cancelled_at),
        cancel_reason = coalesce(excluded.cancel_reason, t.cancel_reason),
        cancel_sub_reason = coalesce(excluded.cancel_sub_reason, t.cancel_sub_reason),
        selling_price = coalesce(excluded.selling_price, t.selling_price),
        last_seen_at = now(),
        last_run_id = p_run;
      v_saved := v_saved + 1;
    end loop;
  elsif v_t = 'returns' then
    for it in select * from jsonb_array_elements(coalesce(p_returns, '[]'::jsonb)) loop
      if coalesce(it ->> 'order_item_id', '') = '' then
        continue;
      end if;
      v_loc := nullif(it ->> 'location_id', '');
      v_wid := null;
      if v_loc is not null then
        select id into v_wid from public.warehouses where flipkart_location_id = v_loc;
      end if;
      v_created := nullif(it ->> 'created_at', '')::timestamptz;
      v_day := case when v_created is null then null else (v_created at time zone 'Asia/Kolkata')::date end;

      insert into public.fk_returns as t (
        platform, return_id, order_item_id, order_id, source, sku, quantity, location_id, warehouse_id,
        return_status, reason, sub_reason, shipment_status, order_date, created_date, updated_date, last_run_id)
      values (
        'flipkart', coalesce(nullif(it ->> 'return_id', ''), it ->> 'order_item_id'), it ->> 'order_item_id',
        nullif(it ->> 'order_id', ''), topic ->> 'source',
        (select o.sku from public.fk_order_items o where o.platform = 'flipkart' and o.order_item_id = it ->> 'order_item_id'),
        case when jsonb_typeof(it -> 'quantity') = 'number' then least(greatest((it ->> 'quantity')::numeric, 0), 100000)::integer else 1 end,
        v_loc, v_wid,
        left(it ->> 'status', 40), left(it ->> 'reason', 80), left(it ->> 'sub_reason', 80), left(it ->> 'shipment_status', 40),
        nullif(it ->> 'order_date', '')::timestamptz, v_day, nullif(it ->> 'updated_at', '')::timestamptz,
        p_run)
      on conflict (platform, return_id, order_item_id) do update set
        order_id = coalesce(excluded.order_id, t.order_id),
        source = excluded.source,
        sku = coalesce(t.sku, excluded.sku),
        quantity = excluded.quantity,
        location_id = coalesce(excluded.location_id, t.location_id),
        warehouse_id = coalesce(excluded.warehouse_id, t.warehouse_id),
        return_status = excluded.return_status,
        reason = excluded.reason,
        sub_reason = excluded.sub_reason,
        shipment_status = excluded.shipment_status,
        updated_date = excluded.updated_date,
        last_run_id = p_run;
      v_returns := v_returns + 1;
    end loop;
  end if;

  update public.order_runs
  set pages = pages + 1,
      items_seen = items_seen + greatest(coalesce(p_seen, 0), 0),
      items_saved = items_saved + v_saved,
      returns_saved = returns_saved + v_returns,
      step = case when p_next is null then step + 1 else step end,
      next_path = p_next,
      -- A day of shipped orders is complete once its last page is saved.
      coverage_from = case when p_next is null and r.kind = 'backfill' and topic ? 'day'
                           then least(coalesce(coverage_from, (topic ->> 'day')::date), (topic ->> 'day')::date)
                           else coverage_from end,
      attempts = 0,
      error = null,
      updated_at = now()
  where id = p_run;

  return jsonb_build_object('saved', v_saved, 'returns', v_returns);
end $function$;

CREATE FUNCTION pg_temp.old_orders_run_finish(p_run uuid)
 RETURNS jsonb
 LANGUAGE plpgsql

 SET search_path TO ''
AS $function$
declare
  r public.order_runs;
  v_error text;
  v_left integer := 0;
  v_alerts integer := 0;
begin
  select * into r from public.order_runs where id = p_run for update;
  if not found or r.status <> 'running' then
    raise exception 'run is not running';
  end if;
  if r.step < jsonb_array_length(r.plan) then
    v_error := 'Stopped early: read ' || r.step || ' of ' || jsonb_array_length(r.plan) || ' parts';
  end if;
  if v_error is not null then
    update public.order_runs
    set status = 'failed', error = v_error, finished_at = now(), lease_until = null, updated_at = now()
    where id = p_run;
    return jsonb_build_object('ok', false, 'error', v_error);
  end if;

  if r.kind in ('pending', 'upcoming') then
    update public.fk_order_items o
    set stage = 'left_pending'
    where o.platform = 'flipkart' and o.stage = 'pending' and o.last_run_id is distinct from p_run
      and o.location_id is not null and o.dispatch_by is not null
      and not exists (
        select 1 from unnest(array['APPROVED', 'PACKING_IN_PROGRESS', 'PACKED', 'READY_TO_DISPATCH', 'FORM_FAILED']) s(state)
        where not exists (
          select 1 from jsonb_array_elements(r.plan) p
          where p ->> 't' = 'pre' and p ->> 'state' = s.state and p ->> 'loc' = o.location_id
            and (p ->> 'from') is not null and (p ->> 'to') is not null
            and (p ->> 'from')::timestamptz <= o.dispatch_by and o.dispatch_by <= (p ->> 'to')::timestamptz));
    get diagnostics v_left = row_count;
    v_alerts := private.orders_raise_alerts();
  end if;

  update public.fk_returns ret
  set sku = o.sku
  from public.fk_order_items o
  where ret.sku is null and o.platform = ret.platform and o.order_item_id = ret.order_item_id and o.sku is not null;

  if r.kind <> 'pending' then
    -- Keep 12 months of orders and returns, 90 days of run records.
    delete from public.fk_order_items where order_date < now() - interval '12 months' and stage <> 'pending';
    delete from public.fk_returns where created_date < (now() at time zone 'Asia/Kolkata')::date - 365;
    delete from public.order_runs where finished_at < now() - interval '90 days';
  end if;

  -- Keep the daily dispatch totals in step with the orders (the days-of-cover and forecast numbers read them).
  perform private.dispatch_daily_refresh();

  update public.order_runs
  set status = 'done', error = null, finished_at = now(), lease_until = null, updated_at = now(),
      notes = jsonb_build_object('left_pending', v_left, 'alerted', v_alerts)
  where id = p_run;
  return jsonb_build_object('ok', true, 'left_pending', v_left, 'alerted', v_alerts);
end $function$;

-- ---------------------------------------------------------------------------------------------------------------
-- Fixtures: one test warehouse; lines and returns already saved by earlier runs (seen 30 hours ago).
-- ---------------------------------------------------------------------------------------------------------------

create temp table owc_ids (k text primary key, id uuid not null);

do $$
declare
  w uuid;
  t_order timestamptz := timestamptz '2026-11-15 10:00:00+00';
  t_seen timestamptz := now() - interval '30 hours';
  t_by timestamptz := date_trunc('second', now()) + interval '1 day';
  run_p uuid;
  run_d uuid;
  pre jsonb := '[]'::jsonb;
  s text;
begin
  insert into public.warehouses (name, flipkart_location_id, sort_order) values ('OWC test', 'OWC-LOC', 99) returning id into w;
  insert into owc_ids values ('w', w);

  -- fk_order_items: P* pending, D* shipped, C* cancelled. All saved by an earlier run, last seen 30 hours ago.
  insert into public.fk_order_items (platform, order_item_id, order_id, shipment_id, sku, quantity, order_date, order_day,
    location_id, warehouse_id, stage, item_status, hold, dispatch_by, dispatch_after, cancel_type, cancelled_at,
    cancel_reason, cancel_sub_reason, selling_price, first_seen_at, last_seen_at, last_run_id)
  select 'flipkart', v.id, 'O-' || v.id, 'S-' || v.id, 'OWC-SKU' || v.n, 1, t_order, date '2026-11-15', 'OWC-LOC', w,
         v.stage, v.status, false, t_by, null, v.ctype, v.cat, v.cr, null, 499, t_seen, t_seen, null
  from (values
    ('OWC-P1', 1, 'pending',    'APPROVED',          null::text, null::timestamptz, null::text),  -- seen, unchanged
    ('OWC-P2', 2, 'pending',    'APPROVED',          null, null, null),                          -- seen, now READY_TO_DISPATCH
    ('OWC-P3', 3, 'pending',    'APPROVED',          null, null, null),                          -- not seen: leaves pending
    ('OWC-P4', 4, 'pending',    'APPROVED',          null, null, null),                          -- seen with no SKU: unchanged
    ('OWC-P5', 5, 'pending',    'READY_TO_DISPATCH', null, null, null),                          -- seen, now on hold
    ('OWC-P6', 6, 'pending',    'APPROVED',          null, null, null),                          -- cancelled by the daily run
    ('OWC-D1', 1, 'dispatched', 'SHIPPED',           null, null, null),                          -- seen again: in transit
    ('OWC-D2', 2, 'dispatched', 'SHIPPED',           null, null, null),                          -- not seen: drops out of transit
    ('OWC-C1', 3, 'cancelled',  'CANCELLED',         'seller', timestamptz '2026-11-15 12:00:00+00', 'Out of stock')  -- seen, unchanged
  ) v(id, n, stage, status, ctype, cat, cr);

  insert into public.fk_returns (platform, return_id, order_item_id, order_id, source, sku, quantity, location_id,
    warehouse_id, return_status, reason, sub_reason, shipment_status, order_date, created_date, updated_date, first_seen_at)
  values
    ('flipkart', 'OWC-R1', 'OWC-D1', 'O-OWC-D1', 'customer_return', 'OWC-SKU1', 1, 'OWC-LOC', w, 'in_transit', 'Damaged', null, null, t_order, date '2026-11-15', timestamptz '2026-11-15 14:00:00+00', t_seen),
    ('flipkart', 'OWC-R2', 'OWC-D2', 'O-OWC-D2', 'customer_return', 'OWC-SKU2', 1, 'OWC-LOC', w, 'in_transit', 'Wrong item', null, null, t_order, date '2026-11-15', timestamptz '2026-11-15 14:00:00+00', t_seen);

  -- The runs: a pending run (one pending-list part per state, as private.order_plan builds them) and a daily run.
  foreach s in array array['APPROVED', 'PACKING_IN_PROGRESS', 'PACKED', 'READY_TO_DISPATCH', 'FORM_FAILED'] loop
    pre := pre || jsonb_build_array(jsonb_build_object('t', 'pre', 'state', s, 'loc', 'OWC-LOC',
      'from', now() - interval '90 days', 'to', now() + interval '2 days'));
  end loop;
  insert into public.order_runs (kind, trigger, status, plan) values ('pending', 'manual', 'running', pre) returning id into run_p;
  insert into public.order_runs (kind, trigger, status, plan) values ('daily', 'manual', 'queued', jsonb_build_array(
    jsonb_build_object('t', 'post', 'day', date '2026-11-15', 'from', now() - interval '1 day', 'to', now()),
    jsonb_build_object('t', 'cancel', 'type', 'sellerCancellation', 'from', now() - interval '4 days', 'to', now()),
    jsonb_build_object('t', 'returns', 'source', 'customer_return', 'since', 'modifiedAfter', 'at', now() - interval '4 days')))
  returning id into run_d;
  insert into owc_ids values ('run_p', run_p), ('run_d', run_d);
end $$;

-- One line as Flipkart sends it (the edge function's normalised shape).
create function pg_temp.owc_item(p_id text, p_n int, p_status text, p_hold boolean default false, p_sku boolean default true,
  p_cancel_at timestamptz default null, p_reason text default null) returns jsonb language sql as $f$
  select jsonb_strip_nulls(jsonb_build_object(
    'order_item_id', p_id, 'order_id', 'O-' || p_id, 'shipment_id', 'S-' || p_id,
    'sku', case when p_sku then 'OWC-SKU' || p_n end, 'quantity', 1,
    'order_date', timestamptz '2026-11-15 10:00:00+00', 'location_id', 'OWC-LOC', 'status', p_status, 'hold', p_hold,
    'dispatch_by', date_trunc('second', now()) + interval '1 day',
    'cancelled_at', p_cancel_at, 'cancel_reason', p_reason, 'selling_price', 499))
$f$;

-- The same input for both: a pending run then a daily run, each finished.
create function pg_temp.owc_scenario(p_new boolean, p_lose_seen boolean default false) returns void language plpgsql as $f$
declare
  run_p uuid := (select id from owc_ids where k = 'run_p');
  run_d uuid := (select id from owc_ids where k = 'run_d');
  approved jsonb := jsonb_build_array(
    pg_temp.owc_item('OWC-P1', 1, 'APPROVED'),
    pg_temp.owc_item('OWC-P2', 2, 'READY_TO_DISPATCH'),
    pg_temp.owc_item('OWC-P4', 4, 'APPROVED', p_sku => false),
    pg_temp.owc_item('OWC-P6', 6, 'APPROVED'),
    pg_temp.owc_item('OWC-N1', 7, 'APPROVED'));                                       -- new line
  rtd jsonb := jsonb_build_array(pg_temp.owc_item('OWC-P5', 5, 'READY_TO_DISPATCH', p_hold => true));
  shipped jsonb := jsonb_build_array(pg_temp.owc_item('OWC-D1', 1, 'SHIPPED'), pg_temp.owc_item('OWC-N2', 8, 'SHIPPED'));
  cancelled jsonb := jsonb_build_array(
    pg_temp.owc_item('OWC-C1', 3, 'CANCELLED', p_cancel_at => timestamptz '2026-11-15 12:00:00+00', p_reason => 'Out of stock'),
    pg_temp.owc_item('OWC-P6', 6, 'CANCELLED', p_cancel_at => timestamptz '2026-11-16 03:00:00+00', p_reason => 'Buyer asked'));
  rets jsonb := jsonb_build_array(
    jsonb_build_object('return_id', 'OWC-R1', 'order_item_id', 'OWC-D1', 'order_id', 'O-OWC-D1', 'quantity', 1, 'location_id', 'OWC-LOC',
      'status', 'in_transit', 'reason', 'Damaged', 'order_date', timestamptz '2026-11-15 10:00:00+00',
      'created_at', timestamptz '2026-11-15 13:00:00+00', 'updated_at', timestamptz '2026-11-15 14:00:00+00'),   -- unchanged
    jsonb_build_object('return_id', 'OWC-R2', 'order_item_id', 'OWC-D2', 'order_id', 'O-OWC-D2', 'quantity', 1, 'location_id', 'OWC-LOC',
      'status', 'delivered', 'reason', 'Wrong item', 'order_date', timestamptz '2026-11-15 10:00:00+00',
      'created_at', timestamptz '2026-11-15 13:00:00+00', 'updated_at', timestamptz '2026-11-16 04:00:00+00'),   -- changed
    jsonb_build_object('return_id', 'OWC-R3', 'order_item_id', 'OWC-N2', 'order_id', 'O-OWC-N2', 'quantity', 1, 'location_id', 'OWC-LOC',
      'status', 'requested', 'reason', 'Too small', 'order_date', timestamptz '2026-11-15 10:00:00+00',
      'created_at', timestamptz '2026-11-16 02:00:00+00', 'updated_at', timestamptz '2026-11-16 02:00:00+00'));  -- new
  steps jsonb := jsonb_build_array(approved, '[]'::jsonb, '[]'::jsonb, rtd, '[]'::jsonb);
  i int;
begin
  for i in 0..4 loop
    if p_new then perform public.orders_apply_page(run_p, i, steps -> i, '[]'::jsonb, null, jsonb_array_length(steps -> i));
    else perform pg_temp.old_orders_apply_page(run_p, i, steps -> i, '[]'::jsonb, null, jsonb_array_length(steps -> i)); end if;
  end loop;
  -- The same page saved twice (a retry after a cut-off) must change nothing.
  update public.order_runs set step = 3 where id = run_p;
  if p_new then perform public.orders_apply_page(run_p, 3, rtd, '[]'::jsonb, null, 1);
  else perform pg_temp.old_orders_apply_page(run_p, 3, rtd, '[]'::jsonb, null, 1); end if;
  update public.order_runs set step = 5 where id = run_p;
  if p_lose_seen then truncate private.order_run_seen; end if;   -- a database restart empties the unlogged table
  if p_new then perform public.orders_run_finish(run_p); else perform pg_temp.old_orders_run_finish(run_p); end if;

  update public.order_runs set status = 'running' where id = run_d;
  if p_new then
    perform public.orders_apply_page(run_d, 0, shipped, '[]'::jsonb, null, 2);
    perform public.orders_apply_page(run_d, 1, cancelled, '[]'::jsonb, null, 2);
    perform public.orders_apply_page(run_d, 2, '[]'::jsonb, rets, null, 3);
    perform public.orders_run_finish(run_d);
  else
    perform pg_temp.old_orders_apply_page(run_d, 0, shipped, '[]'::jsonb, null, 2);
    perform pg_temp.old_orders_apply_page(run_d, 1, cancelled, '[]'::jsonb, null, 2);
    perform pg_temp.old_orders_apply_page(run_d, 2, '[]'::jsonb, rets, null, 3);
    perform pg_temp.old_orders_run_finish(run_d);
  end if;
end $f$;

-- Everything the check compares.
create function pg_temp.owc_snapshot() returns jsonb language sql as $f$
  select jsonb_build_object(
    'items', (select jsonb_object_agg(o.order_item_id, to_jsonb(o)) from public.fk_order_items o where o.order_item_id like 'OWC-%'),
    'returns', (select jsonb_object_agg(r.return_id, to_jsonb(r)) from public.fk_returns r where r.return_id like 'OWC-%'),
    'runs', (select jsonb_object_agg(r.id, to_jsonb(r)) from public.order_runs r where r.id in (select id from owc_ids)),
    'transit', (select coalesce(jsonb_agg(to_jsonb(t) order by t.warehouse_id), '[]'::jsonb) from public.flipkart_in_transit() t
                where t.warehouse_id = (select id from owc_ids where k = 'w')),
    'dispatch', (select coalesce(jsonb_agg(to_jsonb(d) order by d.sku, d.dispatch_day), '[]'::jsonb) from public.dispatch_daily d where d.sku like 'OWC-%'),
    'seen_rows', (select count(*) from private.order_run_seen),
    'other_active', (select count(*) from public.order_runs where status in ('queued', 'running', 'paused')
                     and id not in (select id from owc_ids)))
$f$;

do $$
declare
  seed jsonb := pg_temp.owc_snapshot();
  old jsonb;
  new jsonb;
  lost jsonb;
  key_ text;
  unchanged text[] := array['OWC-P1', 'OWC-P4', 'OWC-C1'];   -- lines the runs saw but that did not change
  run_p text := (select id::text from owc_ids where k = 'run_p');
  run_d text := (select id::text from owc_ids where k = 'run_d');
  keep text[] := array['status', 'step', 'parts', 'pages', 'items_seen', 'items_saved', 'returns_saved', 'coverage_from',
                       'error', 'finished_at', 'attempts', 'lease_until'];
  a jsonb;
  b jsonb;
begin
  begin
    perform pg_temp.owc_scenario(false);
    old := pg_temp.owc_snapshot();
    raise exception 'owc-rollback';
  exception when raise_exception then
    if sqlerrm <> 'owc-rollback' then raise; end if;
  end;
  begin
    perform pg_temp.owc_scenario(true);
    new := pg_temp.owc_snapshot();
    raise exception 'owc-rollback';
  exception when raise_exception then
    if sqlerrm <> 'owc-rollback' then raise; end if;
  end;
  begin
    perform pg_temp.owc_scenario(true, p_lose_seen => true);
    lost := pg_temp.owc_snapshot();
    raise exception 'owc-rollback';
  exception when raise_exception then
    if sqlerrm <> 'owc-rollback' then raise; end if;
  end;

  -- 1. fk_order_items
  if (select array_agg(x order by x) from jsonb_object_keys(old -> 'items') x) is distinct from
     (select array_agg(x order by x) from jsonb_object_keys(new -> 'items') x) then
    raise exception 'FAIL 1: different lines: old % new %', old -> 'items', new -> 'items';
  end if;
  for key_ in select jsonb_object_keys(old -> 'items') loop
    a := old -> 'items' -> key_;
    b := new -> 'items' -> key_;
    if (a - 'last_seen_at' - 'last_run_id') is distinct from (b - 'last_seen_at' - 'last_run_id') then
      raise exception 'FAIL 1: line % differs: old % new %', key_, a, b;
    end if;
    if key_ = any (unchanged) then
      -- Unchanged: the new logic must not have written it at all.
      if b is distinct from seed -> 'items' -> key_ then
        raise exception 'FAIL 1: unchanged line % was written: seed % new %', key_, seed -> 'items' -> key_, b;
      end if;
    elsif a is distinct from b then
      raise exception 'FAIL 1: changed or new line % differs in last_seen_at/last_run_id: old % new %', key_, a, b;
    end if;
  end loop;
  if old -> 'items' -> 'OWC-P3' ->> 'stage' <> 'left_pending' then
    raise exception 'FAIL 1: the line not seen did not leave the pending list: %', old -> 'items' -> 'OWC-P3';
  end if;

  -- 2. fk_returns
  for key_ in select jsonb_object_keys(old -> 'returns') loop
    a := old -> 'returns' -> key_;
    b := new -> 'returns' -> key_;
    if (a - 'last_run_id') is distinct from (b - 'last_run_id') then
      raise exception 'FAIL 2: return % differs: old % new %', key_, a, b;
    end if;
    if key_ = 'OWC-R1' then
      if b is distinct from seed -> 'returns' -> key_ then raise exception 'FAIL 2: unchanged return written: %', b; end if;
    elsif a is distinct from b then
      raise exception 'FAIL 2: changed or new return % differs: old % new %', key_, a, b;
    end if;
  end loop;
  if (select count(*) from jsonb_object_keys(old -> 'returns')) <> (select count(*) from jsonb_object_keys(new -> 'returns')) then
    raise exception 'FAIL 2: different returns';
  end if;

  -- 3. what the Sync page reads, and the finish step's results
  foreach key_ in array array[run_p, run_d] loop
    a := old -> 'runs' -> key_;
    b := new -> 'runs' -> key_;
    if (select jsonb_object_agg(x, a -> x) from unnest(keep) x) is distinct from (select jsonb_object_agg(x, b -> x) from unnest(keep) x)
       or a -> 'notes' -> 'left_pending' is distinct from b -> 'notes' -> 'left_pending'
       or a -> 'notes' -> 'alerted' is distinct from b -> 'notes' -> 'alerted' then
      raise exception 'FAIL 3: run % differs: old % new %', key_, a, b;
    end if;
  end loop;

  -- 4. in-transit count and dispatch totals
  if old -> 'transit' is distinct from new -> 'transit' or old -> 'transit' = '[]'::jsonb then
    raise exception 'FAIL 4: in transit: old % new %', old -> 'transit', new -> 'transit';
  end if;
  if old -> 'dispatch' is distinct from new -> 'dispatch' then
    raise exception 'FAIL 4: dispatch_daily: old % new %', old -> 'dispatch', new -> 'dispatch';
  end if;

  -- 5. only inserted or changed lines were written; the seen table is emptied
  -- Pending run: N1 new, P2 and P5 changed (P1, P4 and P6 unchanged here; the retried page adds nothing).
  -- Daily run: D1 and N2 shipped (always written), P6 now cancelled (C1 unchanged), R2 changed and R3 new (R1 unchanged).
  if (new -> 'runs' -> run_p -> 'notes' ->> 'changed')::int <> 3 or (new -> 'runs' -> run_d -> 'notes' ->> 'changed')::int <> 5 then
    raise exception 'FAIL 5: changed counts: pending % daily % (expected 3 and 5)',
      new -> 'runs' -> run_p -> 'notes', new -> 'runs' -> run_d -> 'notes';
  end if;
  if (new ->> 'other_active')::int = 0 and (new ->> 'seen_rows')::int <> 0 then
    raise exception 'FAIL 5: order_run_seen not emptied: % rows', new ->> 'seen_rows';
  end if;

  -- 6. seen lines lost to a restart: nothing leaves the pending list, and the run says so
  if lost -> 'items' -> 'OWC-P3' ->> 'stage' <> 'pending' or (lost -> 'runs' -> run_p -> 'notes' ->> 'left_pending')::int <> 0
     or lost -> 'runs' -> run_p -> 'notes' -> 'seen_lost' is distinct from 'true'::jsonb then
    raise exception 'FAIL 6: after losing the seen lines: % %', lost -> 'items' -> 'OWC-P3', lost -> 'runs' -> run_p -> 'notes';
  end if;

  raise notice 'orders_write_changed_only_check: all checks passed (pending run wrote 3 of 6 lines read, daily run 5 of 7)';
end $$;

rollback;
