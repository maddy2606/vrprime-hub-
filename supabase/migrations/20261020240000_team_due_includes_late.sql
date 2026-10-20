-- Team page: orders still waiting whose dispatch time has already passed (late) now count as due today, since they still
-- have to go out today. Before, only orders due today or later were counted, so a late order vanished from the plan.

create or replace function public.team_order_load(p_days integer default 35) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with b as (
    select (now() at time zone 'Asia/Kolkata')::date as today, least(greatest(coalesce(p_days, 35), 7), 90) as d
  )
  select coalesce(jsonb_agg(r), '[]'::jsonb)
  from (
    select 'placed'::text as kind, i.order_day as day, i.warehouse_id, count(distinct i.order_id)::integer as orders
    from public.fk_order_items i, b
    where i.platform = 'flipkart' and i.stage <> 'cancelled' and i.order_day between b.today - b.d and b.today
    group by i.order_day, i.warehouse_id
    union all
    select 'due', greatest((i.dispatch_by at time zone 'Asia/Kolkata')::date, b.today), i.warehouse_id, count(distinct i.order_id)::integer
    from public.fk_order_items i, b
    where i.platform = 'flipkart' and i.stage = 'pending' and not i.hold and i.dispatch_by is not null
      and (i.dispatch_by at time zone 'Asia/Kolkata')::date between b.today - 30 and b.today + 21
    group by 2, 3
  ) r
$$;
revoke all on function public.team_order_load(integer) from public, anon;
grant execute on function public.team_order_load(integer) to authenticated, service_role;
