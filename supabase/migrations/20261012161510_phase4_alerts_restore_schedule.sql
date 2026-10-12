-- Alerts: only Active orders (dispatch-after reached) that are not Under Processing. Flipkart says
-- Under Processing delays do not count against account health. Those orders are not marked either,
-- so one that comes back to To Pack can still be alerted.
create or replace function private.orders_raise_alerts() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_total integer := 0;
  v_first timestamptz;
  v_lines text;
  v_title text;
  v_body text;
  u uuid;
begin
  update public.fk_order_items
  set alerted_at = now()
  where platform = 'flipkart' and stage = 'pending' and not hold and alerted_at is null
    and dispatch_by is not null and dispatch_by < now() - interval '1 hour';

  with hit as (
    update public.fk_order_items o
    set alerted_at = now()
    where o.platform = 'flipkart' and o.stage = 'pending' and not o.hold and o.alerted_at is null
      and coalesce(o.item_status, '') not in ('PACKING_IN_PROGRESS', 'CANCELLED')
      and (o.dispatch_after is null or o.dispatch_after <= now())
      and o.dispatch_by is not null and o.dispatch_by <= now() + interval '4 hours'
    returning o.order_id, o.warehouse_id, o.dispatch_by
  ), per as (
    select coalesce(w.name, 'Unknown warehouse') as wname, count(distinct h.order_id) as n, min(h.dispatch_by) as first_due
    from hit h left join public.warehouses w on w.id = h.warehouse_id
    group by 1
  )
  select coalesce(sum(n), 0), min(first_due),
         string_agg(wname || ' ' || n, ' · ' order by n desc, wname)
  into v_total, v_first, v_lines
  from per;

  if v_total = 0 then
    return 0;
  end if;

  v_title := case when v_total = 1 then '1 order may miss its dispatch deadline'
                  else v_total || ' orders may miss their dispatch deadline' end;
  v_body := v_lines || ' · earliest ' || to_char(v_first at time zone 'Asia/Kolkata', 'FMDD Mon, FMHH12:MI am');

  for u in select id from public.profiles where active and role in ('owner', 'manager') loop
    insert into public.notifications (user_id, kind, title, body) values (u, 'dispatch_risk', v_title, v_body);
  end loop;
  return v_total;
end $$;

-- Put back the orders the 2-day sweep marked as gone while they were still upcoming.
update public.fk_order_items
set stage = 'pending'
where platform = 'flipkart' and stage = 'left_pending' and dispatch_by > now();

-- The upcoming sweep every night at 17:00 UTC = 22:30 IST, after the last pending sweep (22:00 IST).
-- It pauses the 30-day backfill while it works; the backfill carries on afterwards.
select cron.unschedule(jobname) from cron.job where jobname = 'orders-upcoming';
select cron.schedule('orders-upcoming', '0 17 * * *', $$select private.start_order_run('upcoming', 'cron', null)$$);
