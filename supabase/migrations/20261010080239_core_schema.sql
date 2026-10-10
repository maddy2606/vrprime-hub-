-- VRPRIME OPS: core schema (Phase 1, with Phase 2 tables created up front
-- so tickets and notifications need no schema change later).

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- People and places
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  role text not null check (role in ('owner', 'manager', 'listing', 'warehouse')),
  phone text,
  active boolean not null default true,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  flipkart_location_id text unique,
  sort_order smallint not null default 0
);

create table public.user_warehouses (
  user_id uuid not null references public.profiles (id) on delete cascade,
  warehouse_id uuid not null references public.warehouses (id) on delete cascade,
  primary key (user_id, warehouse_id)
);
create index user_warehouses_warehouse_idx on public.user_warehouses (warehouse_id);

insert into public.warehouses (name, flipkart_location_id, sort_order) values
  ('Bangalore', 'LOCab6c2264c36446bcb13efc9faa7d69be', 1),
  ('Bhiwandi',  'LOC01e92b132b7648b29a9cf993cbacd75b', 2),
  ('Delhi',     'LOCcd9beb97101a449ca710a4eb6d438637', 3),
  ('Kolkata',   'LOCef2e7b4c64d14313a0b9077bd8edb7fd', 4),
  ('Lucknow',   'LOCeb2de6780462413e84342b99e9d5cb78', 5);

-- ---------------------------------------------------------------------------
-- Posts
-- ---------------------------------------------------------------------------

create sequence public.post_number_seq start 1001;

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  number bigint not null unique default nextval('public.post_number_seq'),
  type text not null check (type in ('task', 'new_listing', 'problem', 'restock')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  details text,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  priority_rank smallint generated always as (
    case priority when 'urgent' then 4 when 'high' then 3 when 'normal' then 2 else 1 end
  ) stored,
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'waiting', 'done', 'cancelled')),
  sku text,
  warehouse_id uuid references public.warehouses (id),
  platform text check (platform in ('flipkart', 'amazon', 'other')),
  -- Free text for now; lets two Amazon seller accounts be told apart later.
  marketplace_account text,
  qty_needed integer check (qty_needed > 0),
  assignee_id uuid references public.profiles (id),
  created_by uuid not null references public.profiles (id),
  due_date date,
  done_at timestamptz,
  done_by uuid references public.profiles (id),
  -- Proof of completion, by type
  done_ticket_id text,
  done_no_ticket_reason text,
  done_listing_id text,
  done_qty integer check (done_qty >= 0),
  done_reference text,
  done_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint posts_task_needs_assignee
    check (type <> 'task' or assignee_id is not null),
  constraint posts_problem_needs_details_and_place
    check (type <> 'problem'
           or (nullif(btrim(details), '') is not null
               and (warehouse_id is not null or platform is not null))),
  constraint posts_restock_needs_sku_warehouse_qty
    check (type <> 'restock'
           or (nullif(btrim(sku), '') is not null
               and warehouse_id is not null and qty_needed is not null)),
  constraint posts_done_needs_proof
    check (status <> 'done' or case type
      when 'problem' then nullif(btrim(done_ticket_id), '') is not null
                          or nullif(btrim(done_no_ticket_reason), '') is not null
      when 'new_listing' then nullif(btrim(done_listing_id), '') is not null
      when 'restock' then done_qty is not null
                          and nullif(btrim(done_reference), '') is not null
      else true end)
);

create index posts_assignee_idx on public.posts (assignee_id);
create index posts_created_by_idx on public.posts (created_by);
create index posts_warehouse_idx on public.posts (warehouse_id);
create index posts_status_idx on public.posts (status);
create index posts_due_idx on public.posts (due_date);
create index posts_updated_idx on public.posts (updated_at desc);

create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  author_id uuid not null references public.profiles (id),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index post_comments_post_idx on public.post_comments (post_id, created_at);

create table public.post_attachments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  path text not null unique,
  uploaded_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);
create index post_attachments_post_idx on public.post_attachments (post_id);

-- Audit trail. Written only by triggers, never by the app.
create table public.post_events (
  id bigint generated always as identity primary key,
  post_id uuid not null references public.posts (id) on delete cascade,
  actor_id uuid references public.profiles (id),
  kind text not null check (kind in ('created', 'status', 'assignee', 'edit')),
  changes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index post_events_post_idx on public.post_events (post_id, created_at);

-- ---------------------------------------------------------------------------
-- Tickets (used from Phase 2)
-- ---------------------------------------------------------------------------

create sequence public.ticket_number_seq start 101;

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  number bigint not null unique default nextval('public.ticket_number_seq'),
  ticket_id text not null check (char_length(btrim(ticket_id)) between 1 and 120),
  platform text not null default 'flipkart' check (platform in ('flipkart', 'amazon', 'other')),
  marketplace_account text,
  issue_type text not null default 'other'
    check (issue_type in ('wrong_return', 'payment_missing', 'listing_blocked', 'claim', 'other')),
  post_id uuid references public.posts (id) on delete set null,
  sku text,
  amount_involved numeric(12, 2) check (amount_involved >= 0),
  raised_on date not null default ((now() at time zone 'Asia/Kolkata')::date),
  next_follow_up date,
  status text not null default 'open'
    check (status in ('open', 'waiting_marketplace', 'resolved', 'rejected')),
  resolution_notes text,
  amount_recovered numeric(12, 2) check (amount_recovered >= 0),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tickets_post_idx on public.tickets (post_id);
create index tickets_ticket_id_idx on public.tickets (ticket_id);
create index tickets_follow_up_idx on public.tickets (next_follow_up);
create index tickets_created_by_idx on public.tickets (created_by);

-- ---------------------------------------------------------------------------
-- Notifications (used from Phase 2) and settings (used from Phase 3)
-- ---------------------------------------------------------------------------

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  post_id uuid references public.posts (id) on delete cascade,
  ticket_id uuid references public.tickets (id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_post_idx on public.notifications (post_id);
create index notifications_ticket_idx on public.notifications (ticket_id);

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);

insert into public.app_settings (key, value) values
  ('low_stock_threshold', '100'),
  ('weight_alert_limit', '2000'),
  ('new_inactive_days', '2');

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- The first auth user ever created becomes the owner. After that this does
-- nothing: every other user is created from the Admin page.
create function private.bootstrap_first_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles) then
    insert into public.profiles (id, name, role, must_change_password)
    values (new.id, coalesce(nullif(split_part(new.email, '@', 1), ''), 'Owner'), 'owner', false);
  end if;
  return new;
end $$;

create trigger bootstrap_first_owner after insert on auth.users
  for each row execute function private.bootstrap_first_owner();

create function private.posts_before_write() returns trigger
language plpgsql set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(actor, new.created_by);
    if new.status = 'done' then
      new.done_at := now();
      new.done_by := coalesce(actor, new.created_by);
    end if;
    return new;
  end if;

  new.number := old.number;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_at := now();

  if new.status = 'done' and old.status <> 'done' then
    new.done_at := now();
    new.done_by := actor;
  elsif new.status <> 'done' and old.status = 'done' then
    new.done_at := null;
    new.done_by := null;
  else
    new.done_at := old.done_at;
    new.done_by := old.done_by;
  end if;
  return new;
end $$;

create trigger posts_before_write before insert or update on public.posts
  for each row execute function private.posts_before_write();

create function private.log_post_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  o jsonb;
  n jsonb;
  f text;
  changes jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.post_events (post_id, actor_id, kind, changes)
    values (new.id, coalesce(actor, new.created_by), 'created',
            jsonb_build_object('type', new.type, 'title', new.title));
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.post_events (post_id, actor_id, kind, changes)
    values (new.id, actor, 'status',
            jsonb_build_object('from', old.status, 'to', new.status)
            || case when new.status = 'done' then jsonb_strip_nulls(jsonb_build_object(
                 'ticket_id', new.done_ticket_id,
                 'no_ticket_reason', new.done_no_ticket_reason,
                 'listing_id', new.done_listing_id,
                 'qty', new.done_qty,
                 'reference', new.done_reference,
                 'note', new.done_note)) else '{}'::jsonb end);
  end if;

  if new.assignee_id is distinct from old.assignee_id then
    insert into public.post_events (post_id, actor_id, kind, changes)
    values (new.id, actor, 'assignee',
            jsonb_build_object('from', old.assignee_id, 'to', new.assignee_id));
  end if;

  o := to_jsonb(old);
  n := to_jsonb(new);
  foreach f in array array['type', 'title', 'details', 'priority', 'sku', 'warehouse_id',
                           'platform', 'marketplace_account', 'qty_needed', 'due_date'] loop
    if (o -> f) is distinct from (n -> f) then
      changes := changes || jsonb_build_object(f, jsonb_build_object('from', o -> f, 'to', n -> f));
    end if;
  end loop;
  if changes <> '{}'::jsonb then
    insert into public.post_events (post_id, actor_id, kind, changes)
    values (new.id, actor, 'edit', changes);
  end if;
  return new;
end $$;

create trigger log_post_event after insert or update on public.posts
  for each row execute function private.log_post_event();

-- A new comment counts as activity for "sort by last update".
create function private.touch_post_on_comment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.posts set updated_at = now() where id = new.post_id;
  return new;
end $$;

create trigger touch_post_on_comment after insert on public.post_comments
  for each row execute function private.touch_post_on_comment();

create function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger tickets_set_updated_at before update on public.tickets
  for each row execute function private.set_updated_at();
