-- WhatsApp expenses are fetched by themselves every 12 hours, at 9 am and 9 pm India time, the same as pressing
-- Fetch from WhatsApp. The fetch needs the WhatsApp library, so it runs on the site: for each run the database makes a
-- fresh one-time token, keeps it here and sends it to the site, which trades it in (once, within 10 minutes) before
-- fetching. No secret has to be copied anywhere.
--
-- If fetching stops working (WhatsApp logged the site out, or no good fetch for more than a day) the owner gets an
-- alert (bell, push and email), at most every 12 hours. Unlinking on purpose raises nothing.

insert into private.internal_config (key, value) values ('app_url', 'https://vrprime-hub.vercel.app') on conflict (key) do nothing;

create table if not exists private.whatsapp_auto_tokens (
  token text primary key,
  created_at timestamptz not null default now()
);
alter table private.whatsapp_auto_tokens enable row level security;
revoke all on private.whatsapp_auto_tokens from public, anon, authenticated;

-- Starts one automatic fetch. Does nothing until WhatsApp is linked and the group is chosen. Never raises.
create or replace function private.start_whatsapp_auto_fetch() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if not exists (select 1 from public.whatsapp_state where id and linked_as is not null and group_id is not null) then
    return;
  end if;
  select value into v_url from private.internal_config where key = 'app_url';
  if v_url is null then
    return;
  end if;
  delete from private.whatsapp_auto_tokens where created_at < now() - interval '1 day';
  insert into private.whatsapp_auto_tokens (token) values (v_token);
  -- The site answers at once and fetches after, so a short wait is enough.
  perform net.http_post(
    url := rtrim(v_url, '/') || '/api/whatsapp/auto',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-auto-token', v_token),
    timeout_milliseconds := 30000);
exception when others then
  raise warning 'start_whatsapp_auto_fetch failed: %', sqlerrm;
end $$;
revoke all on function private.start_whatsapp_auto_fetch() from public, anon, authenticated;

-- The site trades a token in before an automatic fetch: true once, for a token made in the last 10 minutes.
create or replace function public.claim_whatsapp_auto_token(p_token text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_ok boolean;
begin
  delete from private.whatsapp_auto_tokens
  where token = p_token and created_at > now() - interval '10 minutes'
  returning true into v_ok;
  return coalesce(v_ok, false);
end $$;
revoke all on function public.claim_whatsapp_auto_token(text) from public, anon, authenticated;
grant execute on function public.claim_whatsapp_auto_token(text) to service_role;

-- An alert for the owner (expenses are owner only) when WhatsApp expenses stop coming in.
create or replace function private.alerts_whatsapp() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  s record;
  v_title constant text := 'WhatsApp expenses are not being fetched';
  v_body text;
  u uuid;
  n integer := 0;
begin
  select linked_as, group_id, last_fetch_at, last_error into s from public.whatsapp_state where id;
  if not found or s.group_id is null then
    return 0;
  end if;
  if s.linked_as is null then
    -- Unlinked on purpose leaves no error: nothing to say.
    if s.last_error is null then
      return 0;
    end if;
    v_body := 'WhatsApp logged the site out, so new expenses are not coming in. Open Expenses and press Link WhatsApp.';
  elsif s.last_fetch_at < now() - interval '25 hours' then
    v_body := 'The last good fetch was more than a day ago.' || coalesce(' Last try: ' || s.last_error, '')
      || ' Open Expenses and press Fetch from WhatsApp; if it still fails, press Link again.';
  else
    return 0;
  end if;
  for u in select id from public.profiles where active and role = 'owner' loop
    if not exists (select 1 from public.notifications x where x.user_id = u and x.kind = 'sync_alert' and x.title = v_title
                   and x.created_at > now() - interval '12 hours') then
      insert into public.notifications (user_id, kind, title, body) values (u, 'sync_alert', v_title, v_body);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function private.alerts_whatsapp() from public, anon, authenticated;

select cron.unschedule(jobname) from cron.job where jobname in ('whatsapp-auto-fetch', 'alerts-whatsapp');
-- 03:30 and 15:30 UTC are 9:00 am and 9:00 pm in India.
select cron.schedule('whatsapp-auto-fetch', '30 3,15 * * *', $$select private.start_whatsapp_auto_fetch()$$);
select cron.schedule('alerts-whatsapp', '40 * * * *', $$select private.alerts_whatsapp()$$);
