-- Listing check (graphite-spec 12.3): each morning the owner's PC reads every active Review tracker link's product page
-- (scripts/listing-check.mts) and saves whether it can be bought and at what price. Flipkart is only read, never
-- written. Written by the build, applied by hand after review.

create table if not exists public.listing_checks (
  id uuid primary key default gen_random_uuid(),
  checked_on date not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.listing_check_rows (
  check_id uuid not null references public.listing_checks (id) on delete cascade,
  row_no integer not null,
  status text not null check (status in ('buyable', 'out_of_stock', 'unavailable', 'not_read')),
  price numeric,
  expected_price numeric,
  primary key (check_id, row_no)
);

alter table public.listing_checks enable row level security;
alter table public.listing_check_rows enable row level security;
drop policy if exists listing_checks_select on public.listing_checks;
create policy listing_checks_select on public.listing_checks for select to authenticated using ((select private.is_staff()));
drop policy if exists listing_check_rows_select on public.listing_check_rows;
create policy listing_check_rows_select on public.listing_check_rows for select to authenticated using ((select private.is_staff()));
revoke all on public.listing_checks, public.listing_check_rows from public, anon, authenticated;
grant select on public.listing_checks, public.listing_check_rows to authenticated;
grant all on public.listing_checks, public.listing_check_rows to service_role;

-- Saves one day's reading. p_rows: [{row_no, status, price}]. Callable by the PC (service_role) and by staff.
create or replace function public.listing_check_save(p_day date, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_check uuid;
  v_prev uuid;
  v_n integer;
  v_names text;
  v_saved integer;
  u uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not private.is_staff() then
    raise exception 'Only the owner and admins can save a listing check' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'p_rows must be an array';
  end if;

  insert into public.listing_checks (checked_on) values (p_day)
  on conflict (checked_on) do update set checked_on = excluded.checked_on
  returning id into v_check;

  -- Each row: our price is the latest selling price of the link's SKU (Flipkart links only; Shopsy has none).
  with incoming as (
    select (x ->> 'row_no')::integer as row_no,
           x ->> 'status' as status,
           nullif(x ->> 'price', '')::numeric as price
    from jsonb_array_elements(p_rows) x
    where (x ->> 'row_no') is not null
      and x ->> 'status' in ('buyable', 'out_of_stock', 'unavailable', 'not_read')
  ), priced as (
    select i.*,
           case when l.platform = 'Flipkart' then (
             select sp.selling_price from public.stock_prices sp
             where sp.platform = 'flipkart' and sp.sku = l.sku and sp.selling_price is not null
             order by sp.snapshot_date desc limit 1)
           end as expected
    from incoming i
    join public.review_links l on l.row_no = i.row_no
  )
  insert into public.listing_check_rows as r (check_id, row_no, status, price, expected_price)
  select v_check, row_no, status, price, expected from priced
  on conflict (check_id, row_no) do update
    set status = excluded.status, price = excluded.price, expected_price = excluded.expected_price
    -- A 'not_read' never replaces a row already saved today with another status.
    where excluded.status <> 'not_read' or r.status = 'not_read';
  get diagnostics v_saved = row_count;

  -- Against the previous check: links that were buyable (or had no row) and are now out of stock or unavailable, and
  -- links whose price newly differs from ours by ₹1 or more.
  select c.id into v_prev from public.listing_checks c where c.checked_on < p_day order by c.checked_on desc limit 1;
  with now_rows as (
    select r.row_no, r.status, r.price, r.expected_price from public.listing_check_rows r where r.check_id = v_check
  ), before as (
    select r.row_no, r.status, r.price, r.expected_price from public.listing_check_rows r where r.check_id = v_prev
  ), hit as (
    select n.row_no
    from now_rows n
    left join before b on b.row_no = n.row_no
    where (n.status in ('out_of_stock', 'unavailable') and (b.row_no is null or b.status = 'buyable'))
       or (n.price is not null and n.expected_price is not null and abs(n.price - n.expected_price) >= 1
           and not (b.price is not null and b.expected_price is not null and abs(b.price - b.expected_price) >= 1))
  )
  select count(*), string_agg(l.product, ' · ' order by l.priority nulls last, l.row_no) filter (where rn <= 5)
  into v_n, v_names
  from (select h.row_no, row_number() over (order by l2.priority nulls last, l2.row_no) as rn
        from hit h join public.review_links l2 on l2.row_no = h.row_no) t
  join public.review_links l on l.row_no = t.row_no;

  if v_n > 0 then
    for u in select private.alert_people() loop
      if not exists (select 1 from public.notifications x where x.user_id = u and x.kind = 'listing_alert'
                     and x.created_at > now() - interval '20 hours') then
        perform private.notify_user(u, 'listing_alert', v_n || ' listings need a look',
                                    left(v_names, 600), null, null);
      end if;
    end loop;
  end if;

  return jsonb_build_object('check_id', v_check, 'saved', v_saved, 'flagged', v_n);
end $$;
revoke all on function public.listing_check_save(date, jsonb) from public, anon;
grant execute on function public.listing_check_save(date, jsonb) to authenticated, service_role;
