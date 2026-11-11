-- Advances and expenses per person on the Team page, date by date. OWNER ONLY, like salaries.
--
--   advance    money given to the person ahead of salary (they owe it back)
--   expense    money paid to or for the person for work (fuel, travel, tools); not owed back
--   recovered  advance taken back, usually cut from salary
--
-- Advance still due for a person = their advances - their recovered amounts.

create table public.staff_money (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff (id) on delete cascade,
  kind text not null check (kind in ('advance', 'expense', 'recovered')),
  day date not null,
  amount numeric(12, 2) not null check (amount > 0 and amount <= 10000000),
  note text check (note is null or char_length(note) <= 200),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index staff_money_staff_idx on public.staff_money (staff_id, day desc);

alter table public.staff_money enable row level security;
create policy staff_money_owner on public.staff_money for all to authenticated
  using ((select private.user_role()) = 'owner') with check ((select private.user_role()) = 'owner');

revoke all on public.staff_money from public, anon;
grant select, insert, update, delete on public.staff_money to authenticated;
grant all on public.staff_money to service_role;
