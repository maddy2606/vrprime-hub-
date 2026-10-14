-- Daily dispatch totals, kept ready so days of cover and the forecast do not have to add up ~40,000 order rows on every page.
-- dispatch_day = the IST date of dispatch_by for orders in stage 'dispatched' (the same basis as before). Rebuilt at the end of every
-- successful order run (it is a few thousand rows), so it is never more than one sync behind. The numbers do not change.

create table public.dispatch_daily (
  platform text not null default 'flipkart',
  sku text not null,
  dispatch_day date not null,
  warehouse_id uuid references public.warehouses (id),
  units integer not null check (units >= 0)
);
-- A warehouse can be empty on an order, so the key treats "no warehouse" as one value.
create unique index dispatch_daily_key on public.dispatch_daily (platform, sku, dispatch_day, coalesce(warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index dispatch_daily_day_idx on public.dispatch_daily (dispatch_day);
create index dispatch_daily_wh_idx on public.dispatch_daily (warehouse_id);

alter table public.dispatch_daily enable row level security;
-- Same rule as the orders they come from: staff see all, warehouse people see their own warehouses.
create policy dispatch_daily_select on public.dispatch_daily for select to authenticated
  using (
    (select private.is_staff())
    or ((select private.user_role()) = 'warehouse'
        and warehouse_id in (select uw.warehouse_id from public.user_warehouses uw where uw.user_id = (select auth.uid())))
  );
revoke all on public.dispatch_daily from public, anon;
grant select on public.dispatch_daily to authenticated;
grant all on public.dispatch_daily to service_role;

create or replace function private.dispatch_daily_refresh() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  delete from public.dispatch_daily;
  insert into public.dispatch_daily (platform, sku, dispatch_day, warehouse_id, units)
  select i.platform, i.sku, (i.dispatch_by at time zone 'Asia/Kolkata')::date, i.warehouse_id, sum(i.quantity)::integer
  from public.fk_order_items i
  where i.stage = 'dispatched' and i.sku is not null and i.dispatch_by is not null
  group by 1, 2, 3, 4;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function private.dispatch_daily_refresh() from public, anon, authenticated;
grant execute on function private.dispatch_daily_refresh() to service_role;

select private.dispatch_daily_refresh();

create or replace function public.orders_run_finish(p_run uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
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
end $$;

revoke all on function public.orders_run_finish(uuid) from public, anon, authenticated;
grant execute on function public.orders_run_finish(uuid) to service_role;

-- The forecast reads the totals instead of the order rows. Same window, same maths, same result.
create or replace function public.flipkart_forecast(p_days integer default 30) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_yesterday date := (now() at time zone 'Asia/Kolkata')::date - 1;
  v_days integer := case when p_days in (7, 14, 30) then p_days else 30 end;
  v_first date;
  v_start date;
  v_used integer;
  v_snapshot date := public.flipkart_snapshot_date();
  v_rows jsonb;
begin
  select min(d.dispatch_day) into v_first from public.dispatch_daily d where d.platform = 'flipkart';

  if v_first is null or v_first > v_yesterday then
    v_start := v_yesterday + 1;
    v_used := 0;
  else
    v_start := greatest(v_yesterday - v_days + 1, v_first);
    v_used := v_yesterday - v_start + 1;
  end if;

  with disp as (
    select d.sku, d.warehouse_id, sum(d.units)::bigint as units
    from public.dispatch_daily d
    where d.platform = 'flipkart' and d.dispatch_day >= v_start and d.dispatch_day <= v_yesterday
    group by d.sku, d.warehouse_id
  ), stock as (
    select s.sku, s.warehouse_id, sum(s.inventory)::bigint as units
    from public.stock_levels s
    where s.platform = 'flipkart' and s.snapshot_date = v_snapshot
    group by s.sku, s.warehouse_id
  ), keys as (
    select sku, warehouse_id from disp
    union select sku, warehouse_id from stock where units > 0
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'sku', k.sku, 'wid', k.warehouse_id, 'title', l.title,
           'disp', coalesce(d.units, 0), 'stock', coalesce(st.units, 0))), '[]'::jsonb)
  into v_rows
  from keys k
  left join disp d on d.sku = k.sku and d.warehouse_id is not distinct from k.warehouse_id
  left join stock st on st.sku = k.sku and st.warehouse_id is not distinct from k.warehouse_id
  left join public.stock_listings l on l.platform = 'flipkart' and l.sku = k.sku;

  return jsonb_build_object('today', v_today, 'window_start', v_start, 'window_end', v_yesterday, 'days', v_used,
                            'asked', v_days, 'history_from', v_first, 'snapshot', v_snapshot, 'rows', v_rows);
end $$;
revoke all on function public.flipkart_forecast(integer) from public, anon;
grant execute on function public.flipkart_forecast(integer) to authenticated, service_role;

-- A per-day series for the Command Deck chart (orders dispatched per day), by the same totals.
create or replace function public.dispatch_series(p_days integer default 7) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('day', g.day, 'units', coalesce(t.units, 0)) order by g.day), '[]'::jsonb)
  from generate_series(((now() at time zone 'Asia/Kolkata')::date - least(greatest(p_days, 1), 60)), ((now() at time zone 'Asia/Kolkata')::date - 1), interval '1 day') as g(day)
  left join (select d.dispatch_day, sum(d.units)::bigint as units from public.dispatch_daily d where d.platform = 'flipkart' group by 1) t
    on t.dispatch_day = g.day::date;
$$;
revoke all on function public.dispatch_series(integer) from public, anon;
grant execute on function public.dispatch_series(integer) to authenticated, service_role;
