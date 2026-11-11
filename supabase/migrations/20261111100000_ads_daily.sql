-- Ads tracker: true spend day by day, from Seller Hub's PLA "Consolidated Daily Report" (every campaign, one line per
-- campaign per day). The FSN report gives the split per SKU, but a download of it can come out incomplete; this daily
-- record is what the headline numbers and the trend use, and what each FSN report is checked against.
--
--   ad_daily               one row per day and campaign. Syncing a daily report replaces exactly the days it covers,
--                          so overlapping or repeated uploads never add up twice.
--   ads_save_daily(...)    saves one daily report (owner and admin)
--   ads_daily_totals(...)  all campaigns added up per day, for a range of days

create table if not exists public.ad_daily (
  day date not null,
  campaign_id text not null check (char_length(campaign_id) between 1 and 40),
  campaign_name text not null check (char_length(campaign_name) <= 200),
  spend numeric(14, 2) not null default 0,
  views bigint not null default 0,
  clicks bigint not null default 0,
  units integer not null default 0,
  revenue numeric(14, 2) not null default 0,
  synced_at timestamptz not null default now(),
  primary key (day, campaign_id)
);

alter table public.ad_daily enable row level security;
revoke all on public.ad_daily from anon, authenticated;
grant select, insert, update, delete on public.ad_daily to authenticated;
grant all on public.ad_daily to service_role;
drop policy if exists ad_daily_staff on public.ad_daily;
create policy ad_daily_staff on public.ad_daily for all to authenticated
  using ((select private.user_role()) in ('owner', 'admin')) with check ((select private.user_role()) in ('owner', 'admin'));

create or replace function public.ads_save_daily(p_from date, p_to date, p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_n integer;
begin
  if coalesce((select private.user_role()), '') not in ('owner', 'admin') then
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
revoke all on function public.ads_save_daily(date, date, jsonb) from public, anon;
grant execute on function public.ads_save_daily(date, date, jsonb) to authenticated;

create or replace function public.ads_daily_totals(p_from date, p_to date)
returns table (day date, spend numeric, revenue numeric, units bigint, views bigint, clicks bigint, campaigns bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select d.day, sum(d.spend), sum(d.revenue), sum(d.units)::bigint, sum(d.views)::bigint, sum(d.clicks)::bigint,
         count(*) filter (where d.spend > 0)
  from public.ad_daily d
  where d.day between p_from and p_to
  group by d.day
  order by d.day
$$;
revoke all on function public.ads_daily_totals(date, date) from public, anon;
grant execute on function public.ads_daily_totals(date, date) to authenticated;
