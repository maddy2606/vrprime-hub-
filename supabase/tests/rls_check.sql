-- RLS check: proves a warehouse user cannot read or change another warehouse's posts.
--
-- Safe to run anywhere, including production: everything happens inside one
-- transaction that is rolled back at the end, so no test data is left behind.
-- Any failed check raises an error and stops the script.
--
-- Run it from the Supabase SQL editor, or:  psql "$DATABASE_URL" -f supabase/tests/rls_check.sql

begin;

do $$
declare
  u_mgr uuid := gen_random_uuid();
  u_blr uuid := gen_random_uuid();   -- warehouse user, Bangalore only
  u_del uuid := gen_random_uuid();   -- warehouse user, Delhi only
  u_off uuid := gen_random_uuid();   -- deactivated manager
  w_blr uuid;
  w_del uuid;
  p_blr uuid;
  p_del uuid;
  p_task uuid;                       -- no warehouse, assigned to the Delhi user
  n int;
  blocked boolean;
begin
  select id into strict w_blr from public.warehouses where name = 'Bangalore';
  select id into strict w_del from public.warehouses where name = 'Delhi';

  insert into auth.users (id, instance_id, aud, role, email) values
    (u_mgr, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-mgr@example.test'),
    (u_blr, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-blr@example.test'),
    (u_del, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-del@example.test'),
    (u_off, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-off@example.test');

  insert into public.profiles (id, name, role, active) values
    (u_mgr, 'RLS Manager', 'manager', true),
    (u_blr, 'RLS Bangalore', 'warehouse', true),
    (u_del, 'RLS Delhi', 'warehouse', true),
    (u_off, 'RLS Deactivated', 'manager', false)
  on conflict (id) do update
    set name = excluded.name, role = excluded.role, active = excluded.active;

  insert into public.user_warehouses (user_id, warehouse_id) values (u_blr, w_blr), (u_del, w_del);

  insert into public.posts (type, title, details, warehouse_id, created_by)
    values ('problem', 'RLS Bangalore problem', 'test', w_blr, u_mgr) returning id into p_blr;
  insert into public.posts (type, title, details, warehouse_id, created_by)
    values ('problem', 'RLS Delhi problem', 'test', w_del, u_mgr) returning id into p_del;
  insert into public.posts (type, title, assignee_id, created_by)
    values ('task', 'RLS task for Delhi user', u_del, u_mgr) returning id into p_task;
  insert into public.post_comments (post_id, author_id, body) values (p_del, u_mgr, 'Delhi only');
  insert into public.tickets (ticket_id, post_id, created_by) values ('RLS-TICKET-1', p_del, u_mgr);

  -- ---- Bangalore warehouse user ------------------------------------------
  perform set_config('request.jwt.claims',
                     json_build_object('sub', u_blr, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.posts where id = p_blr;
  assert n = 1, 'Bangalore user should see the Bangalore post';

  select count(*) into n from public.posts where id in (p_del, p_task);
  assert n = 0, 'Bangalore user must NOT see Delhi posts';

  select count(*) into n from public.search_posts('RLS') where id in (p_del, p_task);
  assert n = 0, 'search must NOT return Delhi posts to the Bangalore user';

  select count(*) into n from public.post_comments where post_id = p_del;
  assert n = 0, 'Bangalore user must NOT see comments on a Delhi post';

  select count(*) into n from public.post_events where post_id = p_del;
  assert n = 0, 'Bangalore user must NOT see history of a Delhi post';

  select count(*) into n from public.tickets where post_id = p_del;
  assert n = 0, 'Bangalore user must NOT see a ticket linked to a Delhi post';

  update public.posts set title = 'changed' where id = p_del;
  get diagnostics n = row_count;
  assert n = 0, 'Bangalore user must NOT be able to edit a Delhi post';

  blocked := false;
  begin
    insert into public.post_comments (post_id, author_id, body) values (p_del, u_blr, 'sneaky');
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'Bangalore user must NOT be able to comment on a Delhi post';

  blocked := false;
  begin
    update public.profiles set role = 'owner' where id = u_blr;
    get diagnostics n = row_count;
    blocked := (n = 0);
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'a user must NOT be able to change their own role';

  reset role;

  -- ---- Delhi warehouse user ----------------------------------------------
  perform set_config('request.jwt.claims',
                     json_build_object('sub', u_del, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.posts where id in (p_del, p_task);
  assert n = 2, 'Delhi user should see the Delhi post and the task assigned to them';

  select count(*) into n from public.posts where id = p_blr;
  assert n = 0, 'Delhi user must NOT see the Bangalore post';

  reset role;

  -- ---- Manager sees everything -------------------------------------------
  perform set_config('request.jwt.claims',
                     json_build_object('sub', u_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.posts where id in (p_blr, p_del, p_task);
  assert n = 3, 'manager should see all posts';

  reset role;

  -- ---- Deactivated user sees nothing -------------------------------------
  perform set_config('request.jwt.claims',
                     json_build_object('sub', u_off, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.posts;
  assert n = 0, 'deactivated user must see no posts';

  select count(*) into n from public.warehouses;
  assert n = 0, 'deactivated user must see no warehouses';

  reset role;

  -- ---- Not signed in ------------------------------------------------------
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  blocked := false;
  begin
    select count(*) into n from public.posts;
    blocked := (n = 0);
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'signed-out visitors must see no posts';
  reset role;

  -- ---- Audit trail --------------------------------------------------------
  update public.posts set status = 'in_progress' where id = p_blr;
  select count(*) into n from public.post_events
    where post_id = p_blr and kind = 'status' and changes ->> 'to' = 'in_progress';
  assert n = 1, 'status change should be recorded in post_events';

  blocked := false;
  begin
    update public.posts set status = 'done' where id = p_blr;
  exception when check_violation then blocked := true;
  end;
  assert blocked, 'a problem must NOT be marked done without a ticket ID or a reason';
end $$;

select 'All RLS checks passed' as result;

rollback;
