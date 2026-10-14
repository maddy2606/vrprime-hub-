-- Small series for the Command Deck sparklines. Read-only, security invoker: row security limits every number to the
-- warehouses the signed-in person can see, exactly as on the pages themselves.
--   stock    per stock snapshot (last 14): units in stock, SKUs out of stock, SKUs low, active listings only
--   due      pending orders per dispatch-by day, from 3 days ago to 6 days ahead (Active and Upcoming, not on hold)
--   tickets  tickets raised per day, last 14 days

create or replace function public.deck_series(p_low integer default 100) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with snaps as (
    select distinct l.snapshot_date d from public.stock_levels l where l.platform = 'flipkart' order by 1 desc limit 14
  ), per_sku as (
    select l.snapshot_date d, l.sku, sum(l.inventory) total, min(l.inventory) least_cell
    from public.stock_levels l
    join public.stock_listings s on s.platform = l.platform and s.sku = l.sku and s.status = 'ACTIVE'
    where l.platform = 'flipkart' and l.snapshot_date in (select d from snaps)
    group by 1, 2
  ), stock as (
    select d, sum(total)::bigint units,
           count(*) filter (where total = 0)::int out_n,
           count(*) filter (where total > 0 and least_cell < p_low)::int low_n
    from per_sku group by d
  ), days as (
    select g::date d from generate_series((now() at time zone 'Asia/Kolkata')::date - 3, (now() at time zone 'Asia/Kolkata')::date + 6, interval '1 day') g
  ), due as (
    select (i.dispatch_by at time zone 'Asia/Kolkata')::date d, count(distinct i.order_id)::int n
    from public.fk_order_items i
    where i.platform = 'flipkart' and i.stage = 'pending' and not i.hold and i.dispatch_by is not null
      and i.dispatch_by >= (((now() at time zone 'Asia/Kolkata')::date - 3)::timestamp at time zone 'Asia/Kolkata')
    group by 1
  ), tk as (
    select g::date d, (select count(*) from public.tickets t where t.raised_on = g::date)::int n
    from generate_series((now() at time zone 'Asia/Kolkata')::date - 13, (now() at time zone 'Asia/Kolkata')::date, interval '1 day') g
  )
  select jsonb_build_object(
    'stock', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'units', units, 'out', out_n, 'low', low_n) order by d) from stock), '[]'::jsonb),
    'due', (select jsonb_agg(jsonb_build_object('day', days.d, 'n', coalesce(due.n, 0)) order by days.d) from days left join due on due.d = days.d),
    'tickets', (select jsonb_agg(jsonb_build_object('day', d, 'n', n) order by d) from tk)
  );
$$;
revoke all on function public.deck_series(integer) from public, anon;
grant execute on function public.deck_series(integer) to authenticated, service_role;
