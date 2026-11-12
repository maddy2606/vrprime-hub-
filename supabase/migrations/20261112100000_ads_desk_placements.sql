-- Ads Desk: the Placement Performance report too ('pl'): spend and sales per campaign for each place an ad showed (top
-- of search, rest of search, product pages, browse, home page). Kept like search terms and keywords: the placement is
-- the term.

alter table public.ad_term_scans drop constraint if exists ad_term_scans_kind_check;
alter table public.ad_term_scans add constraint ad_term_scans_kind_check check (kind in ('st', 'kw', 'pl'));

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
  if p_kind not in ('st', 'kw', 'pl') or p_from is null or p_to is null or p_to < p_from or p_to - p_from + 1 > 92 then
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

-- Everything the Ads Desk shows, now with placements: pl [campaign_id, name, placement, views, clicks, spend, units, revenue].
create or replace function public.ads_desk_data(p_days integer default 45)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with fsn as (select * from public.ad_scans order by period_end desc, created_at desc limit 1),
       st as (select * from public.ad_term_scans where kind = 'st' order by period_end desc, created_at desc limit 1),
       kw as (select * from public.ad_term_scans where kind = 'kw' order by period_end desc, created_at desc limit 1),
       pl as (select * from public.ad_term_scans where kind = 'pl' order by period_end desc, created_at desc limit 1)
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
    'pl', (select jsonb_build_object('from', p.period_start, 'to', p.period_end, 'at', p.created_at, 'rows',
              coalesce((select jsonb_agg(jsonb_build_array(r.campaign_id, r.campaign_name, r.term, r.views, r.clicks, r.spend, r.units, r.revenue))
                        from public.ad_term_rows r where r.scan_id = p.id), '[]'::jsonb)) from pl p),
    'neg', coalesce((select jsonb_agg(jsonb_build_array(n.campaign_id, n.term, n.status)) from public.ad_negatives n), '[]'::jsonb)
  )
$$;
