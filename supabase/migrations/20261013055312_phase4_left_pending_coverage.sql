-- Finishing a run. An order the run did not return has moved on only if the run read its warehouse,
-- in every pre-dispatch state (it may have changed state), over a dispatch window holding its
-- dispatch-by. Orders due later than the run looked are left alone: they are still upcoming.
-- Before, the 2-day pending sweep marked every order due later than that as gone (left_pending).
-- The nightly upcoming sweep is finished the same way. Retention is unchanged.
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

  update public.order_runs
  set status = 'done', error = null, finished_at = now(), lease_until = null, updated_at = now(),
      notes = jsonb_build_object('left_pending', v_left, 'alerted', v_alerts)
  where id = p_run;
  return jsonb_build_object('ok', true, 'left_pending', v_left, 'alerted', v_alerts);
end $$;

revoke all on function public.orders_run_finish(uuid) from public, anon, authenticated;
grant execute on function public.orders_run_finish(uuid) to service_role;
