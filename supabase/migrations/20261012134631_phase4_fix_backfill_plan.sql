-- A restarted backfill must skip the days it already finished (the newer ones), not stop at once.
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
begin
  if p_kind = 'pending' then
    return jsonb_build_array(
      jsonb_build_object('t', 'pre', 'state', 'APPROVED'),
      jsonb_build_object('t', 'pre', 'state', 'PACKING_IN_PROGRESS'),
      jsonb_build_object('t', 'pre', 'state', 'PACKED'),
      jsonb_build_object('t', 'pre', 'state', 'READY_TO_DISPATCH'),
      jsonb_build_object('t', 'pre', 'state', 'FORM_FAILED'));
  elsif p_kind = 'daily' then
    return jsonb_build_array(
      jsonb_build_object('t', 'post', 'from', private.iso_utc(v_now - interval '4 days'), 'to', private.iso_utc(v_now)),
      jsonb_build_object('t', 'cancel', 'type', 'sellerCancellation', 'from', private.iso_utc(v_now - interval '4 days'), 'to', private.iso_utc(v_now)),
      jsonb_build_object('t', 'cancel', 'type', 'buyerCancellation', 'from', private.iso_utc(v_now - interval '4 days'), 'to', private.iso_utc(v_now)),
      jsonb_build_object('t', 'returns', 'source', 'courier_return', 'since', 'modifiedAfter', 'at', private.iso_utc(v_now - interval '4 days')),
      jsonb_build_object('t', 'returns', 'source', 'customer_return', 'since', 'modifiedAfter', 'at', private.iso_utc(v_now - interval '4 days')));
  elsif p_kind = 'backfill' then
    -- Shipped orders one day at a time, newest first, so the recent days are complete first.
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
