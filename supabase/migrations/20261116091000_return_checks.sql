-- Returns to claim (graphite-spec 12.2): completed Flipkart returns from the last 30 days that nobody has checked yet,
-- with the days left to raise a claim. "Looks fine" records an 'ok' check; "Raise ticket" saves the ticket with the
-- return's ID and records a 'ticket' check. Written by the build, applied by hand after review.

-- How many days after a return is completed a claim can still be raised (Settings > Flipkart page).
insert into public.app_settings (key, value) values ('return_claim_days', '7') on conflict (key) do nothing;

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

-- Completed Flipkart returns from the last 30 days (India time) with no check yet, each with
-- days_left = return_claim_days - (today - the day it was completed). Runs as the caller, so fk_returns' RLS applies.
create or replace function public.returns_to_claim() returns jsonb
language sql stable security invoker set search_path = '' as $$
  with s as (
    select
      coalesce((select nullif(a.value #>> '{}', '')::integer from public.app_settings a where a.key = 'return_claim_days'), 7) as days,
      (now() at time zone 'Asia/Kolkata')::date as today
  ),
  r as (
    select f.*, (f.updated_date at time zone 'Asia/Kolkata')::date as done_on
    from public.fk_returns f
    where f.platform = 'flipkart'
      and f.return_status = 'completed'
      and f.updated_date is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'return_id', r.return_id,
           'order_item_id', r.order_item_id,
           'order_id', r.order_id,
           'sku', r.sku,
           'source', r.source,
           'reason', r.reason,
           'sub_reason', r.sub_reason,
           'quantity', r.quantity,
           'warehouse_id', r.warehouse_id,
           'returned_on', r.done_on,
           'days_left', s.days - (s.today - r.done_on)
         ) order by s.days - (s.today - r.done_on), r.return_id), '[]'::jsonb)
  from r cross join s
  where r.done_on >= s.today - 30
    and not exists (
      select 1 from public.return_checks c
      where c.platform = r.platform and c.return_id = r.return_id and c.order_item_id = r.order_item_id
    )
$$;
revoke all on function public.returns_to_claim() from public, anon;
grant execute on function public.returns_to_claim() to authenticated;
