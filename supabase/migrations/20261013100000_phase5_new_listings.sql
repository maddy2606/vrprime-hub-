-- Phase 5: new-listing requests.
--
--   * Only an owner or an admin can post, see, be assigned or complete a new-listing request (warehouse users
--     get nothing new).
--   * Optional request details: product name, reference link, target price, MRP, size (cm) and weight (kg).
--   * Marking one done needs a SKU (trimmed, no spaces around it). The FSN / listing ID is optional. Posts marked
--     done before this change keep working: they carry a listing ID instead of a SKU.
--   * After each stock sync every done request is looked up in the Flipkart listings: live or not, since when,
--     active or inactive, and the real package size and weight against the weight limit. A request not found 3 days
--     after it was marked done raises an alert to the person who marked it done. The person who posted it hears
--     when it goes live. The result is written only by the sync, never by a signed-in user.

alter table public.posts
  add column product_name text check (product_name is null or char_length(btrim(product_name)) between 1 and 200),
  add column reference_url text check (reference_url is null or char_length(btrim(reference_url)) between 1 and 500),
  add column target_price numeric(12, 2) check (target_price is null or target_price >= 0),
  add column mrp numeric(12, 2) check (mrp is null or mrp >= 0),
  add column dim_l numeric(8, 2) check (dim_l is null or dim_l > 0),
  add column dim_b numeric(8, 2) check (dim_b is null or dim_b > 0),
  add column dim_h numeric(8, 2) check (dim_h is null or dim_h > 0),
  add column weight_kg numeric(8, 3) check (weight_kg is null or weight_kg > 0),
  -- Written by the stock sync only.
  add column live_found boolean,
  add column live_status text,
  add column live_since date,
  add column live_checked_at timestamptz,
  add column live_alerted_at timestamptz,
  add column live_package jsonb,
  add column live_over_weight boolean;

alter table public.posts drop constraint posts_done_needs_proof;
alter table public.posts add constraint posts_done_needs_proof
  check (status <> 'done' or case type
    when 'problem' then nullif(btrim(done_ticket_id), '') is not null
                        or nullif(btrim(done_no_ticket_reason), '') is not null
    when 'new_listing' then (nullif(btrim(sku), '') is not null and sku = btrim(sku))
                            or nullif(btrim(done_listing_id), '') is not null
    when 'restock' then done_qty is not null
                        and nullif(btrim(done_reference), '') is not null
    else true end);

create index posts_new_listing_idx on public.posts (status, live_found) where type = 'new_listing';

-- ---------------------------------------------------------------------------
-- Who can see new-listing requests: owner and admin only
-- ---------------------------------------------------------------------------

create or replace function private.can_see_post_id(p_post_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select (p.type <> 'new_listing' or private.is_staff())
           and private.can_see_post(p.warehouse_id, p.assignee_id, p.created_by)
    from public.posts p where p.id = p_post_id), false)
$$;

drop policy posts_select on public.posts;
create policy posts_select on public.posts for select to authenticated
  using (private.can_see_post(warehouse_id, assignee_id, created_by)
         and (type <> 'new_listing' or (select private.is_staff())));

drop policy posts_insert on public.posts;
create policy posts_insert on public.posts for insert to authenticated
  with check (created_by = (select auth.uid())
              and private.can_see_post(warehouse_id, assignee_id, created_by)
              and (type <> 'new_listing' or (select private.is_staff())));

drop policy posts_update on public.posts;
create policy posts_update on public.posts for update to authenticated
  using (private.can_see_post(warehouse_id, assignee_id, created_by)
         and (type <> 'new_listing' or (select private.is_staff())))
  with check (private.can_see_post(warehouse_id, assignee_id, created_by)
              and (type <> 'new_listing' or (select private.is_staff())));

-- ---------------------------------------------------------------------------
-- Write rules: the live-check columns belong to the sync; a new-listing request is only ever assigned to an
-- owner or an admin; changing the SKU starts the live check over.
-- ---------------------------------------------------------------------------

create or replace function private.posts_before_write() returns trigger
language plpgsql set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  live_cols text[] := array['live_found', 'live_status', 'live_since', 'live_checked_at', 'live_alerted_at',
                            'live_package', 'live_over_weight'];
begin
  if new.type = 'new_listing' and new.assignee_id is not null
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
     and not exists (select 1 from public.profiles p
                     where p.id = new.assignee_id and p.role in ('owner', 'admin')) then
    raise exception 'A new-listing request can only be assigned to an owner or an admin' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := coalesce(actor, new.created_by);
    new.live_found := null; new.live_status := null; new.live_since := null; new.live_checked_at := null;
    new.live_alerted_at := null; new.live_package := null; new.live_over_weight := null;
    if new.status = 'done' then
      new.done_at := now();
      new.done_by := coalesce(actor, new.created_by);
    end if;
    return new;
  end if;

  new.number := old.number;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_at := now();

  if new.status = 'done' and old.status <> 'done' then
    new.done_at := now();
    new.done_by := actor;
  elsif new.status <> 'done' and old.status = 'done' then
    new.done_at := null;
    new.done_by := null;
  else
    new.done_at := old.done_at;
    new.done_by := old.done_by;
  end if;

  if new.type <> 'new_listing' or new.sku is distinct from old.sku then
    -- Another type, or a new SKU: the live check starts over.
    new.live_found := null; new.live_status := null; new.live_since := null; new.live_checked_at := null;
    new.live_alerted_at := null; new.live_package := null; new.live_over_weight := null;
  elsif actor is not null then
    -- A signed-in user cannot write the live-check result.
    new.live_found := old.live_found; new.live_status := old.live_status; new.live_since := old.live_since;
    new.live_checked_at := old.live_checked_at; new.live_alerted_at := old.live_alerted_at;
    new.live_package := old.live_package; new.live_over_weight := old.live_over_weight;
  elsif (to_jsonb(new) - live_cols - 'updated_at') = (to_jsonb(old) - live_cols - 'updated_at') then
    -- The sync re-checking a request is not activity on it.
    new.updated_at := old.updated_at;
  end if;
  return new;
end $$;

-- The done event also records the SKU.
create or replace function private.log_post_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  o jsonb;
  n jsonb;
  f text;
  changes jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.post_events (post_id, actor_id, kind, changes)
    values (new.id, coalesce(actor, new.created_by), 'created',
            jsonb_build_object('type', new.type, 'title', new.title));
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.post_events (post_id, actor_id, kind, changes)
    values (new.id, actor, 'status',
            jsonb_build_object('from', old.status, 'to', new.status)
            || case when new.status = 'done' then jsonb_strip_nulls(jsonb_build_object(
                 'ticket_id', new.done_ticket_id,
                 'no_ticket_reason', new.done_no_ticket_reason,
                 'listing_id', new.done_listing_id,
                 'sku', case when new.type = 'new_listing' then new.sku end,
                 'qty', new.done_qty,
                 'reference', new.done_reference,
                 'note', new.done_note)) else '{}'::jsonb end);
  end if;

  if new.assignee_id is distinct from old.assignee_id then
    insert into public.post_events (post_id, actor_id, kind, changes)
    values (new.id, actor, 'assignee',
            jsonb_build_object('from', old.assignee_id, 'to', new.assignee_id));
  end if;

  o := to_jsonb(old);
  n := to_jsonb(new);
  foreach f in array array['type', 'title', 'details', 'priority', 'sku', 'warehouse_id',
                           'platform', 'marketplace_account', 'qty_needed', 'due_date'] loop
    if (o -> f) is distinct from (n -> f)
       and not (f = 'sku' and new.type = 'new_listing' and new.status = 'done' and old.status <> 'done') then
      changes := changes || jsonb_build_object(f, jsonb_build_object('from', o -> f, 'to', n -> f));
    end if;
  end loop;
  if changes <> '{}'::jsonb then
    insert into public.post_events (post_id, actor_id, kind, changes)
    values (new.id, actor, 'edit', changes);
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Search: product name too (the SKU was already searched)
-- ---------------------------------------------------------------------------

create or replace function public.search_posts(q text) returns setof public.posts
language sql stable security invoker set search_path = '' as $$
  with needle as (
    select '%' || replace(replace(replace(btrim(coalesce(q, '')), '\', '\\'), '%', '\%'), '_', '\_')
           || '%' as pat
  )
  select p.*
  from public.posts p, needle n
  where btrim(coalesce(q, '')) = ''
     or p.title ilike n.pat
     or p.details ilike n.pat
     or p.product_name ilike n.pat
     or p.sku ilike n.pat
     or ('VR-' || p.number) ilike n.pat
     or p.done_ticket_id ilike n.pat
     or p.done_listing_id ilike n.pat
     or p.done_reference ilike n.pat
     or exists (select 1 from public.profiles u
                where u.id in (p.assignee_id, p.created_by) and u.name ilike n.pat)
     or exists (select 1 from public.tickets t
                where t.post_id = p.id and t.ticket_id ilike n.pat)
$$;

-- ---------------------------------------------------------------------------
-- The live check
-- ---------------------------------------------------------------------------

create function private.try_num(p_text text) returns numeric
language sql immutable set search_path = '' as $$
  select case when p_text ~ '^[0-9]+(\.[0-9]+)?$' then p_text::numeric end
$$;

-- Looks every done new-listing request up in the Flipkart listings read by this run.
create function private.check_new_listings(p_run uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_date date;
  v_limit numeric;
  v_days constant integer := 3;
  p record;
  lst public.stock_listings;
  v_pkg jsonb;
  v_found boolean;
  n integer := 0;
begin
  select snapshot_date into v_date from public.stock_runs where id = p_run;
  if v_date is null then
    return 0;
  end if;
  v_limit := coalesce(private.try_num(
    (select value #>> '{}' from public.app_settings where key = 'weight_alert_limit')), 2000);

  for p in
    select id, number, title, sku, created_by, done_by, done_at, live_found, live_since, live_alerted_at
    from public.posts
    where type = 'new_listing' and status = 'done' and nullif(btrim(sku), '') is not null
      and coalesce(platform, 'flipkart') = 'flipkart'
  loop
    n := n + 1;
    select * into lst from public.stock_listings
    where platform = 'flipkart' and sku = p.sku and last_seen_date = v_date;
    v_found := found;

    if v_found then
      -- The real package: the heaviest by size + weight in grams, as in Listing health.
      select jsonb_build_object('l', d.l, 'b', d.b, 'h', d.h, 'kg', coalesce(d.kg, 0),
                                'total', round(d.l * d.b * d.h + coalesce(d.kg, 0) * 1000))
      into v_pkg
      from jsonb_array_elements(case when jsonb_typeof(lst.packages) = 'array' then lst.packages else '[]'::jsonb end) x,
           lateral (select private.try_num(x #>> '{dimensions,length}') as l,
                           private.try_num(x #>> '{dimensions,breadth}') as b,
                           private.try_num(x #>> '{dimensions,height}') as h,
                           private.try_num(x ->> 'weight') as kg) d
      where d.l > 0 and d.b > 0 and d.h > 0
      order by d.l * d.b * d.h + coalesce(d.kg, 0) * 1000 desc
      limit 1;

      update public.posts
      set live_found = true,
          live_status = lst.status,
          live_since = coalesce(p.live_since, lst.first_seen_date),
          live_checked_at = now(),
          live_package = v_pkg,
          live_over_weight = case when v_pkg is null then null else (v_pkg ->> 'total')::numeric > v_limit end
      where id = p.id;

      if p.live_found is not true then
        perform private.notify_user(p.created_by, 'listing_live', 'VR-' || p.number || ' is live on Flipkart',
                                    p.sku || ' · ' || p.title, p.id, null);
      end if;
    elsif p.live_found is true then
      -- It was seen before: a listing that later disappears is not a wrong SKU. Leave what we knew.
      update public.posts set live_checked_at = now() where id = p.id;
    else
      update public.posts set live_found = false, live_checked_at = now() where id = p.id;
      if p.done_at <= now() - make_interval(days => v_days) and p.live_alerted_at is null then
        update public.posts set live_alerted_at = now() where id = p.id;
        perform private.notify_user(coalesce(p.done_by, p.created_by), 'listing_not_found',
                                    'VR-' || p.number || ': SKU not found on Flipkart',
                                    p.sku || ' was marked done ' || v_days || '+ days ago but is not in your Flipkart listings. The SKU may be wrong.',
                                    p.id, null);
      end if;
    end if;
  end loop;
  return n;
end $$;

-- Run it as part of every finished sync. A failure here must never fail the stock sync itself.
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

  begin
    perform private.check_new_listings(p_run);
  exception when others then
    raise warning 'new-listing check failed: %', sqlerrm;
  end;

  return jsonb_build_object('ok', true, 'snapshot_date', r.snapshot_date, 'processed', r.processed,
                            'skipped_fbf', r.skipped_fbf, 'missing', r.missing);
end $$;

-- ---------------------------------------------------------------------------
-- Push the two new alerts like the other event notifications.
-- ---------------------------------------------------------------------------

drop trigger notifications_push on public.notifications;
create trigger notifications_push after insert on public.notifications
  for each row when (new.kind in ('assigned', 'comment', 'done', 'test', 'dispatch_risk', 'listing_live', 'listing_not_found'))
  execute function private.notifications_push();

revoke all on function public.stock_run_finish(uuid) from public, anon, authenticated;
grant execute on function public.stock_run_finish(uuid) to service_role;
revoke all on function public.search_posts(text) from public, anon;
grant execute on function public.search_posts(text) to authenticated, service_role;
revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to service_role;
grant execute on function private.user_role(), private.is_staff(), private.can_see_post(uuid, uuid, uuid), private.can_see_post_id(uuid) to authenticated;
