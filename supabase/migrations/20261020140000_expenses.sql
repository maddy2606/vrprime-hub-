-- Expenses, read from the "Warehouse Expenses VRPRIME" WhatsApp group. Owner only.
--
--   whatsapp_link       the linked WhatsApp session (keys and credentials): server only, never readable from the browser
--   whatsapp_state      which group is followed, who is linked, the last fetch and its result
--   expense_messages    every message read from the group, as it came (text, screenshot, sender, time)
--   expenses            one row per payment: built from a screenshot and its note (or a note with an amount); the owner
--                       can correct it, and a later fetch never overwrites a correction
--   storage "expenses"  the screenshots (a small and a full-size copy), private

create table public.whatsapp_link (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.whatsapp_link enable row level security;
revoke all on public.whatsapp_link from anon, authenticated;
grant all on public.whatsapp_link to service_role;

create table public.whatsapp_state (
  id boolean primary key default true check (id),
  linked_as text,
  group_id text,
  group_name text,
  -- Groups this WhatsApp is in, when the expenses group could not be found by name (the owner picks one).
  groups jsonb not null default '[]'::jsonb,
  busy_until timestamptz,
  last_fetch_at timestamptz,
  last_result text,
  last_error text,
  updated_at timestamptz not null default now()
);
insert into public.whatsapp_state (id) values (true) on conflict (id) do nothing;
alter table public.whatsapp_state enable row level security;
revoke all on public.whatsapp_state from anon, authenticated;
grant select on public.whatsapp_state to authenticated;
grant all on public.whatsapp_state to service_role;
create policy whatsapp_state_select on public.whatsapp_state for select to authenticated
  using ((select private.user_role()) = 'owner');

create table public.expense_messages (
  id text primary key,
  group_id text not null,
  sent_at timestamptz not null,
  sender text,
  kind text not null check (kind in ('text', 'image', 'document')),
  body text,
  -- The WhatsApp media details needed to download the screenshot later; cleared once it is saved.
  media jsonb,
  image_path text,
  deleted boolean not null default false,
  created_at timestamptz not null default now()
);
create index expense_messages_sent_idx on public.expense_messages (group_id, sent_at);
alter table public.expense_messages enable row level security;
revoke all on public.expense_messages from anon, authenticated;
grant select on public.expense_messages to authenticated;
grant all on public.expense_messages to service_role;
create policy expense_messages_select on public.expense_messages for select to authenticated
  using ((select private.user_role()) = 'owner');

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  -- The message it hangs on (the screenshot, or the note when there is no screenshot); null for one added by hand.
  key text unique,
  image_message_id text,
  text_message_id text,
  spent_at timestamptz not null,
  sender text,
  reason text check (reason is null or char_length(reason) <= 2000),
  category text not null default 'Other' check (char_length(category) between 1 and 60),
  -- What each source says, and the amount used: typed by the owner, else read from the screenshot, else from the note.
  text_amount numeric(12, 2),
  read_amount numeric(12, 2),
  amount numeric(12, 2) check (amount is null or amount >= 0),
  amount_from text check (amount_from in ('typed', 'screenshot', 'note')),
  paid_to text check (paid_to is null or char_length(paid_to) <= 200),
  reference text check (reference is null or char_length(reference) <= 100),
  image_path text,
  thumb_path text,
  read_text text,
  read_done boolean not null default false,
  status text not null default 'new' check (status in ('new', 'checked', 'ignored')),
  -- The owner changed it by hand: fetching again never overwrites it.
  edited boolean not null default false,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index expenses_spent_idx on public.expenses (spent_at desc);
alter table public.expenses enable row level security;
revoke all on public.expenses from anon, authenticated;
grant select, insert, update, delete on public.expenses to authenticated;
grant all on public.expenses to service_role;
create policy expenses_all on public.expenses for all to authenticated
  using ((select private.user_role()) = 'owner')
  with check ((select private.user_role()) = 'owner');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('expenses', 'expenses', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create policy expenses_files_read on storage.objects for select to authenticated
  using (bucket_id = 'expenses' and (select private.user_role()) = 'owner');
create policy expenses_files_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'expenses' and (select private.user_role()) = 'owner');
create policy expenses_files_remove on storage.objects for delete to authenticated
  using (bucket_id = 'expenses' and (select private.user_role()) = 'owner');
