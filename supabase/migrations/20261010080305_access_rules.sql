-- VRPRIME OPS: Row Level Security, storage and search.
--
-- Roles
--   owner, manager, listing : see every post and ticket
--   warehouse               : sees a post only if it is tagged with one of their
--                             warehouses, assigned to them, or created by them
-- Deactivated users (profiles.active = false) see nothing.

-- ---------------------------------------------------------------------------
-- Helper functions. They live in `private`, which the API does not expose.
-- ---------------------------------------------------------------------------

create function private.user_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = (select auth.uid()) and active
$$;

create function private.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.user_role() in ('owner', 'manager', 'listing'), false)
$$;

create function private.can_see_post(p_warehouse_id uuid, p_assignee_id uuid, p_created_by uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select case private.user_role()
    when 'owner' then true
    when 'manager' then true
    when 'listing' then true
    when 'warehouse' then
      p_assignee_id = (select auth.uid())
      or p_created_by = (select auth.uid())
      or (p_warehouse_id is not null and exists (
            select 1 from public.user_warehouses uw
            where uw.user_id = (select auth.uid()) and uw.warehouse_id = p_warehouse_id))
    else false
  end
$$;

create function private.can_see_post_id(p_post_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select private.can_see_post(p.warehouse_id, p.assignee_id, p.created_by)
    from public.posts p where p.id = p_post_id), false)
$$;

-- Photos are stored as "<post id>/<file name>".
create function private.can_see_attachment_path(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  folder text := split_part(p_name, '/', 1);
begin
  if folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return private.can_see_post_id(folder::uuid);
end $$;

revoke all on all functions in schema private from public, anon;
grant usage on schema private to authenticated, service_role;
grant execute on all functions in schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Grants: signed-in users only. RLS below decides which rows.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

alter table public.profiles enable row level security;
alter table public.warehouses enable row level security;
alter table public.user_warehouses enable row level security;
alter table public.posts enable row level security;
alter table public.post_comments enable row level security;
alter table public.post_attachments enable row level security;
alter table public.post_events enable row level security;
alter table public.tickets enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notifications enable row level security;
alter table public.app_settings enable row level security;

-- People and places: readable by any active user. Changes go through the
-- Admin page, which checks the owner role on the server and uses the service key.
create policy profiles_select on public.profiles for select to authenticated
  using ((select private.user_role()) is not null or id = (select auth.uid()));

create policy warehouses_select on public.warehouses for select to authenticated
  using ((select private.user_role()) is not null);

create policy user_warehouses_select on public.user_warehouses for select to authenticated
  using ((select private.user_role()) is not null);

-- Posts. No delete policy: posts are cancelled, never deleted.
create policy posts_select on public.posts for select to authenticated
  using (private.can_see_post(warehouse_id, assignee_id, created_by));

create policy posts_insert on public.posts for insert to authenticated
  with check (created_by = (select auth.uid())
              and private.can_see_post(warehouse_id, assignee_id, created_by));

create policy posts_update on public.posts for update to authenticated
  using (private.can_see_post(warehouse_id, assignee_id, created_by))
  with check (private.can_see_post(warehouse_id, assignee_id, created_by));

create policy post_comments_select on public.post_comments for select to authenticated
  using (private.can_see_post_id(post_id));

create policy post_comments_insert on public.post_comments for insert to authenticated
  with check (author_id = (select auth.uid()) and private.can_see_post_id(post_id));

create policy post_attachments_select on public.post_attachments for select to authenticated
  using (private.can_see_post_id(post_id));

create policy post_attachments_insert on public.post_attachments for insert to authenticated
  with check (uploaded_by = (select auth.uid()) and private.can_see_post_id(post_id));

create policy post_attachments_delete on public.post_attachments for delete to authenticated
  using (private.can_see_post_id(post_id)
         and (uploaded_by = (select auth.uid())
              or (select private.user_role()) in ('owner', 'manager')));

create policy post_events_select on public.post_events for select to authenticated
  using (private.can_see_post_id(post_id));

-- Tickets: staff see all; warehouse users see tickets linked to a post they can see.
create policy tickets_select on public.tickets for select to authenticated
  using ((select private.is_staff())
         or (post_id is not null and private.can_see_post_id(post_id)));

create policy tickets_insert on public.tickets for insert to authenticated
  with check (created_by = (select auth.uid())
              and ((select private.is_staff())
                   or (post_id is not null and private.can_see_post_id(post_id))));

create policy tickets_update on public.tickets for update to authenticated
  using ((select private.is_staff())
         or (post_id is not null and private.can_see_post_id(post_id)))
  with check ((select private.is_staff())
              or (post_id is not null and private.can_see_post_id(post_id)));

-- Push subscriptions and notifications: your own only.
create policy push_subscriptions_own on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid()) and (select private.user_role()) is not null)
  with check (user_id = (select auth.uid()) and (select private.user_role()) is not null);

create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()) and (select private.user_role()) is not null);

create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid()) and (select private.user_role()) is not null)
  with check (user_id = (select auth.uid()));

-- Settings: everyone reads, only the owner changes.
create policy app_settings_select on public.app_settings for select to authenticated
  using ((select private.user_role()) is not null);

create policy app_settings_update on public.app_settings for update to authenticated
  using ((select private.user_role()) = 'owner')
  with check ((select private.user_role()) = 'owner');

-- ---------------------------------------------------------------------------
-- Photo storage: one private bucket, access follows post visibility.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-attachments', 'post-attachments', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy post_attachments_read on storage.objects for select to authenticated
  using (bucket_id = 'post-attachments' and private.can_see_attachment_path(name));

create policy post_attachments_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'post-attachments' and private.can_see_attachment_path(name));

create policy post_attachments_remove on storage.objects for delete to authenticated
  using (bucket_id = 'post-attachments' and owner_id = (select auth.uid())::text);

-- ---------------------------------------------------------------------------
-- Search: one box that finds a post by number, title, details, SKU, ticket ID,
-- listing ID, invoice number or person. Runs as the caller, so RLS applies.
-- ---------------------------------------------------------------------------

create function public.search_posts(q text) returns setof public.posts
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

revoke all on function public.search_posts(text) from public, anon;
grant execute on function public.search_posts(text) to authenticated, service_role;
