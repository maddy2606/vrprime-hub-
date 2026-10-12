-- The pending sweep only reads orders due within the next 2 days (and any overdue ones back 90 days).
-- Flipkart lists orders scheduled weeks ahead too (thousands of them, each page taking about 5 seconds, and
-- Flipkart stops a search at 5,000 results); those cannot miss a deadline yet and are read when their date
-- comes closer. Orders that are no longer listed are marked left_pending as before.
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
begin
  if p_kind = 'pending' then
    -- One part per state and warehouse: Flipkart stops any single search at 5,000 results, and a busy day
    -- can have more orders than that waiting at all five warehouses together.
    foreach v_state in array array['APPROVED', 'PACKING_IN_PROGRESS', 'PACKED', 'READY_TO_DISPATCH', 'FORM_FAILED'] loop
      for v_loc in select flipkart_location_id from public.warehouses where flipkart_location_id is not null order by sort_order loop
        v_plan := v_plan || jsonb_build_array(jsonb_build_object(
          't', 'pre', 'state', v_state, 'loc', v_loc,
          'from', private.iso_utc(v_now - interval '90 days'), 'to', private.iso_utc(v_now + interval '2 days')));
      end loop;
    end loop;
    return v_plan;
  elsif p_kind = 'daily' then
    -- Shipped orders for each of the last 4 days apart (Flipkart stops a search at 5,000 results), then
    -- cancellations and returns.
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
