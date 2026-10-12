-- Phase 4: the Flipkart page.
--
-- Adds, next to the Phase 3 stock tables:
--   * HSN / tax code per listing, a price per SKU per day, and a log of every price change
--   * orders (pending, shipped, cancelled), returns, and the runs that read them from Flipkart
--   * dispatch-deadline alerts (one per order), sales and return rates for "running out soon"
--
-- Everything is read from Flipkart, never written to it. No buyer data is kept: no names,
-- phones, addresses, prices paid or free-text comments. Only order IDs, SKU, quantity,
-- warehouse, dates, status and the return / cancellation reason.
--
-- Nothing existing is dropped. stock_apply_batch and stock_run_finish are replaced with the
-- same signatures (they also save prices and tax now); the trigger that pushes notifications
-- is recreated to include the new "dispatch_risk" kind.

-- ---------------------------------------------------------------------------
-- Settings (owner changes them on the Settings page)
-- ---------------------------------------------------------------------------

insert into public.app_settings (key, value) values
  ('price_drop_percent', '15'),
  ('dispatch_sla_days', '2'),
  ('running_out_days', '7'),
  ('return_rate_percent', '10')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Listings: tax details, one price per SKU per day, price change log
-- ---------------------------------------------------------------------------

alter table public.stock_listings
  add column hsn text,
  add column tax_code text,
  add column tax_read boolean not null default false;   -- true once a sync has looked at the tax fields

create table public.stock_prices (
  platform text not null default 'flipkart',
  snapshot_date date not null,
  sku text not null,
  mrp numeric(12, 2),
  selling_price numeric(12, 2),
  primary key (platform, snapshot_date, sku),
  foreign key (platform, sku) references public.stock_listings (platform, sku) on delete cascade
);

create table public.price_changes (
  id uuid primary key default gen_random_uuid(),
  platform text not null default 'flipkart',
  sku text not null,
  change_date date not null,
  old_mrp numeric(12, 2),
  new_mrp numeric(12, 2),
  old_selling_price numeric(12, 2),
  new_selling_price numeric(12, 2),
  created_at timestamptz not null default now(),
  unique (platform, sku, change_date),
  foreign key (platform, sku) references public.stock_listings (platform, sku) on delete cascade
);
create index price_changes_date_idx on public.price_changes (change_date desc);

-- ---------------------------------------------------------------------------
-- Orders and returns
-- ---------------------------------------------------------------------------

create table public.order_runs (
  id uuid primary key default gen_random_uuid(),
  platform text not null default 'flipkart',
  kind text not null check (kind in ('pending', 'daily', 'backfill')),
  trigger text not null check (trigger in ('cron', 'manual')),
  requested_by uuid references public.profiles (id),
  status text not null default 'queued' check (status in ('queued', 'running', 'paused', 'done', 'failed')),
  plan jsonb not null default '[]'::jsonb,   -- what to read, in order
  step integer not null default 0,           -- which part of the plan is being read
  next_path text,                            -- Flipkart's address of the next page of this part
  pages integer not null default 0,
  items_seen integer not null default 0,
  items_saved integer not null default 0,
  returns_saved integer not null default 0,
  coverage_from date,                        -- backfill: oldest day of shipped orders read so far (newest first)
  attempts integer not null default 0,       -- restarts in a row without any progress
  lease_until timestamptz,
  error text,
  notes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index order_runs_status_idx on public.order_runs (status, kind);
create index order_runs_requested_by_idx on public.order_runs (requested_by);

create table public.fk_order_items (
  platform text not null default 'flipkart',
  order_item_id text not null,
  order_id text not null,
  shipment_id text,
  sku text,
  quantity integer not null default 1 check (quantity >= 0),
  order_date timestamptz,
  order_day date,                            -- the order's day in IST
  location_id text,
  warehouse_id uuid references public.warehouses (id),
  -- pending = waiting to be dispatched; dispatched = shipped or delivered; cancelled;
  -- left_pending = it dropped out of the pending list and we have not seen where it went.
  stage text not null check (stage in ('pending', 'dispatched', 'cancelled', 'left_pending')),
  item_status text,
  hold boolean not null default false,
  dispatch_by timestamptz,
  dispatch_after timestamptz,
  cancel_type text check (cancel_type in ('seller', 'buyer')),
  cancelled_at timestamptz,
  cancel_reason text,
  cancel_sub_reason text,
  alerted_at timestamptz,                    -- the dispatch-deadline alert for this order was sent
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_run_id uuid references public.order_runs (id) on delete set null,
  primary key (platform, order_item_id)
);
create index fk_order_items_pending_idx on public.fk_order_items (dispatch_by) where stage = 'pending';
create index fk_order_items_day_idx on public.fk_order_items (order_day);
create index fk_order_items_sku_day_idx on public.fk_order_items (platform, sku, order_day);
create index fk_order_items_warehouse_idx on public.fk_order_items (warehouse_id);
create index fk_order_items_cancelled_idx on public.fk_order_items (cancelled_at) where stage = 'cancelled';
create index fk_order_items_order_idx on public.fk_order_items (order_id);
create index fk_order_items_run_idx on public.fk_order_items (last_run_id);

create table public.fk_returns (
  platform text not null default 'flipkart',
  return_id text not null,
  order_item_id text not null,
  order_id text,
  source text not null check (source in ('courier_return', 'customer_return')),
  sku text,                                  -- found from the order; empty when the order is older than our history
  quantity integer not null default 1 check (quantity >= 0),
  location_id text,
  warehouse_id uuid references public.warehouses (id),
  return_status text,
  reason text,
  sub_reason text,
  shipment_status text,
  order_date timestamptz,
  created_date date,                         -- the day the return was created (IST)
  updated_date timestamptz,
  first_seen_at timestamptz not null default now(),
  last_run_id uuid references public.order_runs (id) on delete set null,
  primary key (platform, return_id, order_item_id)
);
create index fk_returns_created_idx on public.fk_returns (created_date desc);
create index fk_returns_sku_idx on public.fk_returns (platform, sku, created_date);
create index fk_returns_warehouse_idx on public.fk_returns (warehouse_id);
create index fk_returns_item_idx on public.fk_returns (platform, order_item_id);
create index fk_returns_run_idx on public.fk_returns (last_run_id);

-- ---------------------------------------------------------------------------
-- Access
--   prices and price changes: owner, manager, listing
--   orders and returns: owner, manager, listing see all; a warehouse user only their warehouses
--   runs: everyone signed in may see progress, but not the plan or Flipkart's page addresses
-- Nobody writes from the app.
-- ---------------------------------------------------------------------------

alter table public.stock_prices enable row level security;
alter table public.price_changes enable row level security;
alter table public.order_runs enable row level security;
alter table public.fk_order_items enable row level security;
alter table public.fk_returns enable row level security;

revoke all on public.stock_prices, public.price_changes, public.order_runs, public.fk_order_items, public.fk_returns from anon;
revoke all on public.stock_prices, public.price_changes, public.order_runs, public.fk_order_items, public.fk_returns from authenticated;
grant select on public.stock_prices, public.price_changes, public.fk_order_items, public.fk_returns to authenticated;
grant select (id, platform, kind, trigger, status, step, pages, items_seen, items_saved, returns_saved,
              coverage_from, error, created_at, updated_at, finished_at)
  on public.order_runs to authenticated;
grant all on public.stock_prices, public.price_changes, public.order_runs, public.fk_order_items, public.fk_returns to service_role;

create policy stock_prices_select on public.stock_prices for select to authenticated
  using ((select private.is_staff()));

create policy price_changes_select on public.price_changes for select to authenticated
  using ((select private.is_staff()));

create policy order_runs_select on public.order_runs for select to authenticated
  using ((select private.user_role()) is not null);

create policy fk_order_items_select on public.fk_order_items for select to authenticated
  using (
    (select private.is_staff())
    or ((select private.user_role()) = 'warehouse'
        and warehouse_id in (select uw.warehouse_id from public.user_warehouses uw
                             where uw.user_id = (select auth.uid())))
  );

create policy fk_returns_select on public.fk_returns for select to authenticated
  using (
    (select private.is_staff())
    or ((select private.user_role()) = 'warehouse'
        and warehouse_id in (select uw.warehouse_id from public.user_warehouses uw
                             where uw.user_id = (select auth.uid())))
  );

-- ---------------------------------------------------------------------------
-- Stock sync: now also saves tax details, the day's price and every price change.
-- (Same signature as Phase 3.)
-- ---------------------------------------------------------------------------

create or replace function public.stock_apply_batch(p_run uuid, p_items jsonb, p_advance integer, p_skipped integer, p_missing integer)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.stock_runs;
  item jsonb;
  loc jsonb;
  ex public.stock_listings;
  v_found boolean;
  v_today date;
  v_status text;
  v_since date;
  v_before boolean;
  v_wid uuid;
  v_units integer;
  v_sku text;
  v_skus text[];
  v_mrp numeric;
  v_sell numeric;
  n_items integer := 0;
  n_unmapped integer := 0;
begin
  select * into r from public.stock_runs where id = p_run for update;
  if not found or r.status <> 'running' then
    raise exception 'run is not running';
  end if;
  v_today := r.snapshot_date;

  select coalesce(array_agg(i ->> 'sku'), '{}') into v_skus from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i;
  -- A second run on the same day replaces the first run's numbers for these SKUs.
  delete from public.stock_levels where platform = r.platform and snapshot_date = v_today and sku = any (v_skus);
  delete from public.stock_snapshot_skus where platform = r.platform and snapshot_date = v_today and sku = any (v_skus);
  delete from public.stock_prices where platform = r.platform and snapshot_date = v_today and sku = any (v_skus);

  for item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_sku := item ->> 'sku';
    if v_sku is null or btrim(v_sku) = '' then
      continue;
    end if;
    v_status := upper(coalesce(nullif(btrim(item ->> 'status'), ''), 'UNKNOWN'));
    v_mrp := case when jsonb_typeof(item -> 'mrp') = 'number' then (item ->> 'mrp')::numeric end;
    v_sell := case when jsonb_typeof(item -> 'selling_price') = 'number' then (item ->> 'selling_price')::numeric end;

    select * into ex from public.stock_listings where platform = r.platform and sku = v_sku;
    v_found := found;

    -- The day it was first seen inactive. The very first sync marks everything already inactive
    -- as "before tracking", so only listings that go inactive after that count as new.
    if v_status = 'INACTIVE' then
      if v_found and ex.status = 'INACTIVE' and ex.inactive_since is not null then
        v_since := ex.inactive_since;
        v_before := ex.inactive_before_tracking;
      else
        v_since := v_today;
        v_before := r.first_sync;
      end if;
    else
      v_since := null;
      v_before := false;
    end if;

    insert into public.stock_listings as t (
      platform, sku, listing_id, product_id, title, product_url, status, mrp, selling_price, currency,
      fulfillment_profile, fulfillment, packages, archived_status, hsn, tax_code, tax_read,
      first_seen_date, last_seen_date, last_run_id, inactive_since, inactive_before_tracking, updated_at)
    values (
      r.platform, v_sku, item ->> 'listing_id', item ->> 'product_id', item ->> 'title', item ->> 'product_url', v_status,
      v_mrp, v_sell,
      item ->> 'currency', item ->> 'fulfillment_profile',
      case when jsonb_typeof(item -> 'fulfillment') = 'object' then item -> 'fulfillment' end,
      case when jsonb_typeof(item -> 'packages') = 'array' then item -> 'packages' else '[]'::jsonb end,
      item ->> 'archived_status',
      nullif(btrim(item ->> 'hsn'), ''), nullif(btrim(item ->> 'tax_code'), ''), true,
      v_today, v_today, p_run, v_since, v_before, now())
    on conflict (platform, sku) do update set
      listing_id = excluded.listing_id, product_id = excluded.product_id, title = excluded.title,
      product_url = excluded.product_url, status = excluded.status, mrp = excluded.mrp,
      selling_price = excluded.selling_price, currency = excluded.currency,
      fulfillment_profile = excluded.fulfillment_profile, fulfillment = excluded.fulfillment,
      packages = excluded.packages, archived_status = excluded.archived_status,
      hsn = excluded.hsn, tax_code = excluded.tax_code, tax_read = true,
      last_seen_date = excluded.last_seen_date, last_run_id = excluded.last_run_id,
      inactive_since = excluded.inactive_since, inactive_before_tracking = excluded.inactive_before_tracking,
      updated_at = now();

    -- The price Flipkart showed today, and a log line when it differs from what we saw last time.
    insert into public.stock_prices (platform, snapshot_date, sku, mrp, selling_price)
    values (r.platform, v_today, v_sku, v_mrp, v_sell)
    on conflict (platform, snapshot_date, sku) do update set mrp = excluded.mrp, selling_price = excluded.selling_price;

    if v_found and (ex.mrp is distinct from v_mrp or ex.selling_price is distinct from v_sell) then
      insert into public.price_changes (platform, sku, change_date, old_mrp, new_mrp, old_selling_price, new_selling_price)
      values (r.platform, v_sku, v_today, ex.mrp, v_mrp, ex.selling_price, v_sell)
      on conflict (platform, sku, change_date) do update
        set new_mrp = excluded.new_mrp, new_selling_price = excluded.new_selling_price;
      -- Changed and changed back on the same day: not a change.
      delete from public.price_changes
      where platform = r.platform and sku = v_sku and change_date = v_today
        and old_mrp is not distinct from new_mrp and old_selling_price is not distinct from new_selling_price;
    end if;

    insert into public.stock_snapshot_skus (platform, snapshot_date, sku, listing_status)
    values (r.platform, v_today, v_sku, v_status)
    on conflict (platform, snapshot_date, sku) do update set listing_status = excluded.listing_status;

    for loc in select * from jsonb_array_elements(case when jsonb_typeof(item -> 'locations') = 'array' then item -> 'locations' else '[]'::jsonb end) loop
      select id into v_wid from public.warehouses where flipkart_location_id = loc ->> 'id';
      if v_wid is null then
        n_unmapped := n_unmapped + 1;
        continue;
      end if;
      v_units := case when jsonb_typeof(loc -> 'inventory') = 'number'
                      then least(greatest(floor((loc ->> 'inventory')::numeric), 0), 2000000000)::integer else 0 end;
      insert into public.stock_levels (platform, snapshot_date, sku, warehouse_id, inventory, location_status)
      values (r.platform, v_today, v_sku, v_wid, v_units, loc ->> 'status')
      on conflict (platform, snapshot_date, sku, warehouse_id) do update
        set inventory = excluded.inventory, location_status = excluded.location_status;
    end loop;

    n_items := n_items + 1;
  end loop;

  update public.stock_runs
  set cursor = cursor + greatest(coalesce(p_advance, 0), 0),
      processed = processed + n_items,
      skipped_fbf = skipped_fbf + greatest(coalesce(p_skipped, 0), 0),
      missing = missing + greatest(coalesce(p_missing, 0), 0),
      unmapped_locations = unmapped_locations + n_unmapped,
      updated_at = now()
  where id = p_run;

  return jsonb_build_object('saved', n_items, 'unmapped_locations', n_unmapped);
end $$;

create or replace function public.stock_run_finish(p_run uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.stock_runs;
  v_error text;
begin
  select * into r from public.stock_runs where id = p_run for update;
  if not found or r.status <> 'running' then
    raise exception 'run is not running';
  end if;

  if r.total = 0 then
    v_error := 'Flipkart returned no listings';
  elsif r.cursor < r.total then
    v_error := format('Stopped early: looked at %s of %s listings', r.cursor, r.total);
  elsif r.missing > r.total * 0.2 then
    v_error := format('Flipkart gave details for only %s of %s listings', r.total - r.missing, r.total);
  end if;

  if v_error is not null then
    update public.stock_runs
    set status = 'failed', error = v_error, finished_at = now(), lease_until = null, updated_at = now()
    where id = p_run;
    return jsonb_build_object('ok', false, 'error', v_error);
  end if;

  update public.stock_runs
  set status = 'done', stage = null, error = null, finished_at = now(), lease_until = null, updated_at = now()
  where id = p_run;

  -- Keep 60 days of snapshots and 12 months of price changes.
  delete from public.stock_levels where platform = r.platform and snapshot_date <= r.snapshot_date - 60;
  delete from public.stock_snapshot_skus where platform = r.platform and snapshot_date <= r.snapshot_date - 60;
  delete from public.stock_prices where platform = r.platform and snapshot_date <= r.snapshot_date - 60;
  delete from public.price_changes where platform = r.platform and change_date < r.snapshot_date - 365;

  return jsonb_build_object('ok', true, 'snapshot_date', r.snapshot_date, 'processed', r.processed,
                            'skipped_fbf', r.skipped_fbf, 'missing', r.missing);
end $$;

-- ---------------------------------------------------------------------------
-- What to read from Flipkart for each kind of order run
-- ---------------------------------------------------------------------------

create function private.iso_utc(p_at timestamptz) returns text
language sql immutable set search_path = '' as $$
  select to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS".000Z"')
$$;

-- IST 22:15 to 06:45: the nightly window, when the long backfill may run.
create function private.is_night_ist() returns boolean
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Kolkata')::time >= time '22:15'
      or (now() at time zone 'Asia/Kolkata')::time < time '06:45'
$$;

create function private.order_plan(p_kind text, p_before date default null) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_now timestamptz := now();
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_plan jsonb := '[]'::jsonb;
  d date;
  i integer;
  v_from timestamptz;
  v_to timestamptz;
begin
  if p_kind = 'pending' then
    -- Every state an order passes through before dispatch. One at a time: Flipkart answers
    -- 500 when PACKING_IN_PROGRESS is combined with the dispatch-date sort, so that one is read unsorted.
    return jsonb_build_array(
      jsonb_build_object('t', 'pre', 'state', 'APPROVED'),
      jsonb_build_object('t', 'pre', 'state', 'PACKING_IN_PROGRESS'),
      jsonb_build_object('t', 'pre', 'state', 'PACKED'),
      jsonb_build_object('t', 'pre', 'state', 'READY_TO_DISPATCH'),
      jsonb_build_object('t', 'pre', 'state', 'FORM_FAILED'));
  elsif p_kind = 'daily' then
    return jsonb_build_array(
      jsonb_build_object('t', 'post', 'from', private.iso_utc(v_now - interval '4 days'), 'to', private.iso_utc(v_now)),
      jsonb_build_object('t', 'cancel', 'type', 'sellerCancellation', 'from', private.iso_utc(v_now - interval '4 days'), 'to', private.iso_utc(v_now)),
      jsonb_build_object('t', 'cancel', 'type', 'buyerCancellation', 'from', private.iso_utc(v_now - interval '4 days'), 'to', private.iso_utc(v_now)),
      jsonb_build_object('t', 'returns', 'source', 'courier_return', 'since', 'modifiedAfter', 'at', private.iso_utc(v_now - interval '4 days')),
      jsonb_build_object('t', 'returns', 'source', 'customer_return', 'since', 'modifiedAfter', 'at', private.iso_utc(v_now - interval '4 days')));
  elsif p_kind = 'backfill' then
    -- Shipped orders one day at a time, newest first, so the recent days are complete first.
    for i in 0..29 loop
      d := v_today - i;
      exit when p_before is not null and d >= p_before;
      v_from := (d::timestamp at time zone 'Asia/Kolkata');
      v_to := least(((d + 1)::timestamp at time zone 'Asia/Kolkata'), v_now);
      v_plan := v_plan || jsonb_build_array(jsonb_build_object(
        't', 'post', 'day', d, 'from', private.iso_utc(v_from), 'to', private.iso_utc(v_to)));
    end loop;
    v_from := ((v_today - 29)::timestamp at time zone 'Asia/Kolkata');
    v_plan := v_plan || jsonb_build_array(
      jsonb_build_object('t', 'cancel', 'type', 'sellerCancellation', 'from', private.iso_utc(v_from), 'to', private.iso_utc(v_now)),
      jsonb_build_object('t', 'cancel', 'type', 'buyerCancellation', 'from', private.iso_utc(v_from), 'to', private.iso_utc(v_now)),
      jsonb_build_object('t', 'returns', 'source', 'courier_return', 'since', 'createdAfter', 'at', private.iso_utc(v_from)),
      jsonb_build_object('t', 'returns', 'source', 'customer_return', 'since', 'createdAfter', 'at', private.iso_utc(v_from)));
    return v_plan;
  end if;
  raise exception 'unknown kind %', p_kind;
end $$;

-- ---------------------------------------------------------------------------
-- Starting and resuming runs
-- ---------------------------------------------------------------------------

-- Begins a run, or returns the one already going. Only one order run works at a time; a manual
-- or scheduled run takes over from a backfill (the backfill is paused and resumes later).
create function private.start_order_run(p_kind text, p_trigger text, p_user uuid) returns uuid
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

  insert into public.order_runs (kind, trigger, requested_by, plan)
  values (p_kind, p_trigger, p_user, private.order_plan(p_kind))
  returning id into r;
  perform private.call_function('orders-sync', jsonb_build_object('job', 'start', 'run_id', r));
  return r;
end $$;

-- The one-time 30-day backfill. Called every night at 22:15 IST until it has finished once.
create function private.start_order_backfill() returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  r uuid;
  v_status text;
  v_cover date;
begin
  perform pg_advisory_xact_lock(hashtext('orders_sync'));

  if exists (select 1 from public.order_runs where kind = 'backfill' and status = 'done') then
    return null;
  end if;

  select id, status into r, v_status from public.order_runs
  where kind = 'backfill' and status in ('queued', 'running', 'paused') order by created_at desc limit 1;
  if r is not null then
    -- The watchdog wakes a paused backfill within 5 minutes; nothing else to do.
    return r;
  end if;

  -- A backfill that failed earlier carries on from the day it had reached.
  select coalesce(max(coverage_from), null) into v_cover from public.order_runs where kind = 'backfill' and status = 'failed';
  insert into public.order_runs (kind, trigger, plan, status, coverage_from)
  values ('backfill', 'cron', private.order_plan('backfill', v_cover), 'paused', v_cover)
  returning id into r;
  perform private.call_function('orders-sync', jsonb_build_object('job', 'start', 'run_id', r));
  return r;
end $$;

-- The "Sync now" buttons. Owner and manager only.
create function public.request_orders_sync(p_kind text) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or coalesce(private.user_role(), '') not in ('owner', 'manager') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_kind not in ('pending', 'daily') then
    raise exception 'unknown kind' using errcode = '22023';
  end if;
  return private.start_order_run(p_kind, 'manual', (select auth.uid()));
end $$;
revoke all on function public.request_orders_sync(text) from public, anon;
grant execute on function public.request_orders_sync(text) to authenticated;

-- Every 5 minutes: restart a run whose worker was cut off, wake a paused one when it may run.
create function private.resume_stalled_orders() returns void
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
    select id, kind, attempts, status from public.order_runs
    where status in ('queued', 'running', 'paused')
      and (lease_until is null or lease_until < now())
      and updated_at < now() - interval '2 minutes'
    order by case when kind = 'backfill' then 1 else 0 end, created_at
  loop
    if r.kind = 'backfill' and not private.is_night_ist() then
      continue;                              -- sleeps through the day
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

-- ---------------------------------------------------------------------------
-- Saving what the Edge Function read. Service role only.
--
-- orders_apply_page saves one page and moves the run on in the same transaction, so a run that
-- is cut off carries on from exactly the page after the last one saved.
-- ---------------------------------------------------------------------------

create function public.orders_apply_page(
  p_run uuid, p_step integer, p_items jsonb, p_returns jsonb, p_next text, p_seen integer
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.order_runs;
  topic jsonb;
  v_t text;
  v_stage text;
  v_cancel text;
  it jsonb;
  v_wid uuid;
  v_loc text;
  v_date timestamptz;
  v_saved integer := 0;
  v_returns integer := 0;
  v_created timestamptz;
  v_day date;
begin
  select * into r from public.order_runs where id = p_run for update;
  if not found or r.status <> 'running' then
    raise exception 'run is not running';
  end if;
  if r.step <> p_step then
    raise exception 'run is at step %, not %', r.step, p_step;
  end if;

  topic := r.plan -> r.step;
  v_t := topic ->> 't';
  v_stage := case v_t when 'pre' then 'pending' when 'post' then 'dispatched' when 'cancel' then 'cancelled' end;
  v_cancel := case topic ->> 'type' when 'sellerCancellation' then 'seller' when 'buyerCancellation' then 'buyer' end;

  if v_t in ('pre', 'post', 'cancel') then
    for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
      if coalesce(it ->> 'order_item_id', '') = '' or coalesce(it ->> 'order_id', '') = '' then
        continue;
      end if;
      v_loc := nullif(it ->> 'location_id', '');
      v_wid := null;
      if v_loc is not null then
        select id into v_wid from public.warehouses where flipkart_location_id = v_loc;
      end if;
      v_date := nullif(it ->> 'order_date', '')::timestamptz;

      insert into public.fk_order_items as t (
        platform, order_item_id, order_id, shipment_id, sku, quantity, order_date, order_day, location_id, warehouse_id,
        stage, item_status, hold, dispatch_by, dispatch_after, cancel_type, cancelled_at, cancel_reason, cancel_sub_reason,
        last_run_id)
      values (
        'flipkart', it ->> 'order_item_id', it ->> 'order_id', nullif(it ->> 'shipment_id', ''), nullif(it ->> 'sku', ''),
        case when jsonb_typeof(it -> 'quantity') = 'number' then least(greatest((it ->> 'quantity')::numeric, 0), 100000)::integer else 1 end,
        v_date, case when v_date is null then null else (v_date at time zone 'Asia/Kolkata')::date end,
        v_loc, v_wid,
        v_stage, left(it ->> 'status', 40), coalesce((it ->> 'hold')::boolean, false),
        nullif(it ->> 'dispatch_by', '')::timestamptz, nullif(it ->> 'dispatch_after', '')::timestamptz,
        v_cancel, nullif(it ->> 'cancelled_at', '')::timestamptz,
        left(it ->> 'cancel_reason', 80), left(it ->> 'cancel_sub_reason', 80),
        p_run)
      on conflict (platform, order_item_id) do update set
        order_id = excluded.order_id,
        shipment_id = coalesce(excluded.shipment_id, t.shipment_id),
        sku = coalesce(excluded.sku, t.sku),
        quantity = excluded.quantity,
        order_date = coalesce(excluded.order_date, t.order_date),
        order_day = coalesce(excluded.order_day, t.order_day),
        location_id = coalesce(excluded.location_id, t.location_id),
        warehouse_id = coalesce(excluded.warehouse_id, t.warehouse_id),
        stage = excluded.stage,
        item_status = excluded.item_status,
        hold = excluded.hold,
        dispatch_by = coalesce(excluded.dispatch_by, t.dispatch_by),
        dispatch_after = coalesce(excluded.dispatch_after, t.dispatch_after),
        cancel_type = coalesce(excluded.cancel_type, t.cancel_type),
        cancelled_at = coalesce(excluded.cancelled_at, t.cancelled_at),
        cancel_reason = coalesce(excluded.cancel_reason, t.cancel_reason),
        cancel_sub_reason = coalesce(excluded.cancel_sub_reason, t.cancel_sub_reason),
        last_seen_at = now(),
        last_run_id = p_run;
      v_saved := v_saved + 1;
    end loop;
  elsif v_t = 'returns' then
    for it in select * from jsonb_array_elements(coalesce(p_returns, '[]'::jsonb)) loop
      if coalesce(it ->> 'order_item_id', '') = '' then
        continue;
      end if;
      v_loc := nullif(it ->> 'location_id', '');
      v_wid := null;
      if v_loc is not null then
        select id into v_wid from public.warehouses where flipkart_location_id = v_loc;
      end if;
      v_created := nullif(it ->> 'created_at', '')::timestamptz;
      v_day := case when v_created is null then null else (v_created at time zone 'Asia/Kolkata')::date end;

      insert into public.fk_returns as t (
        platform, return_id, order_item_id, order_id, source, sku, quantity, location_id, warehouse_id,
        return_status, reason, sub_reason, shipment_status, order_date, created_date, updated_date, last_run_id)
      values (
        'flipkart', coalesce(nullif(it ->> 'return_id', ''), it ->> 'order_item_id'), it ->> 'order_item_id',
        nullif(it ->> 'order_id', ''), topic ->> 'source',
        (select o.sku from public.fk_order_items o where o.platform = 'flipkart' and o.order_item_id = it ->> 'order_item_id'),
        case when jsonb_typeof(it -> 'quantity') = 'number' then least(greatest((it ->> 'quantity')::numeric, 0), 100000)::integer else 1 end,
        v_loc, v_wid,
        left(it ->> 'status', 40), left(it ->> 'reason', 80), left(it ->> 'sub_reason', 80), left(it ->> 'shipment_status', 40),
        nullif(it ->> 'order_date', '')::timestamptz, v_day, nullif(it ->> 'updated_at', '')::timestamptz,
        p_run)
      on conflict (platform, return_id, order_item_id) do update set
        order_id = coalesce(excluded.order_id, t.order_id),
        source = excluded.source,
        sku = coalesce(t.sku, excluded.sku),
        quantity = excluded.quantity,
        location_id = coalesce(excluded.location_id, t.location_id),
        warehouse_id = coalesce(excluded.warehouse_id, t.warehouse_id),
        return_status = excluded.return_status,
        reason = excluded.reason,
        sub_reason = excluded.sub_reason,
        shipment_status = excluded.shipment_status,
        updated_date = excluded.updated_date,
        last_run_id = p_run;
      v_returns := v_returns + 1;
    end loop;
  end if;

  update public.order_runs
  set pages = pages + 1,
      items_seen = items_seen + greatest(coalesce(p_seen, 0), 0),
      items_saved = items_saved + v_saved,
      returns_saved = returns_saved + v_returns,
      step = case when p_next is null then step + 1 else step end,
      next_path = p_next,
      -- A day of shipped orders is complete once its last page is saved.
      coverage_from = case when p_next is null and r.kind = 'backfill' and topic ? 'day'
                           then least(coalesce(coverage_from, (topic ->> 'day')::date), (topic ->> 'day')::date)
                           else coverage_from end,
      attempts = 0,
      error = null,
      updated_at = now()
  where id = p_run;

  return jsonb_build_object('saved', v_saved, 'returns', v_returns);
end $$;

-- Dispatch-deadline alerts. One per order, ever: alerted_at is set the first time an order is
-- found within 4 hours of its deadline (or past it), so a later run never repeats it. Orders
-- first seen already more than an hour late are marked without an alert: they are not "about to
-- miss" any more and would only bury the useful ones. The owner and managers get one alert per
-- run listing how many orders are at risk at which warehouse.
create function private.orders_raise_alerts() returns integer
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

create function public.orders_run_finish(p_run uuid) returns jsonb
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
    v_error := format('Stopped early: read %s of %s parts', r.step, jsonb_array_length(r.plan));
  end if;
  if v_error is not null then
    update public.order_runs
    set status = 'failed', error = v_error, finished_at = now(), lease_until = null, updated_at = now()
    where id = p_run;
    return jsonb_build_object('ok', false, 'error', v_error);
  end if;

  if r.kind = 'pending' then
    -- A complete sweep: anything we still had as pending that Flipkart no longer lists has moved on.
    update public.fk_order_items
    set stage = 'left_pending'
    where platform = 'flipkart' and stage = 'pending' and last_run_id is distinct from p_run;
    get diagnostics v_left = row_count;
    v_alerts := private.orders_raise_alerts();
  end if;

  -- Returns learn their SKU from the order they belong to.
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

create function public.orders_run_fail(p_run uuid, p_error text) returns void
language sql security definer set search_path = '' as $$
  update public.order_runs
  set status = 'failed', error = left(coalesce(p_error, 'Failed'), 500), finished_at = now(), lease_until = null, updated_at = now()
  where id = p_run and status in ('queued', 'running', 'paused')
$$;

-- The worker waits (without failing) for a stock sync to finish, or for the night.
create function public.orders_run_pause(p_run uuid, p_error text) returns void
language sql security definer set search_path = '' as $$
  update public.order_runs
  set status = 'paused', lease_until = null, error = left(p_error, 500), updated_at = now()
  where id = p_run and status in ('queued', 'running')
$$;

-- True when a stock sync, or an order run other than this one, is working right now.
create function public.orders_other_sync_active(p_run uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.stock_runs
                 where status in ('queued', 'running') and updated_at > now() - interval '10 minutes')
      or exists (select 1 from public.order_runs
                 where id <> p_run and status = 'running' and lease_until > now())
$$;

revoke all on function public.orders_apply_page(uuid, integer, jsonb, jsonb, text, integer) from public, anon, authenticated;
revoke all on function public.orders_run_finish(uuid) from public, anon, authenticated;
revoke all on function public.orders_run_fail(uuid, text) from public, anon, authenticated;
revoke all on function public.orders_run_pause(uuid, text) from public, anon, authenticated;
revoke all on function public.orders_other_sync_active(uuid) from public, anon, authenticated;
grant execute on function public.orders_apply_page(uuid, integer, jsonb, jsonb, text, integer) to service_role;
grant execute on function public.orders_run_finish(uuid) to service_role;
grant execute on function public.orders_run_fail(uuid, text) to service_role;
grant execute on function public.orders_run_pause(uuid, text) to service_role;
grant execute on function public.orders_other_sync_active(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Reading: sales and stock drops per SKU and warehouse, and return rates. These run as the
-- caller, so a warehouse user only gets their own warehouses.
-- ---------------------------------------------------------------------------

-- Units sold per SKU and warehouse over the last 7 and 14 whole days (today is left out: it is
-- not finished). Cancelled orders do not count. `coverage_from` is the oldest day the backfill
-- has fully read; sales numbers are only trusted from that day on.
create function public.flipkart_sales_rates() returns jsonb
language sql stable security invoker set search_path = '' as $$
  with t as (select (now() at time zone 'Asia/Kolkata')::date as today)
  select jsonb_build_object(
    'coverage_from', (select coverage_from from public.order_runs
                      where kind = 'backfill' and platform = 'flipkart' and coverage_from is not null
                      order by created_at desc limit 1),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object('sku', x.sku, 'wid', x.warehouse_id, 'u7', x.u7, 'u14', x.u14, 'n14', x.n14))
      from (
        select o.sku, o.warehouse_id,
               coalesce(sum(o.quantity) filter (where o.order_day >= t.today - 7), 0) as u7,
               coalesce(sum(o.quantity), 0) as u14,
               count(*) as n14
        from public.fk_order_items o, t
        where o.platform = 'flipkart' and o.stage <> 'cancelled' and o.sku is not null and o.warehouse_id is not null
          and o.order_day >= t.today - 14 and o.order_day < t.today
        group by o.sku, o.warehouse_id
      ) x), '[]'::jsonb))
$$;

-- Units lost per SKU and warehouse between daily snapshots over the last 7 and 14 days.
-- A day where stock went up (a restock) is left out of both the units and the days.
create function public.flipkart_stock_drops() returns jsonb
language sql stable security invoker set search_path = '' as $$
  with t as (select (now() at time zone 'Asia/Kolkata')::date as today),
  s as (
    select l.sku, l.warehouse_id, l.snapshot_date, l.inventory,
           lag(l.inventory) over w as prev_inv, lag(l.snapshot_date) over w as prev_date
    from public.stock_levels l, t
    where l.platform = 'flipkart' and l.snapshot_date >= t.today - 16
    window w as (partition by l.sku, l.warehouse_id order by l.snapshot_date)
  ), d as (
    select s.sku, s.warehouse_id, s.snapshot_date,
           greatest(s.prev_inv - s.inventory, 0) as lost, (s.snapshot_date - s.prev_date) as gap,
           (s.inventory > s.prev_inv) as up
    from s where s.prev_inv is not null and s.snapshot_date > s.prev_date
  )
  select jsonb_build_object(
    'first_snapshot', (select min(snapshot_date) from public.stock_levels where platform = 'flipkart'),
    'last_snapshot', (select max(snapshot_date) from public.stock_levels where platform = 'flipkart'),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object('sku', x.sku, 'wid', x.warehouse_id,
                                          'lost7', x.lost7, 'days7', x.days7, 'lost14', x.lost14, 'days14', x.days14))
      from (
        select d.sku, d.warehouse_id,
               coalesce(sum(d.lost) filter (where not d.up and d.snapshot_date > t.today - 7), 0) as lost7,
               coalesce(sum(d.gap) filter (where not d.up and d.snapshot_date > t.today - 7), 0) as days7,
               coalesce(sum(d.lost) filter (where not d.up), 0) as lost14,
               coalesce(sum(d.gap) filter (where not d.up), 0) as days14
        from d, t
        where d.snapshot_date > t.today - 14
        group by d.sku, d.warehouse_id
      ) x), '[]'::jsonb))
$$;

-- Units sold and units returned per SKU over the last p_days days (IST). Returns count by the day
-- they were created. Only SKUs with a sale or a return appear.
create function public.flipkart_return_rates(p_days integer default 30) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with t as (select (now() at time zone 'Asia/Kolkata')::date as today),
  sold as (
    select o.sku, sum(o.quantity) as n
    from public.fk_order_items o, t
    where o.platform = 'flipkart' and o.stage in ('dispatched', 'left_pending') and o.sku is not null
      and o.order_day > t.today - p_days
    group by o.sku
  ), back as (
    select r.sku, sum(r.quantity) as n
    from public.fk_returns r, t
    where r.platform = 'flipkart' and r.sku is not null and r.created_date > t.today - p_days
    group by r.sku
  )
  select coalesce(jsonb_agg(jsonb_build_object('sku', k.sku, 'sold', coalesce(s.n, 0), 'returned', coalesce(b.n, 0))), '[]'::jsonb)
  from (select sku from sold union select sku from back) k
  left join sold s on s.sku = k.sku
  left join back b on b.sku = k.sku
$$;

revoke all on function public.flipkart_sales_rates() from public, anon;
revoke all on function public.flipkart_stock_drops() from public, anon;
revoke all on function public.flipkart_return_rates(integer) from public, anon;
grant execute on function public.flipkart_sales_rates() to authenticated, service_role;
grant execute on function public.flipkart_stock_drops() to authenticated, service_role;
grant execute on function public.flipkart_return_rates(integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Push the new alert like the other event notifications.
-- ---------------------------------------------------------------------------

drop trigger notifications_push on public.notifications;
create trigger notifications_push after insert on public.notifications
  for each row when (new.kind in ('assigned', 'comment', 'done', 'test', 'dispatch_risk'))
  execute function private.notifications_push();

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to service_role;
