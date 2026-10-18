-- Alerts for the owner and admins (the bell, and a phone/PC push when push is set up):
--   stock_alert     a master is out of stock, or will run out within the cover limit (default 7 days)
--   capacity_alert  orders already booked for the next days are more than the people at a warehouse can pack
--   sync_alert      a sync failed, or nothing has been read for too long
-- The "order may miss its dispatch deadline" (RTD still pending) alert already exists and is unchanged.
-- Each alert is raised at most once per day (sync: once per 6 hours) so a lasting problem is not repeated every run.

insert into public.app_settings (key, value) values ('alert_stock_cover_days', '7'::jsonb) on conflict (key) do nothing;

create or replace function private.alert_people() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select id from public.profiles where active and role in ('owner', 'admin')
$$;

create or replace function private.alert_once(p_kind text, p_title text, p_body text, p_hours integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  u uuid;
  n integer := 0;
begin
  for u in select private.alert_people() loop
    if not exists (select 1 from public.notifications x where x.user_id = u and x.kind = p_kind and x.title = p_title
                   and x.created_at > now() - make_interval(hours => p_hours)) then
      insert into public.notifications (user_id, kind, title, body) values (u, p_kind, p_title, left(p_body, 600));
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- Low stock: stock now (all warehouses) against the last 7 full days of orders through the Flipkart links.
create or replace function private.alerts_stock() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_days numeric := coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'alert_stock_cover_days'), 7);
  v_lines text;
  v_n integer;
  v_title text;
begin
  with stock as (
    select code, sum(pieces)::numeric as pieces from public.inventory_stock group by code
  ), sold as (
    select m.id as master_id, sum(i.quantity * s.units_per_order)::numeric / 7 as per_day
    from public.fk_order_items i
    join public.sku_master s on s.channel_sku = i.sku
    join public.master_products m on m.id = s.master_id
    where i.platform = 'flipkart' and i.stage <> 'cancelled'
      and i.order_day >= (now() at time zone 'Asia/Kolkata')::date - 7 and i.order_day < (now() at time zone 'Asia/Kolkata')::date
    group by m.id
  ), hit as (
    select p.name, coalesce(st.pieces, 0) as pieces, so.per_day,
           coalesce(st.pieces, 0) / so.per_day as cover
    from sold so
    join public.master_products p on p.id = so.master_id
    left join stock st on st.code = p.code
    where so.per_day >= 1 and coalesce(st.pieces, 0) / so.per_day < v_days
  )
  select count(*), string_agg(name || ' ' || case when pieces = 0 then 'OUT' else round(cover)::text || 'd' end, ' · ' order by cover)
  into v_n, v_lines
  from (select * from hit order by cover limit 12) t;

  if v_n = 0 then
    return 0;
  end if;
  v_title := 'Stock running low: ' || v_n || case when v_n >= 12 then '+' else '' end || ' products';
  return private.alert_once('stock_alert', v_title || ' (' || to_char(now() at time zone 'Asia/Kolkata', 'FMDD Mon') || ')',
    'Under ' || v_days || ' days of cover, soonest first: ' || v_lines, 20);
end $$;

-- Capacity: orders already booked (not on hold) for each of the next 3 days, against the active people at each warehouse
-- times the lower orders-per-person figure on the Team page.
create or replace function private.alerts_capacity() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_low numeric := coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'team_orders_per_person_low'), 400);
  v_lines text;
  v_n integer;
begin
  with due as (
    select i.warehouse_id, (i.dispatch_by at time zone 'Asia/Kolkata')::date as day, count(distinct i.order_id) as orders
    from public.fk_order_items i
    where i.platform = 'flipkart' and i.stage = 'pending' and not i.hold and i.dispatch_by is not null
      and (i.dispatch_by at time zone 'Asia/Kolkata')::date between (now() at time zone 'Asia/Kolkata')::date + 1
                                                                and (now() at time zone 'Asia/Kolkata')::date + 3
    group by 1, 2
  ), people as (
    select warehouse_id, count(*)::numeric as n from public.staff where active group by 1
  ), over as (
    select w.name, d.day, d.orders, coalesce(p.n, 0) * v_low as cap
    from due d
    join public.warehouses w on w.id = d.warehouse_id
    left join people p on p.warehouse_id = d.warehouse_id
    where d.orders > coalesce(p.n, 0) * v_low
  )
  select count(*), string_agg(name || ' ' || to_char(day, 'FMDD Mon') || ': ' || orders || ' orders, room for ' || round(cap)::text, ' · ' order by day, name)
  into v_n, v_lines
  from over;

  if v_n = 0 then
    return 0;
  end if;
  return private.alert_once('capacity_alert', 'More orders booked than the team can pack (' || to_char(now() at time zone 'Asia/Kolkata', 'FMDD Mon') || ')',
    v_lines || '. See the Team page to plan extra people.', 20);
end $$;

-- Sync health: the VR Prime read, the Flipkart stock read and the Flipkart orders read (the last only in working hours).
create or replace function private.alerts_sync() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_ist integer := extract(hour from now() at time zone 'Asia/Kolkata');
  v_sent integer := 0;
  s record;
  v_last timestamptz;
  v_fail text;
begin
  select * into s from public.inventory_sync_state limit 1;
  if found and (s.last_error is not null or s.last_ok_at is null or s.last_ok_at < now() - interval '7 hours') then
    v_sent := v_sent + private.alert_once('sync_alert', 'VR Prime stock sync is not working',
      coalesce(s.last_error, 'No successful read for more than 7 hours.') || ' Forecasting is using older stock.', 6);
  end if;

  select status into v_fail from public.stock_runs order by created_at desc limit 1;
  select max(finished_at) into v_last from public.stock_runs where status = 'done';
  if v_fail = 'failed' or v_last is null or v_last < now() - interval '30 hours' then
    v_sent := v_sent + private.alert_once('sync_alert', 'Flipkart stock sync is not working',
      case when v_fail = 'failed' then 'The last run failed.' else 'No good run for more than 30 hours.' end, 6);
  end if;

  if v_ist between 8 and 22 then
    select max(finished_at) into v_last from public.order_runs where status = 'done';
    if v_last is null or v_last < now() - interval '3 hours' then
      v_sent := v_sent + private.alert_once('sync_alert', 'Flipkart orders have not been read for 3 hours',
        'Order numbers, dispatch deadlines and alerts may be out of date. Try Sync now in the top bar.', 6);
    end if;
  end if;
  return v_sent;
end $$;

revoke all on function private.alert_people(), private.alert_once(text, text, text, integer), private.alerts_stock(), private.alerts_capacity(), private.alerts_sync() from public, anon, authenticated;

-- The bell and the push both cover the new kinds.
drop trigger notifications_push on public.notifications;
create trigger notifications_push after insert on public.notifications
  for each row when (new.kind in ('assigned', 'comment', 'done', 'test', 'dispatch_risk', 'listing_live', 'listing_not_found', 'money_reminder',
                                  'stock_alert', 'capacity_alert', 'sync_alert'))
  execute function private.notifications_push();

-- Stock and capacity: 8:30 am IST (03:00 UTC), after the night's sync. Sync health: every hour.
select cron.unschedule(jobname) from cron.job where jobname in ('alerts-stock', 'alerts-capacity', 'alerts-sync');
select cron.schedule('alerts-stock', '0 3 * * *', $$select private.alerts_stock()$$);
select cron.schedule('alerts-capacity', '5 3 * * *', $$select private.alerts_capacity()$$);
select cron.schedule('alerts-sync', '10 * * * *', $$select private.alerts_sync()$$);
