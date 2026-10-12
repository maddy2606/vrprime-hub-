-- Phase 2: notifications, push delivery, ticket helpers, daily schedule.
-- Additive only: no existing column or table is changed or dropped.
--
-- How push works
--   1. A trigger writes a row to public.notifications (the in-app bell reads these).
--   2. For event notifications, a second trigger asks the Edge Function `notify`
--      to push it, using pg_net. The request carries a secret that only the
--      database and the function know (private.internal_config), so nobody else
--      can call the function.
--   3. Once a day at 04:00 UTC (9:30 AM IST), pg_cron calls the same function,
--      which builds the overdue and ticket follow-up digests.

create extension if not exists pg_net;
create extension if not exists pg_cron with schema pg_catalog;

-- ---------------------------------------------------------------------------
-- Internal config: never exposed through the API (schema `private`, RLS on, no policies)
-- ---------------------------------------------------------------------------

create table private.internal_config (
  key text primary key,
  value text not null
);
alter table private.internal_config enable row level security;
revoke all on private.internal_config from public, anon, authenticated;

-- The Edge Function for this project. A different database (for example a local
-- one) would call this URL with the wrong secret and be refused.
insert into private.internal_config (key, value) values
  ('notify_url', 'https://yjjnhdughybemjxsivho.supabase.co/functions/v1/notify'),
  ('notify_secret', encode(extensions.gen_random_bytes(32), 'hex'));

-- Sends one request to the Edge Function. Never raises: a failed push must not
-- undo the post, comment or ticket that caused it.
create function private.call_notify(p_body jsonb) returns void
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
    url := v_url,
    body := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', v_secret),
    timeout_milliseconds := 10000);
exception when others then
  raise warning 'call_notify failed: %', sqlerrm;
end $$;

-- The Edge Function uses this to check the secret it was sent. Service role only.
create function public.check_internal_secret(candidate text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.internal_config
    where key = 'notify_secret' and value = candidate and candidate <> '')
$$;
revoke all on function public.check_internal_secret(text) from public, anon, authenticated;
grant execute on function public.check_internal_secret(text) to service_role;

-- ---------------------------------------------------------------------------
-- Notification triggers
-- ---------------------------------------------------------------------------

create function private.notify_user(
  p_user uuid, p_kind text, p_title text, p_body text, p_post uuid, p_ticket uuid
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_user is null then
    return;
  end if;
  insert into public.notifications (user_id, kind, title, body, post_id, ticket_id)
  select u.id, p_kind, p_title, p_body, p_post, p_ticket
  from public.profiles u
  where u.id = p_user and u.active;
end $$;

create function private.display_name(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select name from public.profiles where id = p_user), 'Someone')
$$;

-- Assigned to you / your post was marked done
create function private.posts_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  label text := 'VR-' || new.number;
  who text := private.display_name((select auth.uid()));
  r uuid;
begin
  if new.assignee_id is not null
     and new.assignee_id is distinct from actor
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    perform private.notify_user(new.assignee_id, 'assigned', 'Assigned to you: ' || label, new.title, new.id, null);
  end if;

  if tg_op = 'UPDATE' and new.status = 'done' and old.status <> 'done' then
    for r in select distinct x from unnest(array[new.created_by, new.assignee_id]) as x
             where x is not null and x is distinct from actor loop
      perform private.notify_user(r, 'done', label || ' marked done', who || ' marked it done: ' || new.title, new.id, null);
    end loop;
  end if;
  return new;
end $$;

create trigger posts_notify after insert or update of assignee_id, status on public.posts
  for each row execute function private.posts_notify();

-- Someone commented on your post
create function private.comments_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  p record;
  r uuid;
begin
  select id, number, title, created_by, assignee_id into p from public.posts where id = new.post_id;
  if not found then
    return new;
  end if;
  for r in select distinct x from unnest(array[p.created_by, p.assignee_id]) as x
           where x is not null and x is distinct from new.author_id loop
    perform private.notify_user(
      r, 'comment',
      private.display_name(new.author_id) || ' commented on VR-' || p.number,
      left(new.body, 160), p.id, null);
  end loop;
  return new;
end $$;

create trigger comments_notify after insert on public.post_comments
  for each row execute function private.comments_notify();

-- Push the event notifications. Digests (overdue, follow_up) are pushed by the
-- daily job itself, so they are not listed here.
create function private.notifications_push() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.call_notify(jsonb_build_object('job', 'push', 'notification_id', new.id));
  return new;
end $$;

create trigger notifications_push after insert on public.notifications
  for each row when (new.kind in ('assigned', 'comment', 'done', 'test'))
  execute function private.notifications_push();

-- Lets a person send themselves a test (used by the "Send test" button).
create function public.send_test_notification() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or private.user_role() is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into public.notifications (user_id, kind, title, body)
  values ((select auth.uid()), 'test', 'Test notification', 'If you can read this, notifications work on this device.');
end $$;
revoke all on function public.send_test_notification() from public, anon;
grant execute on function public.send_test_notification() to authenticated;

-- Saves this device's push subscription. A shared phone moves to whoever signed in last.
create function public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or private.user_role() is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if char_length(p_endpoint) not between 20 and 1000 or p_endpoint !~ '^https://'
     or char_length(p_p256dh) not between 20 and 200 or char_length(p_auth) not between 8 and 100 then
    raise exception 'invalid subscription' using errcode = '22023';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values ((select auth.uid()), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();
end $$;
revoke all on function public.register_push_subscription(text, text, text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text) to authenticated;

-- People can mark their own notifications read, and nothing else about them.
revoke insert, update, delete on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- ---------------------------------------------------------------------------
-- Tickets
-- ---------------------------------------------------------------------------

create index tickets_status_idx on public.tickets (status);

-- Raising a ticket from a post shows up in that post's history.
alter table public.post_events drop constraint post_events_kind_check;
alter table public.post_events add constraint post_events_kind_check
  check (kind in ('created', 'status', 'assignee', 'edit', 'ticket'));

create function private.tickets_log_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.post_id is not null then
    insert into public.post_events (post_id, actor_id, kind, changes)
    values (new.post_id, coalesce((select auth.uid()), new.created_by), 'ticket',
            jsonb_build_object('number', new.number, 'ticket_id', new.ticket_id));
  end if;
  return new;
end $$;

create trigger tickets_log_event after insert on public.tickets
  for each row execute function private.tickets_log_event();

-- One search box for tickets: marketplace ticket ID, SKU, VR-T number, notes. Runs as the caller, so RLS applies.
create function public.search_tickets(q text) returns setof public.tickets
language sql stable security invoker set search_path = '' as $$
  with needle as (
    select '%' || replace(replace(replace(btrim(coalesce(q, '')), '\', '\\'), '%', '\%'), '_', '\_')
           || '%' as pat
  )
  select t.*
  from public.tickets t, needle n
  where btrim(coalesce(q, '')) = ''
     or t.ticket_id ilike n.pat
     or t.sku ilike n.pat
     or ('VR-T-' || t.number) ilike n.pat
     or t.resolution_notes ilike n.pat
$$;
revoke all on function public.search_tickets(text) from public, anon;
grant execute on function public.search_tickets(text) to authenticated, service_role;

-- Header numbers for the Tickets page. Runs as the caller, so RLS applies.
create function public.ticket_totals()
returns table (open_count bigint, open_amount numeric, recovered_amount numeric, follow_up_due bigint)
language sql stable security invoker set search_path = '' as $$
  select
    count(*) filter (where status in ('open', 'waiting_marketplace')),
    coalesce(sum(amount_involved) filter (where status in ('open', 'waiting_marketplace')), 0),
    coalesce(sum(amount_recovered), 0),
    count(*) filter (where status in ('open', 'waiting_marketplace')
                       and next_follow_up <= (now() at time zone 'Asia/Kolkata')::date)
  from public.tickets
$$;
revoke all on function public.ticket_totals() from public, anon;
grant execute on function public.ticket_totals() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Daily job: 9:30 AM IST = 04:00 UTC
-- ---------------------------------------------------------------------------

-- Functions created above default to executable by everyone; only the
-- database itself (triggers, cron) needs to run them.
revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to service_role;

select cron.unschedule('daily-notify') where exists (select 1 from cron.job where jobname = 'daily-notify');
select cron.schedule('daily-notify', '0 4 * * *', $$select private.call_notify('{"job":"daily"}'::jsonb)$$);
