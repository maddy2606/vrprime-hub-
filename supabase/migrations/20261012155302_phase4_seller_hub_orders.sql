-- Phase 4b feedback: orders as Seller Hub shows them. Part 1: the nightly upcoming sweep.
-- (Part 2, phase4_seller_hub_orders_finish, has the alerts, left_pending, In Transit and schedule.)

alter table public.order_runs drop constraint order_runs_kind_check;
alter table public.order_runs add constraint order_runs_kind_check check (kind in ('pending', 'daily', 'backfill', 'upcoming'));

create or replace function private.order_plan(p_kind text, p_before date default null) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_now timestamptz := now();
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_plan jsonb := '[]'::jsonb;
  d date;
  i integer;
  v_from timestamptz;
  v_to timestamptz;
  v_state text;
  v_loc text;
  v_edges integer[] := array[-90, 2, 5, 8, 11, 14, 21, 30, 365];
begin
  if p_kind = 'pending' then
    foreach v_state in array array['APPROVED', 'PACKING_IN_PROGRESS', 'PACKED', 'READY_TO_DISPATCH', 'FORM_FAILED'] loop
      for v_loc in select flipkart_location_id from public.warehouses where flipkart_location_id is not null order by sort_order loop
        v_plan := v_plan || jsonb_build_array(jsonb_build_object(
          't', 'pre', 'state', v_state, 'loc', v_loc,
          'from', private.iso_utc(v_now - interval '90 days'), 'to', private.iso_utc(v_now + interval '2 days')));
      end loop;
    end loop;
    return v_plan;
  elsif p_kind = 'upcoming' then
    for v_loc in select flipkart_location_id from public.warehouses where flipkart_location_id is not null order by sort_order loop
      for i in 1..array_length(v_edges, 1) - 1 loop
        v_plan := v_plan || jsonb_build_array(jsonb_build_object(
          't', 'pre', 'state', 'APPROVED', 'loc', v_loc,
          'from', private.iso_utc(v_now + make_interval(days => v_edges[i])),
          'to', private.iso_utc(v_now + make_interval(days => v_edges[i + 1]))));
      end loop;
    end loop;
    foreach v_state in array array['PACKING_IN_PROGRESS', 'PACKED', 'READY_TO_DISPATCH', 'FORM_FAILED'] loop
      for v_loc in select flipkart_location_id from public.warehouses where flipkart_location_id is not null order by sort_order loop
        v_plan := v_plan || jsonb_build_array(jsonb_build_object(
          't', 'pre', 'state', v_state, 'loc', v_loc,
          'from', private.iso_utc(v_now + make_interval(days => v_edges[1])),
          'to', private.iso_utc(v_now + make_interval(days => v_edges[array_length(v_edges, 1)]))));
      end loop;
    end loop;
    for i in 0..13 loop
      d := v_today - i;
      v_from := (d::timestamp at time zone 'Asia/Kolkata');
      v_to := least(((d + 1)::timestamp at time zone 'Asia/Kolkata'), v_now);
      v_plan := v_plan || jsonb_build_array(jsonb_build_object(
        't', 'post', 'only', 'SHIPPED', 'day', d, 'from', private.iso_utc(v_from), 'to', private.iso_utc(v_to)));
    end loop;
    return v_plan;
  elsif p_kind = 'daily' then
    for i in 0..3 loop
      d := v_today - i;
      v_from := (d::timestamp at time zone 'Asia/Kolkata');
      v_to := least(((d + 1)::timestamp at time zone 'Asia/Kolkata'), v_now);
      v_plan := v_plan || jsonb_build_array(jsonb_build_object('t', 'post', 'day', d, 'from', private.iso_utc(v_from), 'to', private.iso_utc(v_to)));
    end loop;
    return v_plan || jsonb_build_array(
      jsonb_build_object('t', 'cancel', 'type', 'sellerCancellation', 'from', private.iso_utc(v_now - interval '4 days'), 'to', private.iso_utc(v_now)),
      jsonb_build_object('t', 'cancel', 'type', 'buyerCancellation', 'from', private.iso_utc(v_now - interval '4 days'), 'to', private.iso_utc(v_now)),
      jsonb_build_object('t', 'returns', 'source', 'courier_return', 'since', 'modifiedAfter', 'at', private.iso_utc(v_now - interval '4 days')),
      jsonb_build_object('t', 'returns', 'source', 'customer_return', 'since', 'modifiedAfter', 'at', private.iso_utc(v_now - interval '4 days')));
  elsif p_kind = 'backfill' then
    for i in 0..29 loop
      d := v_today - i;
      continue when p_before is not null and d >= p_before;
      v_from := (d::timestamp at time zone 'Asia/Kolkata');
      v_to := least(((d + 1)::timestamp at time zone 'Asia/Kolkata'), v_now);
      v_plan := v_plan || jsonb_build_array(jsonb_build_object(
        't', 'post', 'day', d, 'from', private.iso_utc(v_from), 'to', private.iso_utc(v_to)));
    end loop;
    v_from := ((v_today - 29)::timestamp at time zone 'Asia/Kolkata');
    v_plan := v_plan || jsonb_build_array(
      jsonb_build_object('t', 'cancel', 'type', 'sellerCancellation', 'from', private.iso_utc(v_from), 'to', private.iso_utc(v_now)),
      jsonb_build_object('t', 'cancel', 'type', 'buyerCancellation', 'from', private.iso_utc(v_from), 'to', private.iso_utc(v_now)),
      jsonb_build_object('t', 'returns', 'source', 'courier_return', 'since', 'createdAfter', 'at', private.iso_utc(v_from)),
      jsonb_build_object('t', 'returns', 'source', 'customer_return', 'since', 'createdAfter', 'at', private.iso_utc(v_from)));
    return v_plan;
  end if;
  raise exception 'unknown kind %', p_kind;
end $$;

revoke all on function private.order_plan(text, date) from public, anon;
grant execute on function private.order_plan(text, date) to service_role;

create or replace function public.request_orders_sync(p_kind text) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or coalesce(private.user_role(), '') not in ('owner', 'manager') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_kind not in ('pending', 'daily', 'upcoming') then
    raise exception 'unknown kind' using errcode = '22023';
  end if;
  return private.start_order_run(p_kind, 'manual', (select auth.uid()));
end $$;
revoke all on function public.request_orders_sync(text) from public, anon;
grant execute on function public.request_orders_sync(text) to authenticated;
