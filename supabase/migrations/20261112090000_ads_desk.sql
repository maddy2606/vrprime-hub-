-- Ads Desk: the analysis page over Flipkart Ads (PLA). On top of the Ads tracker's daily spend (ad_daily) and per-SKU
-- scans (ad_scans / ad_scan_rows) it keeps the Search Term and Keyword reports and the negative-keyword list.
--
--   ad_term_scans   one per synced Search Term ('st') or Keyword ('kw') report period; the newest 4 of each kind are kept
--   ad_term_rows    the report added up per campaign and term (keywords: per match type too). A Search Term report has
--                   hundreds of thousands of lines with no clicks; only lines with a click, spend or a sale are kept.
--   ad_negatives    what was decided about a wasteful search term in a campaign: added as a negative, or ignored
--   ads_desk_data   everything the page needs, in one read
--
-- Saving: the signed-in owner or admin (the page's Sync), or a direct database connection (the sync script on the owner's
-- PC, which saves through the signed-in Supabase CLI and has no app user). Nobody else.

create or replace function private.ads_can_save() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select private.user_role()), '') in ('owner', 'admin')
         -- A direct database connection carries no request claims at all; requests through the API always do.
         or coalesce(nullif(current_setting('request.jwt.claims', true), ''), '') = ''
         or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
$$;
revoke all on function private.ads_can_save() from public, anon;
grant execute on function private.ads_can_save() to authenticated, service_role;

create table if not exists public.ad_term_scans (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('st', 'kw')),
  period_start date not null,
  period_end date not null,
  lines integer not null default 0,
  created_at timestamptz not null default now(),
  check (period_end >= period_start),
  unique (kind, period_start, period_end)
);

create table if not exists public.ad_term_rows (
  scan_id uuid not null references public.ad_term_scans (id) on delete cascade,
  campaign_id text not null check (char_length(campaign_id) between 1 and 40),
  campaign_name text not null check (char_length(campaign_name) <= 200),
  term text not null check (char_length(term) between 1 and 200),
  match_type text not null default '' check (char_length(match_type) <= 20),
  views bigint not null default 0,
  clicks bigint not null default 0,
  spend numeric(14, 2) not null default 0,
  units integer not null default 0,
  revenue numeric(14, 2) not null default 0,
  primary key (scan_id, campaign_id, term, match_type)
);

create table if not exists public.ad_negatives (
  campaign_id text not null check (char_length(campaign_id) between 1 and 40),
  term text not null check (char_length(term) between 1 and 200),
  status text not null check (status in ('added', 'ignored')),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (campaign_id, term)
);

do $$
declare t text;
begin
  foreach t in array array['ad_term_scans', 'ad_term_rows', 'ad_negatives'] loop
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

-- Saves one Search Term or Keyword report. Sent in parts when large: the first part (p_append false) replaces any scan
-- of the same period, later parts add to it. Rows: [{campaign_id, campaign_name, term, match_type, views, clicks, spend,
-- units, revenue}].
create or replace function public.ads_save_terms(p_kind text, p_from date, p_to date, p_rows jsonb, p_append boolean default false, p_lines integer default 0)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not (select private.ads_can_save()) then
    raise exception 'Only the owner or an admin can sync ads' using errcode = '42501';
  end if;
  if p_kind not in ('st', 'kw') or p_from is null or p_to is null or p_to < p_from or p_to - p_from + 1 > 92 then
    raise exception 'The report is not valid' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 20000 then
    raise exception 'The rows are not valid' using errcode = '22023';
  end if;

  if p_append then
    select id into v_id from public.ad_term_scans where kind = p_kind and period_start = p_from and period_end = p_to;
  end if;
  if v_id is null then
    delete from public.ad_term_scans where kind = p_kind and period_start = p_from and period_end = p_to;
    insert into public.ad_term_scans (kind, period_start, period_end, lines) values (p_kind, p_from, p_to, greatest(coalesce(p_lines, 0), 0))
    returning id into v_id;
    -- Keep the newest 4 periods of each kind.
    delete from public.ad_term_scans s
    where s.kind = p_kind and s.id not in (select x.id from public.ad_term_scans x where x.kind = p_kind order by x.period_end desc, x.created_at desc limit 4);
  end if;

  insert into public.ad_term_rows (scan_id, campaign_id, campaign_name, term, match_type, views, clicks, spend, units, revenue)
  select v_id, left(r ->> 'campaign_id', 40), max(left(coalesce(nullif(r ->> 'campaign_name', ''), r ->> 'campaign_id'), 200)), left(r ->> 'term', 200),
         left(coalesce(r ->> 'match_type', ''), 20),
         sum(coalesce((r ->> 'views')::numeric, 0))::bigint, sum(coalesce((r ->> 'clicks')::numeric, 0))::bigint, sum(coalesce((r ->> 'spend')::numeric, 0)),
         sum(coalesce((r ->> 'units')::numeric, 0))::integer, sum(coalesce((r ->> 'revenue')::numeric, 0))
  from jsonb_array_elements(p_rows) r
  where coalesce(r ->> 'campaign_id', '') <> '' and coalesce(r ->> 'term', '') <> ''
  group by 2, 4, 5
  on conflict (scan_id, campaign_id, term, match_type) do update
    set views = public.ad_term_rows.views + excluded.views, clicks = public.ad_term_rows.clicks + excluded.clicks, spend = public.ad_term_rows.spend + excluded.spend,
        units = public.ad_term_rows.units + excluded.units, revenue = public.ad_term_rows.revenue + excluded.revenue;
  return v_id;
end;
$$;
revoke all on function public.ads_save_terms(text, date, date, jsonb, boolean, integer) from public, anon;
grant execute on function public.ads_save_terms(text, date, date, jsonb, boolean, integer) to authenticated;

-- The daily report: the same as before, and also from the sync script.
create or replace function public.ads_save_daily(p_from date, p_to date, p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_n integer;
begin
  if not (select private.ads_can_save()) then
    raise exception 'Only the owner or an admin can sync ads' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from + 1 > 92 then
    raise exception 'The period is not valid' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 50000 then
    raise exception 'The rows are not valid' using errcode = '22023';
  end if;

  delete from public.ad_daily where day between p_from and p_to;
  insert into public.ad_daily (day, campaign_id, campaign_name, spend, views, clicks, units, revenue)
  select (r ->> 'day')::date, left(r ->> 'campaign_id', 40), max(left(coalesce(nullif(r ->> 'campaign_name', ''), r ->> 'campaign_id'), 200)),
         sum(coalesce((r ->> 'spend')::numeric, 0)), sum(coalesce((r ->> 'views')::numeric, 0))::bigint, sum(coalesce((r ->> 'clicks')::numeric, 0))::bigint,
         sum(coalesce((r ->> 'units')::numeric, 0))::integer, sum(coalesce((r ->> 'revenue')::numeric, 0))
  from jsonb_array_elements(p_rows) r
  where (r ->> 'day') ~ '^\d{4}-\d{2}-\d{2}$' and (r ->> 'day')::date between p_from and p_to and coalesce(r ->> 'campaign_id', '') <> ''
  group by 1, 2;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- The per-SKU (FSN) report: the same as before, also from the sync script. With no campaign list given, the campaigns
-- on tracked SKUs are worked out here.
create or replace function public.ads_tracker_save_scan(p_from date, p_to date, p_filename text, p_rows jsonb, p_campaigns jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_campaigns jsonb := p_campaigns;
begin
  if not (select private.ads_can_save()) then
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

  if v_campaigns is null or jsonb_typeof(v_campaigns) <> 'array' then
    select coalesce(jsonb_agg(jsonb_build_object('campaign_id', x.campaign_id, 'name', x.name, 'skus', x.skus)), '[]'::jsonb) into v_campaigns
    from (
      select r.campaign_id, max(r.campaign_name) as name, to_jsonb(array_agg(distinct r.sku)) as skus
      from public.ad_scan_rows r
      join public.ad_tracked_skus t on t.sku = r.sku
      where r.scan_id = v_id
      group by r.campaign_id
    ) x;
  end if;

  insert into public.ad_campaigns (campaign_id, name, skus, source, created_by)
  select c ->> 'campaign_id', left(c ->> 'name', 200), array(select jsonb_array_elements_text(c -> 'skus')), 'report', (select auth.uid())
  from jsonb_array_elements(v_campaigns) c
  where (c ->> 'campaign_id') ~ '^[A-Z0-9]{4,30}$' and coalesce(btrim(c ->> 'name'), '') <> ''
  on conflict (campaign_id) do update
    set skus = (select array_agg(distinct s order by s) from unnest(public.ad_campaigns.skus || excluded.skus) s),
        updated_at = now();

  return v_id;
end;
$$;

-- Everything the Ads Desk shows, in one read (row level security applies: owner and admin only). Rows are arrays, to
-- keep the answer small:
--   daily  [day, campaign_id, name, spend, views, clicks, units, revenue]     the last p_days days
--   fsn    [sku, campaign_id, name, spend, views, clicks, units, revenue]     the newest per-SKU scan
--   st     [campaign_id, name, term, views, clicks, spend, units, revenue]    the newest Search Term report: terms with a
--          sale or ₹10+ spend; the rest are added up per campaign in "rest" ([campaign_id, views, clicks, spend, terms])
--   kw     [campaign_id, name, keyword, match, views, clicks, spend, units, revenue]
--   neg    [campaign_id, term, status]
create or replace function public.ads_desk_data(p_days integer default 45)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with fsn as (select * from public.ad_scans order by period_end desc, created_at desc limit 1),
       st as (select * from public.ad_term_scans where kind = 'st' order by period_end desc, created_at desc limit 1),
       kw as (select * from public.ad_term_scans where kind = 'kw' order by period_end desc, created_at desc limit 1)
  select jsonb_build_object(
    'daily', coalesce((select jsonb_agg(jsonb_build_array(d.day, d.campaign_id, d.campaign_name, d.spend, d.views, d.clicks, d.units, d.revenue) order by d.day, d.campaign_id)
                       from public.ad_daily d where d.day > current_date - greatest(least(p_days, 120), 1)), '[]'::jsonb),
    'fsn', (select jsonb_build_object('from', f.period_start, 'to', f.period_end, 'at', f.created_at, 'rows',
              coalesce((select jsonb_agg(jsonb_build_array(r.sku, r.campaign_id, r.campaign_name, r.spend, r.views, r.clicks, r.units, r.revenue))
                        from public.ad_scan_rows r where r.scan_id = f.id), '[]'::jsonb)) from fsn f),
    'st', (select jsonb_build_object('from', s.period_start, 'to', s.period_end, 'at', s.created_at, 'lines', s.lines,
              'rows', coalesce((select jsonb_agg(jsonb_build_array(r.campaign_id, r.campaign_name, r.term, r.views, r.clicks, r.spend, r.units, r.revenue))
                        from public.ad_term_rows r where r.scan_id = s.id and (r.units > 0 or r.spend >= 10)), '[]'::jsonb),
              'rest', coalesce((select jsonb_agg(jsonb_build_array(x.campaign_id, x.views, x.clicks, x.spend, x.n))
                        from (select r.campaign_id, sum(r.views) as views, sum(r.clicks) as clicks, sum(r.spend) as spend, count(*) as n
                              from public.ad_term_rows r where r.scan_id = s.id and not (r.units > 0 or r.spend >= 10) group by r.campaign_id) x), '[]'::jsonb)) from st s),
    'kw', (select jsonb_build_object('from', k.period_start, 'to', k.period_end, 'at', k.created_at, 'rows',
              coalesce((select jsonb_agg(jsonb_build_array(r.campaign_id, r.campaign_name, r.term, r.match_type, r.views, r.clicks, r.spend, r.units, r.revenue))
                        from public.ad_term_rows r where r.scan_id = k.id), '[]'::jsonb)) from kw k),
    'neg', coalesce((select jsonb_agg(jsonb_build_array(n.campaign_id, n.term, n.status)) from public.ad_negatives n), '[]'::jsonb)
  )
$$;
revoke all on function public.ads_desk_data(integer) from public, anon;
grant execute on function public.ads_desk_data(integer) to authenticated;
