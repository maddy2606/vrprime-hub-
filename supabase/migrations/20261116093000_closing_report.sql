-- Closing report (graphite-spec 12.4): at 21:50 India time, one row per warehouse for the day (units and orders out,
-- what is still pending, attendance, returns still to check), then a notification to owners and admins with every
-- warehouse and to each warehouse user with only their warehouses. Written by the build, applied by hand after review.
-- Needs 20261116091000_return_checks.sql first (it calls public.returns_to_claim()).

create table if not exists public.closing_reports (
  day date not null,
  warehouse_id uuid not null references public.warehouses (id),
  dispatched_units integer not null default 0,
  dispatched_orders integer not null default 0,
  pending_today integer not null default 0,
  late_now integer not null default 0,
  pending_total integer not null default 0,
  present integer not null default 0,
  half_day integer not null default 0,
  absent integer not null default 0,
  on_leave integer not null default 0,
  not_marked integer not null default 0,
  returns_to_check integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (day, warehouse_id)
);

alter table public.closing_reports enable row level security;

-- Staff see every warehouse; a warehouse user only their own (the dispatch_daily rule). Only the function below writes.
drop policy if exists closing_reports_select on public.closing_reports;
create policy closing_reports_select on public.closing_reports for select to authenticated
  using (
    (select private.is_staff())
    or ((select private.user_role()) = 'warehouse'
        and warehouse_id in (select uw.warehouse_id from public.user_warehouses uw where uw.user_id = (select auth.uid())))
  );
revoke all on public.closing_reports from public, anon, authenticated;
grant select on public.closing_reports to authenticated;
grant all on public.closing_reports to service_role;

create or replace function private.closing_report() returns void
language plpgsql security definer set search_path = '' as $$
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
end $$;
revoke all on function private.closing_report() from public, anon, authenticated;

select cron.unschedule(jobname) from cron.job where jobname = 'closing-report';
select cron.schedule('closing-report', '20 16 * * *', 'select private.closing_report()');
