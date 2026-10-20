-- P&L page: ad spend from Flipkart Ads, read from the PLA "Consolidated FSN Report" the owner uploads (one calendar month
-- per file). The report gives the spend per Flipkart SKU, so ads come off each product's profit as well as the month's.
--
--   pnl_ad_spend    per month and Flipkart SKU: spend, views, clicks, units and revenue Flipkart puts down to the ads
--   pnl_ad_uploads  per month: the file it came from and the dates it covers
--   pnl_save_ads()  replaces one month's ad spend in one go, so a report uploaded twice is never counted twice
--
-- Owner only, like the rest of money.

create table if not exists public.pnl_ad_spend (
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  sku text not null check (length(sku) between 1 and 200),
  spend numeric(14, 2) not null default 0,
  views bigint not null default 0,
  clicks bigint not null default 0,
  direct_units integer not null default 0,
  indirect_units integer not null default 0,
  revenue numeric(14, 2) not null default 0,
  primary key (month, sku)
);

create table if not exists public.pnl_ad_uploads (
  month text primary key check (month ~ '^\d{4}-\d{2}$'),
  period_from date not null,
  period_to date not null,
  filename text,
  skus integer not null default 0,
  spend numeric(14, 2) not null default 0,
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid references public.profiles (id) on delete set null
);

do $$
declare
  t text;
begin
  foreach t in array array['pnl_ad_spend', 'pnl_ad_uploads'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner_only', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select private.user_role()) = ''owner'') with check ((select private.user_role()) = ''owner'')',
      t || '_owner_only', t);
  end loop;
end $$;

-- p_rows: [{"sku": "...", "spend": 0, "views": 0, "clicks": 0, "direct_units": 0, "indirect_units": 0, "revenue": 0}, ...]
create or replace function public.pnl_save_ads(p_month text, p_from date, p_to date, p_filename text, p_rows jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_skus integer;
  v_spend numeric;
begin
  perform private.money_guard();
  if p_month !~ '^\d{4}-\d{2}$' or p_from is null or p_to is null or to_char(p_from, 'YYYY-MM') <> p_month or to_char(p_to, 'YYYY-MM') <> p_month then
    raise exception 'the report must cover one calendar month' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 20000 then
    raise exception 'the rows were not understood' using errcode = '22023';
  end if;
  delete from public.pnl_ad_spend where month = p_month;
  insert into public.pnl_ad_spend (month, sku, spend, views, clicks, direct_units, indirect_units, revenue)
  select p_month, r.sku, coalesce(r.spend, 0), coalesce(r.views, 0), coalesce(r.clicks, 0), coalesce(r.direct_units, 0), coalesce(r.indirect_units, 0), coalesce(r.revenue, 0)
  from jsonb_to_recordset(p_rows) as r(sku text, spend numeric, views bigint, clicks bigint, direct_units integer, indirect_units integer, revenue numeric)
  where r.sku is not null and length(r.sku) between 1 and 200;
  select count(*), coalesce(sum(spend), 0) into v_skus, v_spend from public.pnl_ad_spend where month = p_month;
  insert into public.pnl_ad_uploads (month, period_from, period_to, filename, skus, spend, uploaded_at, uploaded_by)
  values (p_month, p_from, p_to, left(p_filename, 200), v_skus, v_spend, now(), (select auth.uid()))
  on conflict (month) do update set period_from = excluded.period_from, period_to = excluded.period_to, filename = excluded.filename,
    skus = excluded.skus, spend = excluded.spend, uploaded_at = excluded.uploaded_at, uploaded_by = excluded.uploaded_by;
  return jsonb_build_object('skus', v_skus, 'spend', v_spend);
end $$;
revoke all on function public.pnl_save_ads(text, date, date, text, jsonb) from public, anon;
grant execute on function public.pnl_save_ads(text, date, date, text, jsonb) to authenticated, service_role;
