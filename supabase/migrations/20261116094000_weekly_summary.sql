-- Weekly summary (graphite-spec 12.5): on Monday at 9:00 India time, every active owner gets last week (Monday to
-- Sunday) against the week before, from the Business page's figures. Written by the build, applied by hand after review.
-- Needs 20261116090000_business.sql first (private.business_week_data).

-- Whole rupees with Indian grouping: ₹1,68,420.
create or replace function private.inr(p numeric) returns text
language plpgsql immutable set search_path = '' as $$
declare
  s text := round(abs(coalesce(p, 0)))::bigint::text;
  head text;
begin
  if length(s) > 3 then
    head := left(s, length(s) - 3);
    head := regexp_replace(head, '(\d)(?=(\d\d)+$)', '\1,', 'g');
    s := head || ',' || right(s, 3);
  end if;
  return case when p < 0 then '−' else '' end || '₹' || s;
end $$;
revoke all on function private.inr(numeric) from public, anon, authenticated;

-- "+12%" / "−5%" / "0%"; null when the week before had nothing.
create or replace function private.signed_pct(p_cur numeric, p_prev numeric) returns text
language sql immutable set search_path = '' as $$
  select case
    when coalesce(p_prev, 0) = 0 then null
    else case when round((p_cur - p_prev) / p_prev * 100) > 0 then '+'
              when round((p_cur - p_prev) / p_prev * 100) < 0 then '−' else '' end
         || abs(round((p_cur - p_prev) / p_prev * 100))::text || '%'
  end
$$;
revoke all on function private.signed_pct(numeric, numeric) from public, anon, authenticated;

create or replace function private.weekly_summary() returns void
language plpgsql security definer set search_path = '' as $$
declare
  -- The Monday of last week: the week that ended yesterday when this runs on a Monday.
  v_start date := date_trunc('week', (now() at time zone 'Asia/Kolkata'))::date - 7;
  cur jsonb;
  prev jsonb;
  v_orders numeric;
  v_prev_orders numeric;
  v_pct numeric;
  v_title text;
  v_body text;
  v_sales_pct text;
  u uuid;
begin
  cur := private.business_week_data(v_start, 7);
  prev := private.business_week_data(v_start - 7, 7);
  v_orders := (cur ->> 'orders')::numeric;
  v_prev_orders := (prev ->> 'orders')::numeric;
  if v_prev_orders > 0 then
    v_pct := round((v_orders - v_prev_orders) / v_prev_orders * 100);
    v_title := 'Last week: ' || v_orders || ' orders, ' || case when v_pct < 0 then 'down ' else 'up ' end || abs(v_pct) || '%';
  else
    v_title := 'Last week: ' || v_orders || ' orders';
  end if;
  v_sales_pct := private.signed_pct((cur ->> 'sales')::numeric, (prev ->> 'sales')::numeric);
  v_body := 'Sales ' || private.inr((cur ->> 'sales')::numeric)
    || coalesce(' (' || v_sales_pct || ')', '')
    || ' · Returns ' || ((cur ->> 'returns_customer')::numeric + (cur ->> 'returns_courier')::numeric)
    || ' · Cancelled ' || (cur ->> 'cancelled')
    || ' · Flagged late ' || (cur ->> 'late');
  for u in select p.id from public.profiles p where p.active and p.role = 'owner' loop
    perform private.notify_user(u, 'weekly_summary', v_title, v_body, null, null);
  end loop;
end $$;
revoke all on function private.weekly_summary() from public, anon, authenticated;

select cron.unschedule(jobname) from cron.job where jobname = 'weekly-summary';
select cron.schedule('weekly-summary', '30 3 * * 1', 'select private.weekly_summary()');
