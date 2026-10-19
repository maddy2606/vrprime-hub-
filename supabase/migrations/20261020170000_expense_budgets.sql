-- Monthly budgets per warehouse, and which warehouse each expense was for. Owner only.
--
--   expenses.warehouse_id   the warehouse an expense was for (picked from its note, or set by the owner); null = general
--   expense_budgets         one line per month and warehouse (warehouse_id null = general / not tied to a warehouse):
--                           labour (salaries and labour) and running costs (everything else)

alter table public.expenses add column if not exists warehouse_id uuid references public.warehouses (id) on delete set null;
create index if not exists expenses_warehouse_idx on public.expenses (warehouse_id);

create table if not exists public.expense_budgets (
  id uuid primary key default gen_random_uuid(),
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  warehouse_id uuid references public.warehouses (id) on delete cascade,
  labour numeric(12, 2) not null default 0 check (labour >= 0),
  running numeric(12, 2) not null default 0 check (running >= 0),
  note text check (note is null or char_length(note) <= 500),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);
create unique index if not exists expense_budgets_month_wh on public.expense_budgets (month, warehouse_id) where warehouse_id is not null;
create unique index if not exists expense_budgets_month_general on public.expense_budgets (month) where warehouse_id is null;

alter table public.expense_budgets enable row level security;
revoke all on public.expense_budgets from anon, authenticated;
grant select, insert, update, delete on public.expense_budgets to authenticated;
grant all on public.expense_budgets to service_role;
create policy expense_budgets_all on public.expense_budgets for all to authenticated
  using ((select private.user_role()) = 'owner')
  with check ((select private.user_role()) = 'owner');
