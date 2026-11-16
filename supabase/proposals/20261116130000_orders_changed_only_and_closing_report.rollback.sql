-- ROLLBACK for supabase/proposals/20261116130000_orders_changed_only_and_closing_report.sql.
-- The live definitions of orders_apply_page, orders_run_finish and private.closing_report as read from the database
-- on 16 Nov 2026, before the change, plus removing the unlogged table the change adds. Running this puts the order sync
-- and the closing report back exactly as they were.
-- The new columns (fk_order_items.left_pending_at, closing_reports.out_from and out_to) are left in place: dropping them
-- would throw their values away, and nothing reads them once the old functions are back.

CREATE OR REPLACE FUNCTION public.orders_apply_page(p_run uuid, p_step integer, p_items jsonb, p_returns jsonb, p_next text, p_seen integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
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

CREATE OR REPLACE FUNCTION public.orders_run_finish(p_run uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
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

CREATE OR REPLACE FUNCTION private.closing_report()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_title text := 'Closing report · ' || to_char(now() at time zone 'Asia/Kolkata', 'FMDD Mon');
  v_body text;
  u record;
begin
  with wh as (
    select w.id from public.warehouses w
  ), out_units as (
    select d.warehouse_id, sum(d.units)::integer as n
    from public.dispatch_daily d
    where d.platform = 'flipkart' and d.dispatch_day = v_today and d.warehouse_id is not null
    group by 1
  ), out_orders as (
    select i.warehouse_id, count(distinct i.order_id)::integer as n
    from public.fk_order_items i
    where i.platform = 'flipkart' and i.stage = 'dispatched' and i.dispatch_by is not null
      and (i.dispatch_by at time zone 'Asia/Kolkata')::date = v_today
    group by 1
  ), pend as (
    select i.warehouse_id,
           count(distinct i.order_id) filter (where i.dispatch_by is not null
                                                and (i.dispatch_by at time zone 'Asia/Kolkata')::date <= v_today)::integer as today_n,
           count(distinct i.order_id) filter (where i.dispatch_by is not null
                                                and (i.dispatch_by at time zone 'Asia/Kolkata')::date <= v_today
                                                and i.dispatch_by < now())::integer as late_n,
           count(distinct i.order_id)::integer as total_n
    from public.fk_order_items i
    where i.platform = 'flipkart' and i.stage = 'pending' and not i.hold
    group by 1
  ), att as (
    select s.warehouse_id,
           count(*) filter (where a.status = 'present')::integer as present,
           count(*) filter (where a.status = 'half')::integer as half_day,
           count(*) filter (where a.status = 'absent')::integer as absent,
           count(*) filter (where a.status = 'leave')::integer as on_leave,
           count(*) filter (where a.status is null)::integer as not_marked
    from public.staff s
    left join public.attendance a on a.staff_id = s.id and a.day = v_today
    where s.active
    group by 1
  ), ret as (
    select (x ->> 'warehouse_id')::uuid as warehouse_id, count(*)::integer as n
    from jsonb_array_elements(public.returns_to_claim()) x
    where (x ->> 'days_left')::integer >= 0 and x ->> 'warehouse_id' is not null
    group by 1
  )
  insert into public.closing_reports as c (day, warehouse_id, dispatched_units, dispatched_orders, pending_today, late_now,
                                           pending_total, present, half_day, absent, on_leave, not_marked, returns_to_check)
  select v_today, wh.id,
         coalesce(ou.n, 0), coalesce(oo.n, 0), coalesce(p.today_n, 0), coalesce(p.late_n, 0), coalesce(p.total_n, 0),
         coalesce(a.present, 0), coalesce(a.half_day, 0), coalesce(a.absent, 0), coalesce(a.on_leave, 0),
         coalesce(a.not_marked, 0), coalesce(r.n, 0)
  from wh
  left join out_units ou on ou.warehouse_id = wh.id
  left join out_orders oo on oo.warehouse_id = wh.id
  left join pend p on p.warehouse_id = wh.id
  left join att a on a.warehouse_id = wh.id
  left join ret r on r.warehouse_id = wh.id
  on conflict (day, warehouse_id) do update set
    dispatched_units = excluded.dispatched_units, dispatched_orders = excluded.dispatched_orders,
    pending_today = excluded.pending_today, late_now = excluded.late_now, pending_total = excluded.pending_total,
    present = excluded.present, half_day = excluded.half_day, absent = excluded.absent, on_leave = excluded.on_leave,
    not_marked = excluded.not_marked, returns_to_check = excluded.returns_to_check, created_at = now();

  -- Owners and admins: every warehouse, one line each.
  select string_agg(w.name || ': ' || c.dispatched_units || ' units out, ' || c.pending_today || ' pending, '
                    || c.late_now || ' late, ' || c.absent || ' absent', E'\n' order by w.sort_order, w.name)
  into v_body
  from public.closing_reports c join public.warehouses w on w.id = c.warehouse_id
  where c.day = v_today;
  if v_body is null then
    return;
  end if;
  for u in select private.alert_people() as id loop
    perform private.notify_user(u.id, 'closing_report', v_title, v_body, null, null);
  end loop;

  -- Warehouse users: only their warehouses' lines.
  for u in
    select p.id,
           string_agg(w.name || ': ' || c.dispatched_units || ' units out, ' || c.pending_today || ' pending, '
                      || c.late_now || ' late, ' || c.absent || ' absent', E'\n' order by w.sort_order, w.name) as body
    from public.profiles p
    join public.user_warehouses uw on uw.user_id = p.id
    join public.warehouses w on w.id = uw.warehouse_id
    join public.closing_reports c on c.warehouse_id = uw.warehouse_id and c.day = v_today
    where p.active and p.role = 'warehouse'
    group by p.id
  loop
    perform private.notify_user(u.id, 'closing_report', v_title, u.body, null, null);
  end loop;
end $function$
;

drop table if exists private.order_run_seen;
