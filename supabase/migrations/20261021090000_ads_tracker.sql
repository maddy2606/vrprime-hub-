-- The Ads tracker: Flipkart Ads (PLA) spend per SKU and campaign, one scan per period. Owner and admin only.
--
--   ad_tracked_skus  the seller SKUs the tracker shows (upper case)
--   ad_campaigns     the campaign log: campaigns added by hand, and every campaign a sync found on a tracked SKU.
--                    Daily budget, start date, status and "shared budget" are typed in here (the report has none of them).
--   ad_scans         one per synced period (a second sync of the same period replaces the first)
--   ad_scan_rows     the report's lines added up per SKU and campaign, for every SKU in the report (not only tracked ones,
--                    so a SKU tracked later still has its history)

create table if not exists public.ad_tracked_skus (
  sku text primary key check (sku = upper(btrim(sku)) and char_length(sku) between 1 and 60),
  added_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.ad_campaigns (
  campaign_id text primary key check (campaign_id ~ '^[A-Z0-9]{4,30}$'),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  skus text[] not null default '{}' check (cardinality(skus) <= 200),
  campaign_type text check (campaign_type is null or char_length(campaign_type) <= 40),
  daily_budget numeric(12, 2) check (daily_budget is null or daily_budget >= 0),
  shared_budget boolean not null default false,
  start_date date,
  status text not null default 'Live' check (status in ('Live', 'Paused', 'Ended', 'Draft')),
  notes text check (notes is null or char_length(notes) <= 500),
  source text not null default 'manual' check (source in ('manual', 'report')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ad_scans (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  days integer not null check (days between 1 and 92),
  filename text check (filename is null or char_length(filename) <= 200),
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (period_end >= period_start),
  unique (period_start, period_end)
);
create index if not exists ad_scans_end_idx on public.ad_scans (period_end desc);

create table if not exists public.ad_scan_rows (
  scan_id uuid not null references public.ad_scans (id) on delete cascade,
  sku text not null check (char_length(sku) between 1 and 60),
  campaign_id text not null check (char_length(campaign_id) between 1 and 30),
  campaign_name text not null check (char_length(campaign_name) <= 200),
  spend numeric(14, 2) not null default 0,
  views bigint not null default 0,
  clicks bigint not null default 0,
  units integer not null default 0,
  revenue numeric(14, 2) not null default 0,
  primary key (scan_id, sku, campaign_id)
);
create index if not exists ad_scan_rows_sku_idx on public.ad_scan_rows (sku, scan_id);

-- Access: owner and admin read and write; nobody else sees anything.
do $$
declare t text;
begin
  foreach t in array array['ad_tracked_skus', 'ad_campaigns', 'ad_scans', 'ad_scan_rows'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select private.user_role()) in (''owner'', ''admin'')) with check ((select private.user_role()) in (''owner'', ''admin''))',
      t || '_staff', t);
  end loop;
end $$;

-- Saves one synced report in one step: replaces any scan of the same period, saves its lines, and adds the campaigns
-- it found on tracked SKUs to the log (adding SKUs to campaigns already there). Runs as the signed-in person, so the
-- policies above apply too.
create or replace function public.ads_tracker_save_scan(p_from date, p_to date, p_filename text, p_rows jsonb, p_campaigns jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if coalesce((select private.user_role()), '') not in ('owner', 'admin') then
    raise exception 'Only the owner or an admin can sync ads' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from + 1 > 92 then
    raise exception 'The period is not valid' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 20000 then
    raise exception 'The rows are not valid' using errcode = '22023';
  end if;

  delete from public.ad_scans where period_start = p_from and period_end = p_to;
  insert into public.ad_scans (period_start, period_end, days, filename, uploaded_by)
  values (p_from, p_to, p_to - p_from + 1, left(p_filename, 200), (select auth.uid()))
  returning id into v_id;

  insert into public.ad_scan_rows (scan_id, sku, campaign_id, campaign_name, spend, views, clicks, units, revenue)
  select v_id, left(r ->> 'sku', 60), left(r ->> 'campaign_id', 30), left(coalesce(nullif(r ->> 'campaign_name', ''), r ->> 'campaign_id'), 200),
         coalesce((r ->> 'spend')::numeric, 0), coalesce((r ->> 'views')::numeric, 0)::bigint, coalesce((r ->> 'clicks')::numeric, 0)::bigint,
         coalesce((r ->> 'units')::numeric, 0)::integer, coalesce((r ->> 'revenue')::numeric, 0)
  from jsonb_array_elements(p_rows) r
  where coalesce(r ->> 'sku', '') <> '' and coalesce(r ->> 'campaign_id', '') <> '';

  if jsonb_typeof(p_campaigns) = 'array' then
    insert into public.ad_campaigns (campaign_id, name, skus, source, created_by)
    select c ->> 'campaign_id', left(c ->> 'name', 200), array(select jsonb_array_elements_text(c -> 'skus')), 'report', (select auth.uid())
    from jsonb_array_elements(p_campaigns) c
    where (c ->> 'campaign_id') ~ '^[A-Z0-9]{4,30}$' and coalesce(btrim(c ->> 'name'), '') <> ''
    on conflict (campaign_id) do update
      set skus = (select array_agg(distinct s order by s) from unnest(public.ad_campaigns.skus || excluded.skus) s),
          updated_at = now();
  end if;

  return v_id;
end;
$$;

revoke all on function public.ads_tracker_save_scan(date, date, text, jsonb, jsonb) from public, anon;
grant execute on function public.ads_tracker_save_scan(date, date, text, jsonb, jsonb) to authenticated;
