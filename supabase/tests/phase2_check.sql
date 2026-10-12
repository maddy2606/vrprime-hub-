-- Phase 2 check: notifications, ticket visibility and the new functions.
--
-- Like rls_check.sql, it runs in one transaction that is rolled back, so it is safe
-- on production and leaves no data behind. Any failed check raises an error.
--
--   psql "$DATABASE_URL" -f supabase/tests/phase2_check.sql

begin;

do $$
declare
  u_mgr uuid := gen_random_uuid();   -- manager
  u_blr uuid := gen_random_uuid();   -- warehouse user, Bangalore
  u_del uuid := gen_random_uuid();   -- warehouse user, Delhi
  u_off uuid := gen_random_uuid();   -- deactivated warehouse user, Bangalore
  w_blr uuid;
  w_del uuid;
  p_task uuid;
  p_blr uuid;
  p_del uuid;
  t_blr uuid;
  t_del uuid;
  n int;
  amount numeric;
  blocked boolean;
  claims text;
begin
  select id into strict w_blr from public.warehouses where name = 'Bangalore';
  select id into strict w_del from public.warehouses where name = 'Delhi';

  insert into auth.users (id, instance_id, aud, role, email) values
    (u_mgr, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p2-mgr@example.test'),
    (u_blr, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p2-blr@example.test'),
    (u_del, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p2-del@example.test'),
    (u_off, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p2-off@example.test');
  insert into public.profiles (id, name, role, active) values
    (u_mgr, 'P2 Manager', 'manager', true),
    (u_blr, 'P2 Bangalore', 'warehouse', true),
    (u_del, 'P2 Delhi', 'warehouse', true),
    (u_off, 'P2 Deactivated', 'warehouse', false)
  on conflict (id) do update set name = excluded.name, role = excluded.role, active = excluded.active;
  insert into public.user_warehouses values (u_blr, w_blr), (u_off, w_blr), (u_del, w_del);

  -- ---- Manager assigns a task to the Bangalore user --------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.posts (type, title, assignee_id, created_by)
    values ('task', 'P2 task', u_blr, u_mgr) returning id into p_task;
  insert into public.posts (type, title, details, warehouse_id, created_by)
    values ('problem', 'P2 Bangalore problem', 'x', w_blr, u_mgr) returning id into p_blr;
  insert into public.posts (type, title, details, warehouse_id, created_by)
    values ('problem', 'P2 Delhi problem', 'x', w_del, u_mgr) returning id into p_del;
  insert into public.posts (type, title, assignee_id, created_by)
    values ('task', 'P2 task for a deactivated user', u_off, u_mgr);
  reset role;

  select count(*) into n from public.notifications where user_id = u_blr and kind = 'assigned' and post_id = p_task;
  assert n = 1, 'assignee should be told about a new assignment';
  select count(*) into n from public.notifications where user_id = u_mgr;
  assert n = 0, 'the person who assigned the task must not notify themselves';
  select count(*) into n from public.notifications where user_id = u_off;
  assert n = 0, 'deactivated users get no notifications';

  -- Re-assigning to someone else tells the new assignee only
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.posts set assignee_id = u_del where id = p_task;
  reset role;
  select count(*) into n from public.notifications where user_id = u_del and kind = 'assigned' and post_id = p_task;
  assert n = 1, 'new assignee should be told after a reassignment';

  -- Changing something else must not notify again
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.posts set priority = 'high' where id = p_task;
  reset role;
  select count(*) into n from public.notifications where post_id = p_task and kind = 'assigned';
  assert n = 2, 'editing other fields must not create new notifications';

  -- ---- Comments: the other person is told, not the author --------------------
  perform set_config('request.jwt.claims', json_build_object('sub', u_del, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.post_comments (post_id, author_id, body) values (p_task, u_del, 'on it');
  reset role;
  select count(*) into n from public.notifications where user_id = u_mgr and kind = 'comment' and post_id = p_task;
  assert n = 1, 'post creator should be told about a comment';
  select count(*) into n from public.notifications where user_id = u_del and kind = 'comment';
  assert n = 0, 'the commenter must not be told about their own comment';

  -- ---- Done: the creator is told ------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', u_del, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.posts set status = 'done' where id = p_task;
  reset role;
  select count(*) into n from public.notifications where user_id = u_mgr and kind = 'done' and post_id = p_task;
  assert n = 1, 'post creator should be told when it is marked done';
  select count(*) into n from public.notifications where user_id = u_del and kind = 'done';
  assert n = 0, 'the person who marked it done must not be told';

  -- ---- Notifications are private and read-only except read_at ----------------
  perform set_config('request.jwt.claims', json_build_object('sub', u_blr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.notifications;
  assert n = 1, 'a user sees only their own notifications';

  update public.notifications set read_at = now() where user_id = u_blr;
  get diagnostics n = row_count;
  assert n = 1, 'a user can mark their own notification read';

  update public.notifications set read_at = null where user_id = u_mgr;
  get diagnostics n = row_count;
  assert n = 0, 'a user must not touch anyone else''s notifications';

  blocked := false;
  begin
    update public.notifications set title = 'changed' where user_id = u_blr;
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'a user must not rewrite the text of a notification';

  blocked := false;
  begin
    insert into public.notifications (user_id, kind, title) values (u_blr, 'comment', 'forged');
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'a user must not create notifications directly';

  -- ---- Internal functions are not callable by signed-in users ----------------
  blocked := false;
  begin
    perform public.check_internal_secret('anything');
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'check_internal_secret must be for the service role only';

  blocked := false;
  begin
    select count(*) into n from private.internal_config;
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'internal_config must not be readable by signed-in users';

  -- ---- Test notification and device registration -----------------------------
  perform public.send_test_notification();
  select count(*) into n from public.notifications where user_id = u_blr and kind = 'test';
  assert n = 1, 'send_test_notification should notify the caller';

  perform public.register_push_subscription(
    'https://push.example.test/endpoint-aaaaaaaaaaaaaaaa', repeat('p', 40), repeat('a', 16));
  select count(*) into n from public.push_subscriptions;
  assert n = 1, 'user should see their own device';

  blocked := false;
  begin
    perform public.register_push_subscription('http://insecure.example.test/xxxxxxxxxxxxxxxxxxxx', repeat('p', 40), repeat('a', 16));
  exception when sqlstate '22023' then blocked := true;
  end;
  assert blocked, 'a non-https push endpoint must be refused';
  reset role;

  -- The same phone, signed in by someone else, moves to them
  perform set_config('request.jwt.claims', json_build_object('sub', u_del, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.register_push_subscription(
    'https://push.example.test/endpoint-aaaaaaaaaaaaaaaa', repeat('q', 40), repeat('b', 16));
  select count(*) into n from public.push_subscriptions;
  assert n = 1, 'the shared device should now belong to the new user';
  reset role;
  select count(*) into n from public.push_subscriptions where user_id = u_blr;
  assert n = 0, 'the previous user must no longer receive pushes on that device';

  -- ---- Tickets ------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.tickets (ticket_id, post_id, sku, amount_involved, amount_recovered, status, next_follow_up, created_by)
    values ('P2-TKT-BLR', p_blr, 'P2-SKU-1', 1000, 0, 'open', (now() at time zone 'Asia/Kolkata')::date, u_mgr)
    returning id into t_blr;
  insert into public.tickets (ticket_id, post_id, sku, amount_involved, amount_recovered, status, created_by)
    values ('P2-TKT-DEL', p_del, 'P2-SKU-2', 500, 200, 'resolved', u_mgr)
    returning id into t_del;
  insert into public.tickets (ticket_id, amount_involved, status, created_by)
    values ('P2-TKT-NOPOST', 250, 'waiting_marketplace', u_mgr);
  reset role;

  select count(*) into n from public.post_events where post_id = p_blr and kind = 'ticket';
  assert n = 1, 'raising a ticket from a post should appear in the post history';

  -- Manager sees all three (plus any real ones), totals add up
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.search_tickets('P2-TKT');
  assert n = 3, 'manager should find all three test tickets';
  select count(*) into n from public.search_tickets('p2-sku-1');
  assert n = 1, 'ticket search should match SKU, ignoring case';
  select count(*) into n from public.search_tickets('VR-T-' || (select number from public.tickets where id = t_blr));
  assert n = 1, 'ticket search should match the VR-T number';
  select open_amount into amount from public.ticket_totals();
  assert amount >= 1250, 'open total should include both open tickets';
  reset role;

  -- Bangalore user sees only the ticket linked to their warehouse's post
  perform set_config('request.jwt.claims', json_build_object('sub', u_blr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.search_tickets('P2-TKT');
  assert n = 1, 'warehouse user must see only tickets linked to posts they can see';
  select count(*) into n from public.tickets where id in (t_del);
  assert n = 0, 'Bangalore user must NOT see the Delhi ticket';
  select open_amount into amount from public.ticket_totals();
  assert amount = 1000, 'totals must only count tickets the user can see';

  blocked := false;
  begin
    insert into public.tickets (ticket_id, post_id, created_by) values ('P2-SNEAKY', p_del, u_blr);
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'a warehouse user must not raise a ticket on another warehouse''s post';

  blocked := false;
  begin
    insert into public.tickets (ticket_id, created_by) values ('P2-NOPOST', u_blr);
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'a warehouse user must not create a ticket with no visible post';
  reset role;
end $$;

select 'All Phase 2 checks passed' as result;

rollback;
