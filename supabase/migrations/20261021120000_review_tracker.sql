-- The Review tracker: written reviews (not star ratings) on VRPRIME's Flipkart and Shopsy listings, one check at a time.
-- Owner and admin only.
--
--   review_links    the listings being watched: the link number Aman uses (row_no), platform, product, SKU (FSN / Shopsy
--                   product ID) and the link. shares_with names the row whose reviews this listing shows too (Flipkart
--                   shows one set of reviews on several listings), so totals count them once.
--   review_checks   one per day the counts were taken
--   review_counts   the count of written reviews per link per check. null = the page could not be read that day.

create table if not exists public.review_links (
  row_no integer primary key check (row_no between 1 and 9999),
  platform text not null check (platform in ('Flipkart', 'Shopsy')),
  product text not null check (char_length(btrim(product)) between 1 and 300),
  sku text not null check (char_length(btrim(sku)) between 1 and 60),
  url text not null check (url ~ '^https://www\.(flipkart\.com|shopsy\.in)/'),
  shares_with integer references public.review_links (row_no) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.review_checks (
  id uuid primary key default gen_random_uuid(),
  checked_on date not null unique,
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists review_checks_day_idx on public.review_checks (checked_on desc);

create table if not exists public.review_counts (
  check_id uuid not null references public.review_checks (id) on delete cascade,
  row_no integer not null references public.review_links (row_no) on delete cascade,
  reviews integer check (reviews is null or reviews >= 0),
  primary key (check_id, row_no)
);

-- Access: owner and admin read and write; nobody else sees anything (the same rule as the Ads tracker).
do $$
declare t text;
begin
  foreach t in array array['review_links', 'review_checks', 'review_counts'] loop
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

-- Saves one day's counts in one step: replaces any check of the same day. p_counts is [{"row_no": 2, "reviews": 123}, …];
-- a null reviews means that link could not be read. Runs as the signed-in person, so the policies above apply too.
create or replace function public.review_tracker_save_check(p_day date, p_note text, p_counts jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if coalesce((select private.user_role()), '') not in ('owner', 'admin') then
    raise exception 'Only the owner or an admin can save review counts' using errcode = '42501';
  end if;
  if p_day is null or jsonb_typeof(p_counts) <> 'array' or jsonb_array_length(p_counts) > 2000 then
    raise exception 'The counts are not valid' using errcode = '22023';
  end if;

  delete from public.review_checks where checked_on = p_day;
  insert into public.review_checks (checked_on, note) values (p_day, left(p_note, 500)) returning id into v_id;
  insert into public.review_counts (check_id, row_no, reviews)
  select v_id, (c ->> 'row_no')::integer, (c ->> 'reviews')::integer
  from jsonb_array_elements(p_counts) c
  where (c ->> 'row_no')::integer in (select row_no from public.review_links);
  return v_id;
end;
$$;

revoke all on function public.review_tracker_save_check(date, text, jsonb) from public, anon;
grant execute on function public.review_tracker_save_check(date, text, jsonb) to authenticated;
