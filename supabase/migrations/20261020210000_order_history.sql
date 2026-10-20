-- Older Flipkart orders: the one-time backfill read 30 days (back to 18 Sep 2026), so earlier days had only a few
-- cancellations. request_order_history(from, to) queues a backfill of shipped orders day by day for those dates (newest
-- first), with the cancellations of that period and the returns created since its first day. It runs at night like the
-- 30-day backfill (22:15 to 06:45 IST), and saving is the same as every sync, so an order read twice is kept once.
-- Owner only.

create or replace function public.request_order_history(p_from date, p_to date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  r uuid;
  d date;
  v_plan jsonb := '[]'::jsonb;
  v_from timestamptz;
  v_to timestamptz;
begin
  if (select private.user_role()) is distinct from 'owner'
     and coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') <> 'service_role'
     and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 92 or p_to >= (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'pick past dates, at most 3 months' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('orders_sync'));
  if exists (select 1 from public.order_runs where kind = 'backfill' and status in ('queued', 'running', 'paused')) then
    raise exception 'a backfill is already waiting or running' using errcode = '55000';
  end if;

  d := p_to;
  while d >= p_from loop
    v_from := (d::timestamp at time zone 'Asia/Kolkata');
    v_to := ((d + 1)::timestamp at time zone 'Asia/Kolkata');
    v_plan := v_plan || jsonb_build_array(jsonb_build_object('t', 'post', 'day', d, 'from', private.iso_utc(v_from), 'to', private.iso_utc(v_to)));
    d := d - 1;
  end loop;
  v_from := (p_from::timestamp at time zone 'Asia/Kolkata');
  v_to := ((p_to + 1)::timestamp at time zone 'Asia/Kolkata');
  v_plan := v_plan || jsonb_build_array(
    jsonb_build_object('t', 'cancel', 'type', 'sellerCancellation', 'from', private.iso_utc(v_from), 'to', private.iso_utc(v_to)),
    jsonb_build_object('t', 'cancel', 'type', 'buyerCancellation', 'from', private.iso_utc(v_from), 'to', private.iso_utc(v_to)),
    jsonb_build_object('t', 'returns', 'source', 'courier_return', 'since', 'createdAfter', 'at', private.iso_utc(v_from)),
    jsonb_build_object('t', 'returns', 'source', 'customer_return', 'since', 'createdAfter', 'at', private.iso_utc(v_from)));

  insert into public.order_runs (kind, trigger, requested_by, plan, status, notes)
  values ('backfill', 'manual', (select auth.uid()), v_plan, 'paused', jsonb_build_object('history', jsonb_build_object('from', p_from, 'to', p_to)))
  returning id into r;
  perform private.call_function('orders-sync', jsonb_build_object('job', 'start', 'run_id', r));
  return r;
end $$;
revoke all on function public.request_order_history(date, date) from public, anon;
grant execute on function public.request_order_history(date, date) to authenticated, service_role;
