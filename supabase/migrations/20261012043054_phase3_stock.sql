-- Phase 3: Flipkart stock desk.
--
-- A read-only copy of Flipkart stock, refreshed every day at 08:00 IST (02:30 UTC) and on
-- demand ("Sync now"). Nothing here ever writes to Flipkart.
--
--   stock_runs            one row per sync: progress, lease, errors
--   stock_listings        one row per SKU: title, status, size, when it went inactive
--   stock_snapshot_skus   which SKUs were in each day's snapshot, and their status that day
--   stock_levels          units per SKU, per warehouse, per day (kept 60 days)
--
-- The Edge Function `stock-sync` talks to Flipkart and hands what it read to the
-- stock_* functions below, which do all the saving. Those functions are for the
-- service role only, so they can be tested in SQL (supabase/tests/phase3_check.sql).
--
-- `platform` is part of every key so Amazon can sit next to Flipkart later.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.stock_runs (
  id uuid primary key default gen_random_uuid(),
  platform text not null default 'flipkart' check (platform in ('flipkart', 'amazon', 'other')),
  trigger text not null check (trigger in ('cron', 'manual')),
  requested_by uuid references public.profiles (id),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  stage text check (stage in ('details')),
  snapshot_date date,
  first_sync boolean not null default false,
  skus text[] not null default '{}',
  total integer not null default 0,        -- listings Flipkart told us about
  cursor integer not null default 0,       -- how many of them have been looked at
  processed integer not null default 0,    -- listings saved
  skipped_fbf integer not null default 0,  -- FBF listings left out
  missing integer not null default 0,      -- listings Flipkart gave no details for
  unmapped_locations integer not null default 0,
  attempts integer not null default 0,
  lease_until timestamptz,                 -- while set in the future, a worker owns this run
  error text,
  notes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index stock_runs_status_idx on public.stock_runs (status, finished_at desc);
create index stock_runs_requested_by_idx on public.stock_runs (requested_by);

create table public.stock_listings (
  platform text not null default 'flipkart' check (platform in ('flipkart', 'amazon', 'other')),
  sku text not null,
  listing_id text,
  product_id text,
  title text,
  product_url text,
  status text not null,                    -- ACTIVE or INACTIVE, as Flipkart says
  mrp numeric(12, 2),
  selling_price numeric(12, 2),
  currency text,
  fulfillment_profile text,
  fulfillment jsonb,
  packages jsonb not null default '[]'::jsonb,   -- sizes in cm, weight in kg
  archived_status text,
  first_seen_date date not null,
  last_seen_date date not null,
  last_run_id uuid references public.stock_runs (id) on delete set null,
  inactive_since date,                     -- the day it was first seen inactive
  inactive_before_tracking boolean not null default false,  -- already inactive when tracking began
  updated_at timestamptz not null default now(),
  primary key (platform, sku)
);
create index stock_listings_run_idx on public.stock_listings (last_run_id);

create table public.stock_snapshot_skus (
  platform text not null default 'flipkart',
  snapshot_date date not null,
  sku text not null,
  listing_status text not null,
  primary key (platform, snapshot_date, sku),
  foreign key (platform, sku) references public.stock_listings (platform, sku) on delete cascade
);

create table public.stock_levels (
  platform text not null default 'flipkart',
  snapshot_date date not null,
  sku text not null,
  warehouse_id uuid not null references public.warehouses (id),
  inventory integer not null check (inventory >= 0),
  location_status text,
  primary key (platform, snapshot_date, sku, warehouse_id),
  foreign key (platform, sku) references public.stock_listings (platform, sku) on delete cascade
);
create index stock_levels_warehouse_idx on public.stock_levels (warehouse_id);
create index stock_levels_sku_idx on public.stock_levels (platform, sku);

-- ---------------------------------------------------------------------------
-- Access: everyone signed in sees the list of SKUs and sync status. Units are
-- per warehouse: owner, manager and listing see all of them, warehouse users
-- only their own warehouses. Nobody writes from the app.
-- ---------------------------------------------------------------------------

alter table public.stock_runs enable row level security;
alter table public.stock_listings enable row level security;
alter table public.stock_snapshot_skus enable row level security;
alter table public.stock_levels enable row level security;

revoke all on public.stock_runs, public.stock_listings, public.stock_snapshot_skus, public.stock_levels from anon;
revoke all on public.stock_runs, public.stock_listings, public.stock_snapshot_skus, public.stock_levels from authenticated;
grant select on public.stock_runs, public.stock_listings, public.stock_snapshot_skus, public.stock_levels to authenticated;
grant all on public.stock_runs, public.stock_listings, public.stock_snapshot_skus, public.stock_levels to service_role;

create policy stock_runs_select on public.stock_runs for select to authenticated
  using ((select private.user_role()) is not null);

create policy stock_listings_select on public.stock_listings for select to authenticated
  using ((select private.user_role()) is not null);

create policy stock_snapshot_skus_select on public.stock_snapshot_skus for select to authenticated
  using ((select private.user_role()) is not null);

create policy stock_levels_select on public.stock_levels for select to authenticated
  using (
    (select private.is_staff())
    or ((select private.user_role()) = 'warehouse'
        and warehouse_id in (select uw.warehouse_id from public.user_warehouses uw
                             where uw.user_id = (select auth.uid())))
  );

-- ---------------------------------------------------------------------------
-- Reading a snapshot: { sku: { s: "ACTIVE", w: { "<warehouse id>": units } } }
-- Runs as the caller, so a warehouse user only gets their own warehouses' units.
-- ---------------------------------------------------------------------------

create function public.stock_snapshot(p_date date) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_object_agg(s.sku, jsonb_build_object('s', s.listing_status, 'w', coalesce(l.w, '{}'::jsonb))), '{}'::jsonb)
  from public.stock_snapshot_skus s
  left join (
    select sku, jsonb_object_agg(warehouse_id::text, inventory) as w
    from public.stock_levels
    where platform = 'flipkart' and snapshot_date = p_date
    group by sku
  ) l on l.sku = s.sku
  where s.platform = 'flipkart' and s.snapshot_date = p_date
$$;
revoke all on function public.stock_snapshot(date) from public, anon;
grant execute on function public.stock_snapshot(date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Starting a sync
-- ---------------------------------------------------------------------------

-- Calls any Edge Function with the shared secret. Never raises.
create function private.call_function(p_name text, p_body jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
begin
  select value into v_url from private.internal_config where key = 'notify_url';
  select value into v_secret from private.internal_config where key = 'notify_secret';
  if v_url is null or v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := regexp_replace(v_url, '/[^/]+$', '/' || p_name),
    body := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', v_secret),
    timeout_milliseconds := 10000);
exception when others then
  raise warning 'call_function failed: %', sqlerrm;
end $$;

-- Begins a sync, or returns the one already in progress.
create function private.start_stock_sync(p_trigger text, p_user uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  r uuid;
begin
  perform pg_advisory_xact_lock(hashtext('stock_sync'));

  select id into r from public.stock_runs
  where status in ('queued', 'running') and updated_at > now() - interval '10 minutes'
  order by created_at desc limit 1;
  if r is not null then
    return r;
  end if;

  -- Anything still marked running but silent for 10 minutes is dead.
  update public.stock_runs
  set status = 'failed', error = 'Stopped: no progress for 10 minutes', finished_at = now(), lease_until = null, updated_at = now()
  where status in ('queued', 'running');

  insert into public.stock_runs (trigger, requested_by) values (p_trigger, p_user) returning id into r;
  perform private.call_function('stock-sync', jsonb_build_object('job', 'start', 'run_id', r));
  return r;
end $$;

-- The "Sync now" button. Owner and manager only.
create function public.request_stock_sync() returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or coalesce(private.user_role(), '') not in ('owner', 'manager') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return private.start_stock_sync('manual', (select auth.uid()));
end $$;
revoke all on function public.request_stock_sync() from public, anon;
grant execute on function public.request_stock_sync() to authenticated;

-- Every 5 minutes: if a sync went quiet (its worker was cut off), start it again from where it stopped.
create function private.resume_stalled_sync() returns void
language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  update public.stock_runs
  set status = 'failed', error = 'Stopped: took longer than 3 hours', finished_at = now(), lease_until = null, updated_at = now()
  where status in ('queued', 'running') and created_at < now() - interval '3 hours';

  for r in
    select id, attempts from public.stock_runs
    where status in ('queued', 'running')
      and (lease_until is null or lease_until < now())
      and updated_at < now() - interval '2 minutes'
  loop
    if r.attempts >= 8 then
      update public.stock_runs
      set status = 'failed', error = 'Stopped after being interrupted too many times', finished_at = now(), lease_until = null, updated_at = now()
      where id = r.id;
    else
      update public.stock_runs set attempts = attempts + 1, updated_at = now() where id = r.id;
      perform private.call_function('stock-sync', jsonb_build_object('job', 'continue', 'run_id', r.id));
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Saving what the Edge Function read. Service role only.
-- ---------------------------------------------------------------------------

-- Step 1: Flipkart's list of SKUs is in. Fixes the snapshot day (IST) and whether this is the first sync.
create function public.stock_run_begin(p_run uuid, p_skus text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.stock_runs;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_first boolean;
begin
  select * into r from public.stock_runs where id = p_run for update;
  if not found or r.status not in ('queued', 'running') then
    raise exception 'run is not active';
  end if;
  select not exists (select 1 from public.stock_runs where status = 'done' and platform = r.platform) into v_first;

  update public.stock_runs
  set status = 'running', stage = 'details', snapshot_date = v_today, first_sync = v_first,
      skus = p_skus, total = coalesce(cardinality(p_skus), 0), cursor = 0, processed = 0,
      skipped_fbf = 0, missing = 0, unmapped_locations = 0, error = null, updated_at = now()
  where id = p_run;
  return jsonb_build_object('snapshot_date', v_today, 'first_sync', v_first, 'total', coalesce(cardinality(p_skus), 0));
end $$;

-- Step 2, repeated: one batch of listings (already without FBF ones). `p_advance` is how many SKUs
-- were looked at, so the run can carry on from the right place if it is interrupted.
create function public.stock_apply_batch(p_run uuid, p_items jsonb, p_advance integer, p_skipped integer, p_missing integer)
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

  for item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_sku := item ->> 'sku';
    if v_sku is null or btrim(v_sku) = '' then
      continue;
    end if;
    v_status := upper(coalesce(nullif(btrim(item ->> 'status'), ''), 'UNKNOWN'));

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
      fulfillment_profile, fulfillment, packages, archived_status,
      first_seen_date, last_seen_date, last_run_id, inactive_since, inactive_before_tracking, updated_at)
    values (
      r.platform, v_sku, item ->> 'listing_id', item ->> 'product_id', item ->> 'title', item ->> 'product_url', v_status,
      case when jsonb_typeof(item -> 'mrp') = 'number' then (item ->> 'mrp')::numeric end,
      case when jsonb_typeof(item -> 'selling_price') = 'number' then (item ->> 'selling_price')::numeric end,
      item ->> 'currency', item ->> 'fulfillment_profile',
      case when jsonb_typeof(item -> 'fulfillment') = 'object' then item -> 'fulfillment' end,
      case when jsonb_typeof(item -> 'packages') = 'array' then item -> 'packages' else '[]'::jsonb end,
      item ->> 'archived_status',
      v_today, v_today, p_run, v_since, v_before, now())
    on conflict (platform, sku) do update set
      listing_id = excluded.listing_id, product_id = excluded.product_id, title = excluded.title,
      product_url = excluded.product_url, status = excluded.status, mrp = excluded.mrp,
      selling_price = excluded.selling_price, currency = excluded.currency,
      fulfillment_profile = excluded.fulfillment_profile, fulfillment = excluded.fulfillment,
      packages = excluded.packages, archived_status = excluded.archived_status,
      last_seen_date = excluded.last_seen_date, last_run_id = excluded.last_run_id,
      inactive_since = excluded.inactive_since, inactive_before_tracking = excluded.inactive_before_tracking,
      updated_at = now();

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

-- Step 3: every SKU has been looked at. Check the numbers make sense before calling the snapshot good.
create function public.stock_run_finish(p_run uuid) returns jsonb
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

  -- Keep 60 days of snapshots.
  delete from public.stock_levels where platform = r.platform and snapshot_date <= r.snapshot_date - 60;
  delete from public.stock_snapshot_skus where platform = r.platform and snapshot_date <= r.snapshot_date - 60;

  return jsonb_build_object('ok', true, 'snapshot_date', r.snapshot_date, 'processed', r.processed,
                            'skipped_fbf', r.skipped_fbf, 'missing', r.missing);
end $$;

create function public.stock_run_fail(p_run uuid, p_error text) returns void
language sql security definer set search_path = '' as $$
  update public.stock_runs
  set status = 'failed', error = left(coalesce(p_error, 'Failed'), 500), finished_at = now(), lease_until = null, updated_at = now()
  where id = p_run and status in ('queued', 'running')
$$;

revoke all on function public.stock_run_begin(uuid, text[]) from public, anon, authenticated;
revoke all on function public.stock_apply_batch(uuid, jsonb, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.stock_run_finish(uuid) from public, anon, authenticated;
revoke all on function public.stock_run_fail(uuid, text) from public, anon, authenticated;
grant execute on function public.stock_run_begin(uuid, text[]) to service_role;
grant execute on function public.stock_apply_batch(uuid, jsonb, integer, integer, integer) to service_role;
grant execute on function public.stock_run_finish(uuid) to service_role;
grant execute on function public.stock_run_fail(uuid, text) to service_role;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to service_role;

-- ---------------------------------------------------------------------------
-- Schedule: 08:00 IST = 02:30 UTC. The watchdog restarts a sync that was cut off.
-- ---------------------------------------------------------------------------

select cron.unschedule('stock-sync-daily') where exists (select 1 from cron.job where jobname = 'stock-sync-daily');
select cron.schedule('stock-sync-daily', '30 2 * * *', $$select private.start_stock_sync('cron', null)$$);
select cron.unschedule('stock-sync-watchdog') where exists (select 1 from cron.job where jobname = 'stock-sync-watchdog');
select cron.schedule('stock-sync-watchdog', '*/5 * * * *', $$select private.resume_stalled_sync()$$);
