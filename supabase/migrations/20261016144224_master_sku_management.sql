-- Master SKU management: a short code per product, units per order per link, and SKUs taken out of the checks.
--
--   master_products.code       optional short code ("180-LINT"), unique when set
--   sku_master.units_per_order how many of the product one order of this listing uses (a 2pc listing = 2)
--   sku_excluded               Flipkart SKUs taken out of the checks and lists ("Removed"); put back from the page
--
-- Everyone signed in may read; changes go through the master_* functions (owner and admin).

alter table public.master_products
  add column code text unique check (code is null or length(btrim(code)) between 1 and 60);

alter table public.sku_master
  add column units_per_order integer not null default 1 check (units_per_order between 1 and 1000);

create table public.sku_excluded (
  channel_sku text primary key check (length(btrim(channel_sku)) >= 1 and length(channel_sku) <= 200),
  excluded_at timestamptz not null default now(),
  excluded_by uuid references public.profiles (id) on delete set null
);
create index sku_excluded_by_idx on public.sku_excluded (excluded_by);

alter table public.sku_excluded enable row level security;
revoke all on public.sku_excluded from anon, authenticated;
grant select on public.sku_excluded to authenticated;
grant all on public.sku_excluded to service_role;
create policy sku_excluded_select on public.sku_excluded for select to authenticated
  using ((select private.user_role()) is not null);
