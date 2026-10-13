-- Three roles instead of four.
--
--   owner      everything, settings, users. There can be several; the last active one can never be demoted,
--              deactivated or deleted.
--   admin      what manager and listing used to be, merged: sees everything, creates, assigns and completes every
--              post type, raises tickets, Sync now. No settings, no user management.
--   warehouse  unchanged: only their own warehouses.
--
-- Existing manager and listing users become admin. Every new screen, tab or action is owner + admin only until
-- the owner reviews access; warehouse users get nothing new unless it is said so.

alter table public.profiles drop constraint profiles_role_check;
update public.profiles set role = 'admin' where role in ('manager', 'listing');
alter table public.profiles add constraint profiles_role_check check (role in ('owner', 'admin', 'warehouse'));

-- ---------------------------------------------------------------------------
-- The helpers every policy uses
-- ---------------------------------------------------------------------------

create or replace function private.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.user_role() in ('owner', 'admin'), false)
$$;

create or replace function private.can_see_post(p_warehouse_id uuid, p_assignee_id uuid, p_created_by uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select case private.user_role()
    when 'owner' then true
    when 'admin' then true
    when 'warehouse' then
      p_assignee_id = (select auth.uid())
      or p_created_by = (select auth.uid())
      or (p_warehouse_id is not null and exists (
            select 1 from public.user_warehouses uw
            where uw.user_id = (select auth.uid()) and uw.warehouse_id = p_warehouse_id))
    else false
  end
$$;

drop policy post_attachments_delete on public.post_attachments;
create policy post_attachments_delete on public.post_attachments for delete to authenticated
  using (private.can_see_post_id(post_id)
         and (uploaded_by = (select auth.uid())
              or (select private.user_role()) in ('owner', 'admin')));

-- ---------------------------------------------------------------------------
-- Who may press Sync now, and who hears about orders that may miss dispatch
-- ---------------------------------------------------------------------------

create or replace function public.request_stock_sync() returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or coalesce(private.user_role(), '') not in ('owner', 'admin') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return private.start_stock_sync('manual', (select auth.uid()));
end $$;

create or replace function public.request_orders_sync(p_kind text) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or coalesce(private.user_role(), '') not in ('owner', 'admin') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_kind not in ('pending', 'daily', 'upcoming') then
    raise exception 'unknown kind' using errcode = '22023';
  end if;
  return private.start_order_run(p_kind, 'manual', (select auth.uid()));
end $$;

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

  for u in select id from public.profiles where active and role in ('owner', 'admin') loop
    insert into public.notifications (user_id, kind, title, body) values (u, 'dispatch_risk', v_title, v_body);
  end loop;
  return v_total;
end $$;

-- ---------------------------------------------------------------------------
-- The last active owner can never be demoted, deactivated or deleted (a second owner can be promoted first).
-- This is the database's own guard, whatever the app does.
-- ---------------------------------------------------------------------------

create or replace function private.protect_last_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext('profiles_owners'));
  if old.role = 'owner' and old.active
     and (tg_op = 'DELETE' or new.role <> 'owner' or not new.active)
     and not exists (select 1 from public.profiles p where p.role = 'owner' and p.active and p.id <> old.id) then
    raise exception 'There must always be at least one active owner' using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists protect_last_owner on public.profiles;
create trigger protect_last_owner before update or delete on public.profiles
  for each row execute function private.protect_last_owner();

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to service_role;
grant execute on function private.user_role(), private.is_staff(), private.can_see_post(uuid, uuid, uuid), private.can_see_post_id(uuid) to authenticated;
