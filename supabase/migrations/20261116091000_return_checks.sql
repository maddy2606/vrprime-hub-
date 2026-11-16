-- Returns to claim (graphite-spec 12.2, narrowed by the owner on 16 Nov 2026): completed Flipkart returns that may
-- need a claim and that nobody has checked yet, with the days left to raise it. A return is listed when Flipkart's
-- reason points at a claim (wrong item, damaged, missing, used, quality; an RTO that came back damaged) or when the
-- warehouse marked it "Needs claim" on opening it. "Looks fine" records an 'ok' check; "Raise ticket" saves the ticket
-- with the return's ID and records a 'ticket' check. Written by the build, applied by hand after review.

-- How many days after a return is completed a claim can still be raised (Settings > Flipkart page).
insert into public.app_settings (key, value) values ('return_claim_days', '7') on conflict (key) do nothing;

-- The list starts on the day this migration is applied, less the days to claim: returns that can still be claimed
-- show, and nothing from before shows up as missed.
insert into public.app_settings (key, value)
values ('return_claim_start', to_jsonb(((now() at time zone 'Asia/Kolkata')::date - 7)::text))
on conflict (key) do nothing;

-- The return a ticket was raised for.
alter table public.tickets add column if not exists return_id text;

create table if not exists public.return_checks (
  platform text not null,
  return_id text not null,
  order_item_id text not null,
  outcome text not null check (outcome in ('ok', 'ticket')),
  ticket_id uuid references public.tickets (id) on delete set null,
  checked_by uuid,
  checked_at timestamptz not null default now(),
  primary key (platform, return_id, order_item_id)
);
create index if not exists return_checks_checked_idx on public.return_checks (checked_at desc);

alter table public.return_checks enable row level security;

-- A check is visible when its return is: the same test as fk_returns_select (staff see all; a warehouse user only
-- returns at their warehouses). No direct insert, update or delete: the two functions below write.
drop policy if exists return_checks_select on public.return_checks;
create policy return_checks_select on public.return_checks for select to authenticated
  using (
    exists (
      select 1 from public.fk_returns r
      where r.platform = return_checks.platform
        and r.return_id = return_checks.return_id
        and r.order_item_id = return_checks.order_item_id
        and (
          (select private.is_staff())
          or ((select private.user_role()) = 'warehouse'
              and r.warehouse_id in (select uw.warehouse_id from public.user_warehouses uw
                                     where uw.user_id = (select auth.uid())))
        )
    )
  );
revoke all on public.return_checks from anon, authenticated;
grant select on public.return_checks to authenticated;
grant all on public.return_checks to service_role;

-- True when the signed-in user may see this Flipkart return (fk_returns_select's test).
create or replace function private.can_see_return(p_return_id text, p_order_item_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.fk_returns r
    where r.platform = 'flipkart'
      and r.return_id = p_return_id
      and r.order_item_id = p_order_item_id
      and (
        private.is_staff()
        or (private.user_role() = 'warehouse'
            and r.warehouse_id in (select uw.warehouse_id from public.user_warehouses uw where uw.user_id = auth.uid()))
      )
  )
$$;
revoke all on function private.can_see_return(text, text) from public, anon;
grant execute on function private.can_see_return(text, text) to authenticated;

-- "Needs claim": the warehouse opened a return and found a problem Flipkart's reason does not show. The return joins
-- Returns to claim under what was found. Only completed returns can be marked.
create table if not exists public.return_claim_flags (
  platform text not null,
  return_id text not null,
  order_item_id text not null,
  reason text not null check (reason in ('wrong_item', 'damaged', 'missing', 'used', 'empty_box', 'other')),
  flagged_by uuid,
  flagged_at timestamptz not null default now(),
  primary key (platform, return_id, order_item_id)
);
alter table public.return_claim_flags enable row level security;
drop policy if exists return_claim_flags_select on public.return_claim_flags;
create policy return_claim_flags_select on public.return_claim_flags for select to authenticated
  using (private.can_see_return(return_claim_flags.return_id, return_claim_flags.order_item_id));
revoke all on public.return_claim_flags from anon, authenticated;
grant select on public.return_claim_flags to authenticated;
grant all on public.return_claim_flags to service_role;

create or replace function public.return_flag_claim(p_return_id text, p_order_item_id text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_see_return(p_return_id, p_order_item_id) then
    raise exception 'That return was not found' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('wrong_item', 'damaged', 'missing', 'used', 'empty_box', 'other') then
    raise exception 'Pick what was wrong with the return' using errcode = '22023';
  end if;
  if not exists (select 1 from public.fk_returns r where r.platform = 'flipkart' and r.return_id = p_return_id
                 and r.order_item_id = p_order_item_id and r.return_status = 'completed') then
    raise exception 'Only a return that has come back can be marked' using errcode = '22023';
  end if;
  insert into public.return_claim_flags (platform, return_id, order_item_id, reason, flagged_by)
  values ('flipkart', p_return_id, p_order_item_id, p_reason, auth.uid())
  on conflict (platform, return_id, order_item_id)
  do update set reason = excluded.reason, flagged_by = excluded.flagged_by, flagged_at = now();
  -- A return marked "Looks fine" earlier comes back onto the list.
  delete from public.return_checks c
  where c.platform = 'flipkart' and c.return_id = p_return_id and c.order_item_id = p_order_item_id and c.outcome = 'ok';
end
$$;
revoke all on function public.return_flag_claim(text, text, text) from public, anon;
grant execute on function public.return_flag_claim(text, text, text) to authenticated;

-- "Looks fine": records an 'ok' check (nothing happens if the return is already checked).
create or replace function public.return_check_ok(p_return_id text, p_order_item_id text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_see_return(p_return_id, p_order_item_id) then
    raise exception 'That return was not found' using errcode = '42501';
  end if;
  insert into public.return_checks (platform, return_id, order_item_id, outcome, checked_by)
  values ('flipkart', p_return_id, p_order_item_id, 'ok', auth.uid())
  on conflict (platform, return_id, order_item_id) do nothing;
end
$$;
revoke all on function public.return_check_ok(text, text) from public, anon;
grant execute on function public.return_check_ok(text, text) to authenticated;

-- "Raise ticket": after the ticket is saved, records a 'ticket' check pointing at it. The ticket must be one the caller
-- created. A return already marked 'ok' becomes 'ticket'.
create or replace function public.return_check_ticket(p_return_id text, p_order_item_id text, p_ticket uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_see_return(p_return_id, p_order_item_id) then
    raise exception 'That return was not found' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tickets t where t.id = p_ticket and t.created_by = auth.uid()) then
    raise exception 'That ticket was not found' using errcode = '42501';
  end if;
  insert into public.return_checks (platform, return_id, order_item_id, outcome, ticket_id, checked_by)
  values ('flipkart', p_return_id, p_order_item_id, 'ticket', p_ticket, auth.uid())
  on conflict (platform, return_id, order_item_id)
  do update set outcome = 'ticket', ticket_id = excluded.ticket_id, checked_by = excluded.checked_by, checked_at = now();
end
$$;
revoke all on function public.return_check_ticket(text, text, uuid) from public, anon;
grant execute on function public.return_check_ticket(text, text, uuid) to authenticated;

-- Which group a return falls in, or null when it does not point at a claim. A "Needs claim" mark wins over Flipkart's
-- reason. Customer returns: wrong item (MISSHIPMENT), damaged, missing, used, quality not as expected. RTOs: only
-- those that came back damaged.
create or replace function private.claim_group(p_source text, p_reason text, p_sub_reason text, p_flag text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_flag is not null then p_flag
    when p_source = 'customer_return' and upper(p_reason) = 'MISSHIPMENT' then 'wrong_item'
    when p_source = 'customer_return' and upper(p_reason) = 'DAMAGED_PRODUCT' then 'damaged'
    when p_source = 'customer_return' and upper(p_reason) = 'MISSING_ITEM' then 'missing'
    when p_source = 'customer_return' and upper(p_reason) = 'QUALITY_ISSUE' and upper(p_sub_reason) = 'USED_PRODUCT' then 'used'
    when p_source = 'customer_return' and upper(p_reason) = 'QUALITY_ISSUE' then 'quality'
    when p_source = 'courier_return' and upper(p_reason) = 'DAMAGED_SHIPMENT' then 'rto_damaged'
  end
$$;
revoke all on function private.claim_group(text, text, text, text) from public, anon;
grant execute on function private.claim_group(text, text, text, text) to authenticated;

-- Returns that may need a claim, completed in the last 30 days (India time) and not before return_claim_start, with no
-- check yet; each with its group, the listing title and days_left = return_claim_days - (today - the day it was
-- completed). Runs as the caller, so fk_returns' RLS applies.
create or replace function public.returns_to_claim() returns jsonb
language sql stable security invoker set search_path = '' as $$
  with s as (
    select
      coalesce((select nullif(a.value #>> '{}', '')::integer from public.app_settings a where a.key = 'return_claim_days'), 7) as days,
      (now() at time zone 'Asia/Kolkata')::date as today,
      (select nullif(a.value #>> '{}', '')::date from public.app_settings a where a.key = 'return_claim_start') as start_on
  ),
  r as (
    select f.*, (f.updated_date at time zone 'Asia/Kolkata')::date as done_on, g.reason as flag,
           private.claim_group(f.source, f.reason, f.sub_reason, g.reason) as claim_group
    from public.fk_returns f
    left join public.return_claim_flags g
      on g.platform = f.platform and g.return_id = f.return_id and g.order_item_id = f.order_item_id
    where f.platform = 'flipkart'
      and f.return_status = 'completed'
      and f.updated_date is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'return_id', r.return_id,
           'order_item_id', r.order_item_id,
           'order_id', r.order_id,
           'sku', r.sku,
           'title', l.title,
           'source', r.source,
           'reason', r.reason,
           'sub_reason', r.sub_reason,
           'claim_group', r.claim_group,
           'flagged', r.flag is not null,
           'quantity', r.quantity,
           'warehouse_id', r.warehouse_id,
           'returned_on', r.done_on,
           'days_left', s.days - (s.today - r.done_on)
         ) order by s.days - (s.today - r.done_on), r.return_id), '[]'::jsonb)
  from r cross join s
  left join public.stock_listings l on l.platform = r.platform and l.sku = r.sku
  where r.claim_group is not null
    and r.done_on >= s.today - 30
    and (s.start_on is null or r.done_on >= s.start_on)
    and not exists (
      select 1 from public.return_checks c
      where c.platform = r.platform and c.return_id = r.return_id and c.order_item_id = r.order_item_id
    )
$$;
revoke all on function public.returns_to_claim() from public, anon;
grant execute on function public.returns_to_claim() to authenticated;
