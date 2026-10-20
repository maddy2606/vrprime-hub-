-- P&L page: what each master SKU costs (pack of 1), and the units sold per Flipkart SKU per month.
--
--   master_costs        the owner's cost for one unit of a master SKU. A Flipkart SKU that is a pack of 2 costs twice
--                       that (sku_master.units_per_order); a kit with no cost of its own costs the sum of its parts.
--                       The app does that maths.
--   pnl_month_units(d)  per order month and Flipkart SKU: units dispatched, units returned (customer returns and courier
--                       returns, counted in the month of their order) and units cancelled, from the synced orders.
--
-- Owner only, like the rest of money: the table has one owner-only policy and the function refuses anyone else.

create table if not exists public.master_costs (
  master_id uuid primary key references public.master_products (id) on delete cascade,
  cost numeric(12, 2) not null check (cost >= 0 and cost <= 1000000),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
alter table public.master_costs enable row level security;
revoke all on public.master_costs from anon, authenticated;
grant select, insert, update, delete on public.master_costs to authenticated;
grant all on public.master_costs to service_role;
drop policy if exists master_costs_owner_only on public.master_costs;
create policy master_costs_owner_only on public.master_costs for all to authenticated
  using ((select private.user_role()) = 'owner') with check ((select private.user_role()) = 'owner');

create or replace function public.pnl_month_units(p_from date)
returns table (month text, sku text, dispatched bigint, returned bigint, cancelled bigint, first_day date, last_day date)
language plpgsql stable security invoker set search_path = '' as $$
begin
  perform private.money_guard();
  return query
  with o as (
    select to_char(i.order_day, 'YYYY-MM') as m, i.sku as s,
           sum(case when i.stage = 'dispatched' then coalesce(i.quantity, 1) else 0 end) as d,
           sum(case when i.stage = 'cancelled' then coalesce(i.quantity, 1) else 0 end) as c,
           min(i.order_day) as f, max(i.order_day) as l
    from public.fk_order_items i
    where i.platform = 'flipkart' and i.order_day >= p_from and i.sku is not null
    group by 1, 2
  ), r as (
    select to_char(coalesce(oi.order_day, (x.order_date at time zone 'Asia/Kolkata')::date), 'YYYY-MM') as m, x.sku as s,
           sum(coalesce(x.quantity, 1)) as q
    from public.fk_returns x
    left join public.fk_order_items oi on oi.platform = x.platform and oi.order_item_id = x.order_item_id
    where x.platform = 'flipkart' and x.return_status <> 'cancelled' and x.sku is not null
      and coalesce(oi.order_day, (x.order_date at time zone 'Asia/Kolkata')::date) >= p_from
    group by 1, 2
  )
  select coalesce(o.m, r.m), coalesce(o.s, r.s), coalesce(o.d, 0)::bigint, coalesce(r.q, 0)::bigint, coalesce(o.c, 0)::bigint, o.f, o.l
  from o full join r on r.m = o.m and r.s = o.s;
end $$;
revoke all on function public.pnl_month_units(date) from public, anon;
grant execute on function public.pnl_month_units(date) to authenticated, service_role;
