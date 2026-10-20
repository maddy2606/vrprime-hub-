-- A history run the owner asks for (request_order_history) runs straight away instead of waiting for the night. It still
-- waits while a stock sync or another order run is going, and only one backfill runs at a time. The automatic 30-day
-- backfill keeps to the night.

create or replace function private.resume_stalled_orders() returns void
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_busy boolean;
begin
  update public.order_runs
  set status = 'failed', error = 'Stopped: took longer than 3 hours', finished_at = now(), lease_until = null, updated_at = now()
  where status in ('queued', 'running', 'paused') and kind <> 'backfill' and created_at < now() - interval '3 hours';
  update public.order_runs
  set status = 'failed', error = 'Stopped: took longer than 10 days', finished_at = now(), lease_until = null, updated_at = now()
  where status in ('queued', 'running', 'paused') and kind = 'backfill' and created_at < now() - interval '10 days';

  v_busy := exists (select 1 from public.stock_runs
                    where status in ('queued', 'running') and updated_at > now() - interval '10 minutes');

  for r in
    select id, kind, attempts, status, notes from public.order_runs
    where status in ('queued', 'running', 'paused')
      and (lease_until is null or lease_until < now())
      and updated_at < now() - interval '2 minutes'
    order by case when kind = 'backfill' then 1 else 0 end, created_at
  loop
    if r.kind = 'backfill' and not (r.notes ? 'history') and not private.is_night_ist() then
      continue;                              -- the automatic backfill sleeps through the day; an asked-for history run does not
    end if;
    if v_busy then
      continue;                              -- a stock sync is running: wait
    end if;
    if r.kind = 'backfill' and exists (select 1 from public.order_runs
                                       where kind <> 'backfill' and status in ('queued', 'running')) then
      continue;                              -- another order run is going: wait
    end if;
    if r.attempts >= 8 then
      update public.order_runs
      set status = 'failed', error = coalesce(error, 'Stopped after being interrupted too many times'),
          finished_at = now(), lease_until = null, updated_at = now()
      where id = r.id;
    else
      update public.order_runs set attempts = attempts + 1, updated_at = now() where id = r.id;
      perform private.call_function('orders-sync', jsonb_build_object('job', 'continue', 'run_id', r.id));
      exit when r.kind = 'backfill';         -- one worker at a time
    end if;
  end loop;
end $$;
