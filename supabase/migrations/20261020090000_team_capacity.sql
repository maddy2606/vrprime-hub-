-- Team capacity: who works at each warehouse, who came in each day, and how many orders a day the warehouses are
-- getting, so the owner can plan extra people before the orders arrive.
--
--  * staff        the people (owner adds or imports them; owner and admin read them)
--  * staff_pay    monthly salary per person: OWNER ONLY, in its own table so no query for staff can ever return it
--  * attendance   one row per person per day: present, half, absent or leave (owner and admin mark it)
--  * team_order_load(p_days)   orders per day per warehouse: placed (real, by order day) and due (already booked to pack)
--
-- No names or salaries are in this file or anywhere in the repo: they are loaded from the owner's own spreadsheet.

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  warehouse_id uuid not null references public.warehouses (id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (warehouse_id, name)
);
create index staff_warehouse_idx on public.staff (warehouse_id) where active;

create table public.staff_pay (
  staff_id uuid primary key references public.staff (id) on delete cascade,
  monthly_salary integer not null check (monthly_salary >= 0),
  updated_at timestamptz not null default now()
);

create table public.attendance (
  staff_id uuid not null references public.staff (id) on delete cascade,
  day date not null,
  status text not null check (status in ('present', 'half', 'absent', 'leave')),
  marked_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  primary key (staff_id, day)
);
create index attendance_day_idx on public.attendance (day);

alter table public.staff enable row level security;
alter table public.staff_pay enable row level security;
alter table public.attendance enable row level security;

-- Staff and attendance: owner and admin read; the owner manages people; owner and admin mark attendance.
create policy staff_select on public.staff for select to authenticated using ((select private.is_staff()));
create policy staff_insert on public.staff for insert to authenticated with check ((select private.user_role()) = 'owner');
create policy staff_update on public.staff for update to authenticated
  using ((select private.user_role()) = 'owner') with check ((select private.user_role()) = 'owner');
create policy staff_delete on public.staff for delete to authenticated using ((select private.user_role()) = 'owner');

create policy staff_pay_all on public.staff_pay for all to authenticated
  using ((select private.user_role()) = 'owner') with check ((select private.user_role()) = 'owner');

create policy attendance_select on public.attendance for select to authenticated using ((select private.is_staff()));
create policy attendance_insert on public.attendance for insert to authenticated with check ((select private.is_staff()));
create policy attendance_update on public.attendance for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy attendance_delete on public.attendance for delete to authenticated using ((select private.is_staff()));

revoke all on public.staff, public.staff_pay, public.attendance from public, anon;
grant select, insert, update, delete on public.staff, public.staff_pay, public.attendance to authenticated;
grant all on public.staff, public.staff_pay, public.attendance to service_role;

-- The planning numbers (owner changes them on the Team page): what one person can pack in a day, comfortably and at the
-- most, and how many days ahead a new person has to be found.
insert into public.app_settings (key, value) values
  ('team_orders_per_person_low', '400'),
  ('team_orders_per_person_high', '500'),
  ('team_hire_lead_days', '7')
on conflict (key) do nothing;

-- Orders per day per warehouse, from the order rows (security invoker: the caller's own access rules apply).
--   placed = distinct orders by the day they were placed (IST), cancelled ones left out: the demand
--   due    = distinct pending orders by the day they must be dispatched, today up to 21 days ahead: what is already booked
create or replace function public.team_order_load(p_days integer default 35) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with b as (
    select (now() at time zone 'Asia/Kolkata')::date as today, least(greatest(coalesce(p_days, 35), 7), 90) as d
  )
  select coalesce(jsonb_agg(r), '[]'::jsonb)
  from (
    select 'placed'::text as kind, i.order_day as day, i.warehouse_id, count(distinct i.order_id)::integer as orders
    from public.fk_order_items i, b
    where i.platform = 'flipkart' and i.stage <> 'cancelled' and i.order_day between b.today - b.d and b.today
    group by i.order_day, i.warehouse_id
    union all
    select 'due', (i.dispatch_by at time zone 'Asia/Kolkata')::date, i.warehouse_id, count(distinct i.order_id)::integer
    from public.fk_order_items i, b
    where i.platform = 'flipkart' and i.stage = 'pending' and not i.hold and i.dispatch_by is not null
      and (i.dispatch_by at time zone 'Asia/Kolkata')::date between b.today and b.today + 21
    group by 2, 3
  ) r
$$;
revoke all on function public.team_order_load(integer) from public, anon;
grant execute on function public.team_order_load(integer) to authenticated, service_role;
