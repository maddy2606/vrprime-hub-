-- Performance: the Orders tab, Needs action and the stock cover read small, finished answers from the database
-- instead of thousands of order lines.
--
-- Everything here runs as the caller (security invoker), so a warehouse user only ever gets their own warehouses.
-- Orders are grouped the way Seller Hub counts them (shipments), and put into Seller Hub's tabs by the one rule in
-- the view fk_pending_orders (the same rule bucketOf used in the app):
--   PACKING_IN_PROGRESS                        Under Processing
--   dispatch-after still in the future         Upcoming
--   PACKED / READY_TO_DISPATCH / the rest      To Pack / To Dispatch / To Accept

create or replace view public.fk_pending_orders with (security_invoker = true) as
select o.order_item_id, o.order_id, coalesce(o.shipment_id, o.order_item_id) as shipment_key, o.sku, o.quantity,
       o.warehouse_id, o.item_status, o.hold, o.dispatch_by, o.dispatch_after,
       case
         when o.item_status = 'PACKING_IN_PROGRESS' then 'processing'
         when o.item_status is null or o.item_status not in ('APPROVED', 'FORM_FAILED', 'PACKED', 'READY_TO_DISPATCH') then null
         when o.dispatch_after > now() then 'upcoming'
         when o.item_status = 'PACKED' then 'to_pack'
         when o.item_status = 'READY_TO_DISPATCH' then 'to_dispatch'
         else 'to_accept'
       end as bucket
from public.fk_order_items o
where o.platform = 'flipkart' and o.stage = 'pending';

revoke all on public.fk_pending_orders from public, anon;
grant select on public.fk_pending_orders to authenticated, service_role;

-- The day of the latest good stock snapshot.
create or replace function public.flipkart_snapshot_date() returns date
language sql stable security invoker set search_path = '' as $$
  select snapshot_date from public.stock_runs where platform = 'flipkart' and status = 'done' order by finished_at desc limit 1
$$;
revoke all on function public.flipkart_snapshot_date() from public, anon;
grant execute on function public.flipkart_snapshot_date() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Counts per warehouse (the cards), in shipments
-- ---------------------------------------------------------------------------

create or replace function public.flipkart_order_counts() returns jsonb
language sql stable security invoker set search_path = '' as $$
  with t as (select (now() at time zone 'Asia/Kolkata')::date as today),
  p as (select * from public.fk_pending_orders where bucket is not null)
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
    select p.warehouse_id,
      count(distinct p.shipment_key) filter (where p.bucket = 'to_accept') as to_accept,
      count(distinct p.shipment_key) filter (where p.bucket = 'to_pack') as to_pack,
      count(distinct p.shipment_key) filter (where p.bucket = 'to_dispatch') as to_dispatch,
      count(distinct p.shipment_key) filter (where p.bucket = 'upcoming') as upcoming,
      count(distinct p.shipment_key) filter (where p.bucket = 'processing') as processing,
      count(distinct p.shipment_key) filter (where p.bucket in ('to_accept', 'to_pack', 'to_dispatch')) as active,
      count(distinct p.shipment_key) filter (where p.bucket in ('to_accept', 'to_pack', 'to_dispatch') and p.hold) as held,
      count(distinct p.shipment_key) filter (where p.bucket in ('to_accept', 'to_pack', 'to_dispatch') and not p.hold and p.dispatch_by < now()) as late,
      count(distinct p.shipment_key) filter (where p.bucket in ('to_accept', 'to_pack', 'to_dispatch') and not p.hold and p.dispatch_by >= now()
                                              and (p.dispatch_by at time zone 'Asia/Kolkata')::date = t.today) as today,
      count(distinct p.shipment_key) filter (where p.bucket in ('to_accept', 'to_pack', 'to_dispatch') and not p.hold
                                              and (p.dispatch_by at time zone 'Asia/Kolkata')::date = t.today + 1) as tomorrow,
      min(p.dispatch_by) filter (where p.bucket in ('to_accept', 'to_pack', 'to_dispatch') and not p.hold) as next_due
    from p, t
    group by p.warehouse_id
  ) x
$$;
revoke all on function public.flipkart_order_counts() from public, anon;
grant execute on function public.flipkart_order_counts() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- One row per SKU (Seller Hub's Smart Groups). A page at a time, searchable, sortable.
--   p_status: 'active' (To Accept + To Pack + To Dispatch) or one tab: to_accept, to_pack, to_dispatch, upcoming, processing
--   returns { total, orders, units, rows: [...] } where orders and units cover every matching SKU, not just the page
-- ---------------------------------------------------------------------------

create or replace function public.flipkart_order_skus(
  p_wh uuid default null, p_status text default 'active', p_q text default null,
  p_sort text default 'due', p_dir text default 'asc', p_limit integer default 50, p_offset integer default 0
) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_pat text := case when coalesce(btrim(p_q), '') = '' then null
                     else '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  v_col text := case p_sort when 'units' then 'units' when 'orders' then 'orders' when 'sku' then 'sku' else 'sort_due' end;
  v_dir text := case when lower(p_dir) = 'desc' then 'desc' else 'asc' end;
  v_result jsonb;
begin
  execute format($q$
    with base as (
      select o.* from public.fk_pending_orders o
      where o.bucket is not null
        and ($1 is null or o.warehouse_id = $1)
        and (case when $2 = 'active' then o.bucket in ('to_accept', 'to_pack', 'to_dispatch') else o.bucket = $2 end)
        and ($3 is null or o.sku ilike $3 or o.order_id ilike $3
             or exists (select 1 from public.stock_listings l where l.platform = 'flipkart' and l.sku = o.sku and l.title ilike $3))
    ), g as (
      select coalesce(b.sku, '') as sku,
        count(distinct coalesce(b.warehouse_id::text, '') || '|' || b.shipment_key) as orders,
        sum(b.quantity)::integer as units,
        min(b.dispatch_by) filter (where not b.hold) as due,
        min(b.dispatch_by) filter (where not b.hold and b.bucket in ('to_accept', 'to_pack', 'to_dispatch')) as active_due,
        coalesce(min(b.dispatch_by) filter (where not b.hold and b.bucket in ('to_accept', 'to_pack', 'to_dispatch')),
                 min(b.dispatch_by) filter (where not b.hold)) as sort_due,
        count(distinct coalesce(b.warehouse_id::text, '') || '|' || b.shipment_key) filter (where b.bucket = 'to_accept') as to_accept,
        count(distinct coalesce(b.warehouse_id::text, '') || '|' || b.shipment_key) filter (where b.bucket = 'to_pack') as to_pack,
        count(distinct coalesce(b.warehouse_id::text, '') || '|' || b.shipment_key) filter (where b.bucket = 'to_dispatch') as to_dispatch,
        count(distinct coalesce(b.warehouse_id::text, '') || '|' || b.shipment_key) filter (where b.bucket = 'upcoming') as upcoming,
        count(distinct coalesce(b.warehouse_id::text, '') || '|' || b.shipment_key) filter (where b.bucket = 'processing') as processing
      from base b group by coalesce(b.sku, '')
    ), by_wh as (
      select z.sku, jsonb_object_agg(z.wid, z.u) as w
      from (select coalesce(sku, '') as sku, coalesce(warehouse_id::text, '') as wid, sum(quantity)::integer as u from base group by 1, 2) z
      group by z.sku
    )
    select jsonb_build_object(
      'total', (select count(*) from g),
      'orders', (select coalesce(sum(orders), 0) from g),
      'units', (select coalesce(sum(units), 0) from g),
      'rows', coalesce((
        select jsonb_agg(to_jsonb(r)) from (
          select g.sku, l.title, g.orders, g.units, g.due, g.active_due, g.to_accept, g.to_pack, g.to_dispatch, g.upcoming, g.processing, bw.w as by_wh
          from g
          left join by_wh bw on bw.sku = g.sku
          left join public.stock_listings l on l.platform = 'flipkart' and l.sku = g.sku
          order by g.%I %s nulls last, g.sku
          limit %s offset %s
        ) r), '[]'::jsonb))
  $q$, v_col, v_dir, greatest(least(p_limit, 200), 1), greatest(p_offset, 0))
  into v_result using p_wh, coalesce(p_status, 'active'), v_pat;
  return v_result;
end $$;
revoke all on function public.flipkart_order_skus(uuid, text, text, text, text, integer, integer) from public, anon;
grant execute on function public.flipkart_order_skus(uuid, text, text, text, text, integer, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Order lines, a page at a time (the Order list, and the orders of one SKU when it is opened)
-- ---------------------------------------------------------------------------

create or replace function public.flipkart_order_lines(
  p_wh uuid default null, p_status text default 'active', p_sku text default null, p_q text default null,
  p_sort text default 'due', p_dir text default 'asc', p_limit integer default 50, p_offset integer default 0
) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_pat text := case when coalesce(btrim(p_q), '') = '' then null
                     else '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  v_col text := case p_sort when 'order' then 'order_id' when 'sku' then 'sku' when 'qty' then 'quantity'
                            when 'status' then 'bucket' when 'after' then 'dispatch_after' else 'dispatch_by' end;
  v_dir text := case when lower(p_dir) = 'desc' then 'desc' else 'asc' end;
  v_result jsonb;
begin
  execute format($q$
    with base as (
      select o.* from public.fk_pending_orders o
      where o.bucket is not null
        and ($1 is null or o.warehouse_id = $1)
        and (case when $2 = 'active' then o.bucket in ('to_accept', 'to_pack', 'to_dispatch') else o.bucket = $2 end)
        and ($3 is null or o.sku = $3)
        and ($4 is null or o.sku ilike $4 or o.order_id ilike $4)
    )
    select jsonb_build_object(
      'total', (select count(*) from base),
      'rows', coalesce((
        select jsonb_agg(to_jsonb(r)) from (
          select b.order_item_id, b.order_id, b.sku, b.quantity, b.warehouse_id, b.bucket, b.hold, b.dispatch_by, b.dispatch_after
          from base b
          order by b.%I %s nulls last, b.order_item_id
          limit %s offset %s
        ) r), '[]'::jsonb))
  $q$, v_col, v_dir, greatest(least(p_limit, 200), 1), greatest(p_offset, 0))
  into v_result using p_wh, coalesce(p_status, 'active'), p_sku, v_pat;
  return v_result;
end $$;
revoke all on function public.flipkart_order_lines(uuid, text, text, text, text, text, integer, integer) from public, anon;
grant execute on function public.flipkart_order_lines(uuid, text, text, text, text, text, integer, integer) to authenticated, service_role;

-- Stock per warehouse for one SKU, from the latest snapshot: { "<warehouse id>": units }.
create or replace function public.flipkart_sku_stock(p_sku text) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_object_agg(l.warehouse_id::text, l.inventory), '{}'::jsonb)
  from public.stock_levels l
  where l.platform = 'flipkart' and l.sku = p_sku and l.snapshot_date = public.flipkart_snapshot_date()
$$;
revoke all on function public.flipkart_sku_stock(text) from public, anon;
grant execute on function public.flipkart_sku_stock(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Pick list: what to pack at one warehouse (To Accept + To Pack, not on hold), one row per SKU
-- ---------------------------------------------------------------------------

create or replace function public.flipkart_pick_list(
  p_wh uuid, p_today_only boolean default true, p_q text default null,
  p_sort text default 'units', p_dir text default 'desc', p_limit integer default 50, p_offset integer default 0
) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_pat text := case when coalesce(btrim(p_q), '') = '' then null
                     else '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  v_col text := case p_sort when 'sku' then 'sku' when 'stock' then 'stock' when 'due' then 'due' when 'orders' then 'orders'
                            when 'accept' then 'to_accept' when 'pack' then 'to_pack' else 'units' end;
  v_dir text := case when lower(p_dir) = 'asc' then 'asc' else 'desc' end;
  v_snap date := public.flipkart_snapshot_date();
  v_result jsonb;
begin
  execute format($q$
    with base as (
      select o.* from public.fk_pending_orders o
      where o.warehouse_id = $1 and not o.hold and o.bucket in ('to_accept', 'to_pack')
        and (not $2 or (o.dispatch_by is not null and (o.dispatch_by at time zone 'Asia/Kolkata')::date <= (now() at time zone 'Asia/Kolkata')::date))
        and ($3 is null or o.sku ilike $3
             or exists (select 1 from public.stock_listings l where l.platform = 'flipkart' and l.sku = o.sku and l.title ilike $3))
    ), g as (
      select coalesce(b.sku, '') as sku,
        sum(b.quantity)::integer as units,
        coalesce(sum(b.quantity) filter (where b.bucket = 'to_accept'), 0)::integer as to_accept,
        coalesce(sum(b.quantity) filter (where b.bucket = 'to_pack'), 0)::integer as to_pack,
        count(distinct b.shipment_key) as orders,
        min(b.dispatch_by) as due
      from base b group by coalesce(b.sku, '')
    ), j as (
      select g.*, l.title, s.inventory as stock
      from g
      left join public.stock_listings l on l.platform = 'flipkart' and l.sku = g.sku
      left join public.stock_levels s on s.platform = 'flipkart' and s.snapshot_date = $4 and s.sku = g.sku and s.warehouse_id = $1
    )
    select jsonb_build_object(
      'total', (select count(*) from j),
      'units', (select coalesce(sum(units), 0) from j),
      'rows', coalesce((
        select jsonb_agg(to_jsonb(r)) from (
          select j.sku, j.title, j.units, j.to_accept, j.to_pack, j.orders, j.due, j.stock
          from j order by j.%I %s nulls last, j.sku
          limit %s offset %s
        ) r), '[]'::jsonb))
  $q$, v_col, v_dir, greatest(least(p_limit, 200), 1), greatest(p_offset, 0))
  into v_result using p_wh, coalesce(p_today_only, true), v_pat, v_snap;
  return v_result;
end $$;
revoke all on function public.flipkart_pick_list(uuid, boolean, text, text, text, integer, integer) from public, anon;
grant execute on function public.flipkart_pick_list(uuid, boolean, text, text, text, integer, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Upcoming vs stock: per SKU and warehouse, upcoming units against the stock there now
-- ---------------------------------------------------------------------------

create or replace function public.flipkart_upcoming_vs_stock(
  p_wh uuid default null, p_short_only boolean default false, p_q text default null,
  p_sort text default 'short', p_dir text default 'desc', p_limit integer default 50, p_offset integer default 0
) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_pat text := case when coalesce(btrim(p_q), '') = '' then null
                     else '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  v_col text := case p_sort when 'sku' then 'sku' when 'upcoming' then 'upcoming' when 'stock' then 'stock' when 'first' then 'first_active'
                            when 'orders' then 'orders' when 'active' then 'active' else 'short' end;
  v_dir text := case when lower(p_dir) = 'asc' then 'asc' else 'desc' end;
  v_snap date := public.flipkart_snapshot_date();
  v_result jsonb;
begin
  execute format($q$
    with base as (
      select o.* from public.fk_pending_orders o
      where o.warehouse_id is not null and o.bucket in ('upcoming', 'to_accept', 'to_pack', 'to_dispatch')
        and ($1 is null or o.warehouse_id = $1)
        and ($3 is null or o.sku ilike $3
             or exists (select 1 from public.stock_listings l where l.platform = 'flipkart' and l.sku = o.sku and l.title ilike $3))
    ), g as (
      select coalesce(b.sku, '') as sku, b.warehouse_id,
        coalesce(sum(b.quantity) filter (where b.bucket = 'upcoming'), 0)::integer as upcoming,
        count(distinct b.shipment_key) filter (where b.bucket = 'upcoming') as orders,
        min(b.dispatch_after) filter (where b.bucket = 'upcoming') as first_active,
        coalesce(sum(b.quantity) filter (where b.bucket <> 'upcoming'), 0)::integer as active
      from base b group by coalesce(b.sku, ''), b.warehouse_id
      having coalesce(sum(b.quantity) filter (where b.bucket = 'upcoming'), 0) > 0
    ), j as (
      select g.*, l.title, s.inventory as stock,
             case when s.inventory is null then 0 else greatest(0, g.upcoming - s.inventory) end as short
      from g
      left join public.stock_listings l on l.platform = 'flipkart' and l.sku = g.sku
      left join public.stock_levels s on s.platform = 'flipkart' and s.snapshot_date = $4 and s.sku = g.sku and s.warehouse_id = g.warehouse_id
    ), f as (select * from j where not $2 or short > 0)
    select jsonb_build_object(
      'total', (select count(*) from f),
      'short_count', (select count(*) from j where short > 0),
      'rows', coalesce((
        select jsonb_agg(to_jsonb(r)) from (
          select f.sku, f.title, f.warehouse_id, f.upcoming, f.orders, f.first_active, f.active, f.stock, f.short
          from f order by f.%I %s nulls last, f.sku, f.warehouse_id
          limit %s offset %s
        ) r), '[]'::jsonb))
  $q$, v_col, v_dir, greatest(least(p_limit, 200), 1), greatest(p_offset, 0))
  into v_result using p_wh, coalesce(p_short_only, false), v_pat, v_snap;
  return v_result;
end $$;
revoke all on function public.flipkart_upcoming_vs_stock(uuid, boolean, text, text, text, integer, integer) from public, anon;
grant execute on function public.flipkart_upcoming_vs_stock(uuid, boolean, text, text, text, integer, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Cancellations: counts per day (14 days) and totals (30 days), then lines a page at a time
-- ---------------------------------------------------------------------------

create or replace function public.flipkart_cancel_summary(p_wh uuid default null) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with t as (select (now() at time zone 'Asia/Kolkata')::date as today),
  c as (
    select (o.cancelled_at at time zone 'Asia/Kolkata')::date as day, o.cancel_type
    from public.fk_order_items o, t
    where o.platform = 'flipkart' and o.stage = 'cancelled' and o.cancel_type is not null and o.cancelled_at is not null
      and (p_wh is null or o.warehouse_id = p_wh)
      and (o.cancelled_at at time zone 'Asia/Kolkata')::date > t.today - 30
  )
  select jsonb_build_object(
    'seller_total', (select count(*) from c where cancel_type = 'seller'),
    'buyer_total', (select count(*) from c where cancel_type = 'buyer'),
    'days', (
      select jsonb_agg(jsonb_build_object('day', d.day, 'seller', coalesce(x.seller, 0), 'buyer', coalesce(x.buyer, 0)) order by d.day desc)
      from t, generate_series(t.today - 13, t.today, interval '1 day') g(day), lateral (select g.day::date as day) d
      left join (select day, count(*) filter (where cancel_type = 'seller') as seller, count(*) filter (where cancel_type = 'buyer') as buyer from c group by day) x on x.day = d.day))
$$;
revoke all on function public.flipkart_cancel_summary(uuid) from public, anon;
grant execute on function public.flipkart_cancel_summary(uuid) to authenticated, service_role;

create or replace function public.flipkart_cancel_lines(
  p_wh uuid default null, p_type text default null, p_q text default null,
  p_sort text default 'date', p_dir text default 'desc', p_limit integer default 50, p_offset integer default 0
) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_pat text := case when coalesce(btrim(p_q), '') = '' then null
                     else '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  v_col text := case p_sort when 'type' then 'cancel_type' when 'sku' then 'sku' when 'order' then 'order_id' when 'qty' then 'quantity' else 'cancelled_at' end;
  v_dir text := case when lower(p_dir) = 'asc' then 'asc' else 'desc' end;
  v_result jsonb;
begin
  execute format($q$
    with base as (
      select o.* from public.fk_order_items o
      where o.platform = 'flipkart' and o.stage = 'cancelled' and o.cancel_type is not null and o.cancelled_at is not null
        and o.cancelled_at > now() - interval '30 days'
        and ($1 is null or o.warehouse_id = $1)
        and ($2 is null or o.cancel_type = $2)
        and ($3 is null or o.sku ilike $3 or o.order_id ilike $3 or o.cancel_reason ilike $3)
    )
    select jsonb_build_object(
      'total', (select count(*) from base),
      'rows', coalesce((
        select jsonb_agg(to_jsonb(r)) from (
          select b.order_item_id, b.order_id, b.sku, b.quantity, b.warehouse_id, b.cancel_type, b.cancelled_at, b.cancel_reason, b.cancel_sub_reason
          from base b order by b.%I %s nulls last, b.order_item_id
          limit %s offset %s
        ) r), '[]'::jsonb))
  $q$, v_col, v_dir, greatest(least(p_limit, 200), 1), greatest(p_offset, 0))
  into v_result using p_wh, p_type, v_pat;
  return v_result;
end $$;
revoke all on function public.flipkart_cancel_lines(uuid, text, text, text, text, integer, integer) from public, anon;
grant execute on function public.flipkart_cancel_lines(uuid, text, text, text, text, integer, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Needs action: SKUs empty at a warehouse that has orders waiting to be packed there, and the stock the
-- "running out soon" calculation divides by.
-- ---------------------------------------------------------------------------

create or replace function public.flipkart_empty_with_orders() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.orders desc, x.sku), '[]'::jsonb) from (
    select o.sku, o.warehouse_id, count(distinct o.shipment_key) as orders, sum(o.quantity)::integer as units
    from public.fk_pending_orders o
    join public.stock_levels s on s.platform = 'flipkart' and s.snapshot_date = public.flipkart_snapshot_date()
                              and s.sku = o.sku and s.warehouse_id = o.warehouse_id and s.inventory = 0
    where o.sku is not null and o.warehouse_id is not null and not o.hold and o.bucket in ('to_accept', 'to_pack')
    group by o.sku, o.warehouse_id
  ) x
$$;
revoke all on function public.flipkart_empty_with_orders() from public, anon;
grant execute on function public.flipkart_empty_with_orders() to authenticated, service_role;

-- Units per SKU and warehouse for ACTIVE listings in the latest snapshot: [{ sku, wid, units }]
create or replace function public.flipkart_stock_units() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('sku', s.sku, 'wid', s.warehouse_id, 'units', s.inventory)), '[]'::jsonb)
  from public.stock_levels s
  join public.stock_snapshot_skus k on k.platform = s.platform and k.snapshot_date = s.snapshot_date and k.sku = s.sku and k.listing_status = 'ACTIVE'
  where s.platform = 'flipkart' and s.snapshot_date = public.flipkart_snapshot_date() and s.inventory > 0
$$;
revoke all on function public.flipkart_stock_units() from public, anon;
grant execute on function public.flipkart_stock_units() to authenticated, service_role;
