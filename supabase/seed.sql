-- LOCAL DEVELOPMENT ONLY. Fake people, fake SKUs.
-- Runs automatically on `supabase db reset` against the local stack.
-- NEVER run this against the production project.
--
-- All four fake users sign in with the password:  local-dev-only
--   owner@example.test, manager@example.test (an admin), listing@example.test (an admin), warehouse@example.test

do $$
declare
  u_owner uuid := '00000000-0000-4000-8000-000000000001';
  u_manager uuid := '00000000-0000-4000-8000-000000000002';
  u_listing uuid := '00000000-0000-4000-8000-000000000003';
  u_warehouse uuid := '00000000-0000-4000-8000-000000000004';
  w_blr uuid;
  w_del uuid;
  p uuid;
  today date := (now() at time zone 'Asia/Kolkata')::date;
  u record;
begin
  if exists (select 1 from auth.users where email not like '%@example.test') then
    raise exception 'Refusing to seed: this database has real users.';
  end if;

  for u in
    select * from (values
      (u_owner, 'owner@example.test'),
      (u_manager, 'manager@example.test'),
      (u_listing, 'listing@example.test'),
      (u_warehouse, 'warehouse@example.test')) as t(id, email)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new)
    values (
      '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
      extensions.crypt('local-dev-only', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), u.id, u.id::text,
            jsonb_build_object('sub', u.id::text, 'email', u.email), 'email', now(), now(), now());
  end loop;

  insert into public.profiles (id, name, role, must_change_password) values
    (u_owner, 'Test Owner', 'owner', false),
    (u_manager, 'Sample Admin', 'admin', false),
    (u_listing, 'Demo Admin', 'admin', false),
    (u_warehouse, 'Fake Warehouse BLR', 'warehouse', false)
  on conflict (id) do update set name = excluded.name, role = excluded.role,
                                 must_change_password = excluded.must_change_password;

  select id into strict w_blr from public.warehouses where name = 'Bangalore';
  select id into strict w_del from public.warehouses where name = 'Delhi';
  insert into public.user_warehouses values (u_warehouse, w_blr);

  insert into public.posts (type, title, details, priority, status, sku, warehouse_id, platform, assignee_id, created_by, due_date)
  values ('problem', 'Wrong item returned for FAKE-SKU-RED-XL', 'Box had a different product inside. Photos to follow.',
          'urgent', 'in_progress', 'FAKE-SKU-RED-XL', w_blr, 'flipkart', u_manager, u_warehouse, today - 2)
  returning id into p;
  insert into public.post_comments (post_id, author_id, body) values
    (p, u_warehouse, 'Opened the box on camera.'),
    (p, u_manager, 'Raising a claim today.');

  insert into public.posts (type, title, sku, warehouse_id, qty_needed, priority, assignee_id, created_by, due_date) values
    ('restock', 'Restock FAKE-SKU-BLU-M × 500 to Bangalore', 'FAKE-SKU-BLU-M', w_blr, 500, 'high', u_warehouse, u_manager, today),
    ('restock', 'Restock FAKE-SKU-GRN-S × 200 to Delhi', 'FAKE-SKU-GRN-S', w_del, 200, 'normal', null, u_manager, today + 3);

  insert into public.posts (type, title, sku, platform, assignee_id, created_by, due_date) values
    ('new_listing', 'List the example steel bottle 750 ml', 'FAKE-BOTTLE-750', 'flipkart', u_listing, u_owner, today + 1);

  insert into public.posts (type, title, assignee_id, created_by, due_date) values
    ('task', 'Count shelf C in the sample warehouse', u_warehouse, u_manager, today + 5),
    ('task', 'Call the pretend courier about pickup timing', u_manager, u_owner, null);

  insert into public.posts (type, title, sku, warehouse_id, qty_needed, status, assignee_id, created_by,
                            done_qty, done_reference, done_note)
  values ('restock', 'Restock FAKE-SKU-YEL-L × 300 to Delhi', 'FAKE-SKU-YEL-L', w_del, 300, 'done', u_manager, u_manager,
          280, 'FAKE-INV-0091', '20 units short');
end $$;
