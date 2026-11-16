-- Order syncs write only changed lines, and the closing report counts today's handovers.
-- PROPOSAL: kept out of supabase/migrations so `supabase db push` does not apply it. Approved on 16 Nov 2026; to be
-- tested on a Postgres 17 test database first, and deployed only once the nightly backup works and has been restored.
--
-- A. Order syncs write only the lines whose values changed.
--    Until now every run rewrote every line it read (3,700-4,800 per pending run), changed or not, because the upsert
--    always set last_seen_at and last_run_id. last_run_id is indexed, so none of those updates could be HOT: each wrote
--    a new copy of the row and an entry in all 10 indexes of fk_order_items (4.12 million updates against 172,000
--    inserts, 1.5% HOT, when measured). Now a line is written only when one of its values changes, and:
--      * "which pending lines did this run see" (the finish step moves the unseen ones off the pending list) comes from
--        private.order_run_seen instead of last_run_id. The table is UNLOGGED and is emptied with TRUNCATE. A restart
--        empties an unlogged table, so the finish step first checks the table still holds every line the run saw (a
--        count kept in order_runs.notes, which is logged) and skips that step for the run if not.
--      * shipped orders ('post' parts) are still always written, because flipkart_in_transit() reads their last_seen_at.
--      * a line that is inserted or changes is written exactly as before, last_seen_at and last_run_id included.
--    items_saved and returns_saved still count lines read, so the Sync page's numbers do not change; notes.changed
--    counts the lines actually written.
--
-- B. Closing report (21:50).
--    1. Units out and Orders out were 0 everywhere: the report counted only lines in stage 'dispatched', which a line
--       reaches only when the 09:10 or 22:30 run reads Flipkart's shipped list. A line now records when it left the
--       pending list (fk_order_items.left_pending_at), and the report counts the lines that left since the last closing
--       report (the first report under this rule starts at midnight), except those whose last status was APPROVED or
--       FORM_FAILED: they left before being packed, so they were cancelled, not handed over. Each report row keeps the
--       window it counted (closing_reports.out_from, out_to); the next report starts where the last one ended.
--    2. "Pending for today" and "Late now" leave out Under Processing orders, by the Orders tab's own rule
--       (public.fk_pending_orders, bucket = 'processing'). Pending total is unchanged. The notification text is built
--       from the same columns, so it follows.
--
-- Nothing is deleted. orders_run_finish keeps its existing retention lines unchanged (they are a separate question).
-- Undo: supabase/proposals/20261116130000_orders_changed_only_and_closing_report.rollback.sql
-- Test: supabase/tests/orders_changed_only_and_closing_report_check.sql


create unlogged table if not exists private.order_run_seen (
  run_id uuid not null,
  order_item_id text not null,
  primary key (run_id, order_item_id)
);
revoke all on table private.order_run_seen from public, anon, authenticated;

alter table public.fk_order_items add column if not exists left_pending_at timestamptz;
comment on column public.fk_order_items.left_pending_at is
  'When a sync last moved this line off the pending list (stage left_pending). The closing report counts these.';

alter table public.closing_reports add column if not exists out_from timestamptz;
alter table public.closing_reports add column if not exists out_to timestamptz;
comment on column public.closing_reports.out_to is
  'Units and orders out count lines that left the pending list after out_from and up to out_to; the next report starts at out_to.';

-- Lines that already left the pending list: they left when the first pending or upcoming run after the one that last
-- saw them finished. Only lines still in stage left_pending can be dated this way (a shipped line's last_seen_at has
-- been moved on by the daily run).
update public.fk_order_items i
set left_pending_at = coalesce((
      select min(r.finished_at) from public.order_runs r
      where r.kind in ('pending', 'upcoming') and r.status = 'done'
        and r.finished_at > i.last_seen_at and r.id is distinct from i.last_run_id), i.last_seen_at)
where i.stage = 'left_pending' and i.left_pending_at is null and i.last_seen_at is not null;

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
  v_rc integer;
  v_seen integer := 0;     -- pending-list lines newly marked as seen by this run
  v_changed integer := 0;  -- lines inserted or actually changed (an unchanged line is not written)
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

      -- The finish step needs to know which pending lines this run saw (it used to read last_run_id for that).
      if v_t = 'pre' then
        insert into private.order_run_seen (run_id, order_item_id) values (p_run, it ->> 'order_item_id')
        on conflict do nothing;
        get diagnostics v_rc = row_count;
        v_seen := v_seen + v_rc;
      end if;

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
        last_run_id = p_run
      -- Only when something changed. Shipped orders are always written: flipkart_in_transit() reads their last_seen_at.
      where v_t = 'post'
         or (t.order_id, t.shipment_id, t.sku, t.quantity, t.order_date, t.order_day, t.location_id, t.warehouse_id,
             t.stage, t.item_status, t.hold, t.dispatch_by, t.dispatch_after, t.cancel_type, t.cancelled_at,
             t.cancel_reason, t.cancel_sub_reason, t.selling_price)
            is distinct from
            (excluded.order_id, coalesce(excluded.shipment_id, t.shipment_id), coalesce(excluded.sku, t.sku),
             excluded.quantity, coalesce(excluded.order_date, t.order_date), coalesce(excluded.order_day, t.order_day),
             coalesce(excluded.location_id, t.location_id), coalesce(excluded.warehouse_id, t.warehouse_id),
             excluded.stage, excluded.item_status, excluded.hold,
             coalesce(excluded.dispatch_by, t.dispatch_by), coalesce(excluded.dispatch_after, t.dispatch_after),
             coalesce(excluded.cancel_type, t.cancel_type), coalesce(excluded.cancelled_at, t.cancelled_at),
             coalesce(excluded.cancel_reason, t.cancel_reason), coalesce(excluded.cancel_sub_reason, t.cancel_sub_reason),
             coalesce(excluded.selling_price, t.selling_price));
      get diagnostics v_rc = row_count;
      v_changed := v_changed + v_rc;
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
        last_run_id = p_run
      where (t.order_id, t.source, t.sku, t.quantity, t.location_id, t.warehouse_id, t.return_status, t.reason,
             t.sub_reason, t.shipment_status, t.updated_date)
            is distinct from
            (coalesce(excluded.order_id, t.order_id), excluded.source, coalesce(t.sku, excluded.sku), excluded.quantity,
             coalesce(excluded.location_id, t.location_id), coalesce(excluded.warehouse_id, t.warehouse_id),
             excluded.return_status, excluded.reason, excluded.sub_reason, excluded.shipment_status, excluded.updated_date);
      get diagnostics v_rc = row_count;
      v_changed := v_changed + v_rc;
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
      -- seen: checked by the finish step against order_run_seen; changed: lines actually written.
      notes = notes || jsonb_build_object('seen', coalesce((notes ->> 'seen')::integer, 0) + v_seen,
                                          'changed', coalesce((notes ->> 'changed')::integer, 0) + v_changed),
      updated_at = now()
  where id = p_run;

  return jsonb_build_object('saved', v_saved, 'returns', v_returns, 'changed', v_changed);
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
  v_seen_rows integer;
  v_seen_lost boolean := false;
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
    -- order_run_seen is UNLOGGED (cheap to write), so a database restart empties it. If it no longer holds every line
    -- this run saw, nothing is moved off the pending list this time; the next run does it.
    select count(*) into v_seen_rows from private.order_run_seen where run_id = p_run;
    v_seen_lost := v_seen_rows <> coalesce((r.notes ->> 'seen')::integer, 0);
  end if;
  if r.kind in ('pending', 'upcoming') and not v_seen_lost then
    update public.fk_order_items o
    set stage = 'left_pending', left_pending_at = now()
    where o.platform = 'flipkart' and o.stage = 'pending'
      and not exists (select 1 from private.order_run_seen s where s.run_id = p_run and s.order_item_id = o.order_item_id)
      and o.location_id is not null and o.dispatch_by is not null
      and not exists (
        select 1 from unnest(array['APPROVED', 'PACKING_IN_PROGRESS', 'PACKED', 'READY_TO_DISPATCH', 'FORM_FAILED']) s(state)
        where not exists (
          select 1 from jsonb_array_elements(r.plan) p
          where p ->> 't' = 'pre' and p ->> 'state' = s.state and p ->> 'loc' = o.location_id
            and (p ->> 'from') is not null and (p ->> 'to') is not null
            and (p ->> 'from')::timestamptz <= o.dispatch_by and o.dispatch_by <= (p ->> 'to')::timestamptz));
    get diagnostics v_left = row_count;
  end if;
  if r.kind in ('pending', 'upcoming') then
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
              || jsonb_strip_nulls(jsonb_build_object('changed', (r.notes ->> 'changed')::integer,
                                                      'seen_lost', case when v_seen_lost then true end))
  where id = p_run;
  -- Empty the seen table, unless another run may still be using it. Its lines carry their run id, so leftovers never
  -- affect another run, and the next run that finishes alone empties them.
  if not exists (select 1 from public.order_runs where id <> p_run and status in ('queued', 'running', 'paused')) then
    truncate private.order_run_seen;
  end if;
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
  -- Units and orders out cover the lines that left the pending list since the last closing report (so a handover
  -- after 21:50 is in the next day's report). The first report under this rule starts at today's midnight.
  v_to timestamptz := now();
  v_from timestamptz := coalesce((select max(c.out_to) from public.closing_reports c where c.day < (now() at time zone 'Asia/Kolkata')::date),
                                 (now() at time zone 'Asia/Kolkata')::date::timestamp at time zone 'Asia/Kolkata');
  v_body text;
  u record;
begin
  with wh as (
    select w.id from public.warehouses w
  ), outs as (
    -- Handed over since the last report: lines that left the pending list and were not cancelled before packing.
    -- They are still 'left_pending' until Flipkart's shipped list is read, or already 'dispatched' if it has been.
    select i.warehouse_id, sum(i.quantity)::integer as units, count(distinct i.order_id)::integer as orders
    from public.fk_order_items i
    where i.platform = 'flipkart' and i.stage in ('left_pending', 'dispatched')
      and i.left_pending_at > v_from and i.left_pending_at <= v_to
      and coalesce(i.item_status, '') not in ('APPROVED', 'FORM_FAILED')
      and i.warehouse_id is not null
    group by 1
  ), pend as (
    -- Due today or earlier and late: the same pending lines as the Orders tab, without its "Under Processing" ones
    -- (Flipkart's own work, not the warehouse's). Pending total still counts every pending line.
    select v.warehouse_id,
           count(distinct v.order_id) filter (where v.bucket is distinct from 'processing' and v.dispatch_by is not null
                                                and (v.dispatch_by at time zone 'Asia/Kolkata')::date <= v_today)::integer as today_n,
           count(distinct v.order_id) filter (where v.bucket is distinct from 'processing' and v.dispatch_by is not null
                                                and (v.dispatch_by at time zone 'Asia/Kolkata')::date <= v_today
                                                and v.dispatch_by < now())::integer as late_n,
           count(distinct v.order_id)::integer as total_n
    from public.fk_pending_orders v
    where not v.hold
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
                                           pending_total, present, half_day, absent, on_leave, not_marked, returns_to_check,
                                           out_from, out_to)
  select v_today, wh.id,
         coalesce(o.units, 0), coalesce(o.orders, 0), coalesce(p.today_n, 0), coalesce(p.late_n, 0), coalesce(p.total_n, 0),
         coalesce(a.present, 0), coalesce(a.half_day, 0), coalesce(a.absent, 0), coalesce(a.on_leave, 0),
         coalesce(a.not_marked, 0), coalesce(r.n, 0), v_from, v_to
  from wh
  left join outs o on o.warehouse_id = wh.id
  left join pend p on p.warehouse_id = wh.id
  left join att a on a.warehouse_id = wh.id
  left join ret r on r.warehouse_id = wh.id
  on conflict (day, warehouse_id) do update set
    dispatched_units = excluded.dispatched_units, dispatched_orders = excluded.dispatched_orders,
    pending_today = excluded.pending_today, late_now = excluded.late_now, pending_total = excluded.pending_total,
    present = excluded.present, half_day = excluded.half_day, absent = excluded.absent, on_leave = excluded.on_leave,
    not_marked = excluded.not_marked, returns_to_check = excluded.returns_to_check,
    out_from = excluded.out_from, out_to = excluded.out_to, created_at = now();

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
end $function$;
