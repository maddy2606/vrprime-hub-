-- A paused pending or daily run that is overtaken by a newer one is closed, so two copies never queue up.
create or replace function private.start_order_run(p_kind text, p_trigger text, p_user uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  r uuid;
  v_kind text;
begin
  perform pg_advisory_xact_lock(hashtext('orders_sync'));

  update public.order_runs
  set status = 'failed', error = 'Stopped: no progress for 15 minutes', finished_at = now(), lease_until = null, updated_at = now()
  where status in ('queued', 'running') and kind <> 'backfill' and updated_at < now() - interval '15 minutes';

  select id, kind into r, v_kind from public.order_runs
  where status in ('queued', 'running') order by created_at desc limit 1;
  if r is not null then
    if v_kind = 'backfill' and p_kind <> 'backfill' then
      update public.order_runs set status = 'paused', lease_until = null, updated_at = now() where id = r;
    else
      return r;
    end if;
  end if;

  update public.order_runs
  set status = 'failed', error = 'Replaced by a newer run', finished_at = now(), lease_until = null, updated_at = now()
  where status = 'paused' and kind = p_kind and kind <> 'backfill';

  insert into public.order_runs (kind, trigger, requested_by, plan)
  values (p_kind, p_trigger, p_user, private.order_plan(p_kind))
  returning id into r;
  perform private.call_function('orders-sync', jsonb_build_object('job', 'start', 'run_id', r));
  return r;
end $$;

revoke all on function private.start_order_run(text, text, uuid) from public, anon;
grant execute on function private.start_order_run(text, text, uuid) to service_role;
