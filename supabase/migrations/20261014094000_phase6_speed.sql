-- Phase 6 speed. A month of settlements is about 390,000 lines, and adding up 390,000 lines (with a cost lookup on
-- every one) took 16 seconds. So the lines are added up once, when a report is uploaded, into one row per
-- (day paid, SKU, day ordered); the Profit page, the estimate and Needs action read that small table.
-- The detail lines stay as they are for the drill-down, the weight check and the settlement checks.

create table public.money_sku_day (
  payment_date date not null,
  sku text not null,
  order_day date not null,
  units_sold integer not null default 0,
  units_returned integer not null default 0,
  gross_sales numeric(16, 3) not null default 0,
  refunds numeric(16, 3) not null default 0,
  commission numeric(16, 3) not null default 0,
  fixed_fee numeric(16, 3) not null default 0,
  collection_fee numeric(16, 3) not null default 0,
  shipping_fee numeric(16, 3) not null default 0,
  reverse_shipping_fee numeric(16, 3) not null default 0,
  other_fees numeric(16, 3) not null default 0,
  mp_fee numeric(16, 3) not null default 0,
  taxes numeric(16, 3) not null default 0,
  gst_on_fees numeric(16, 3) not null default 0,
  tcs numeric(16, 3) not null default 0,
  tds numeric(16, 3) not null default 0,
  net numeric(16, 3) not null default 0,
  itc numeric(16, 3) not null default 0,
  lines integer not null default 0,
  primary key (payment_date, sku, order_day)
);

create table public.money_flags_cache (
  id boolean primary key default true check (id),
  payload jsonb not null,
  computed_at timestamptz not null default now()
);

do $$
declare
  t text;
begin
  foreach t in array array['money_sku_day', 'money_flags_cache'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated, service_role', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select private.user_role()) = ''owner'') with check ((select private.user_role()) = ''owner'')',
      t || '_owner_only', t);
  end loop;
end $$;

-- Adds up the lines paid in a date range (all of them when no range is given).
create or replace function private.money_refresh_summary(p_from date default null, p_to date default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.money_sku_day
  where (p_from is null or payment_date >= p_from) and (p_to is null or payment_date <= p_to);

  insert into public.money_sku_day (payment_date, sku, order_day, units_sold, units_returned, gross_sales, refunds, commission, fixed_fee,
      collection_fee, shipping_fee, reverse_shipping_fee, other_fees, mp_fee, taxes, gst_on_fees, tcs, tds, net, itc, lines)
  select l.payment_date, coalesce(l.sku, '(no SKU)'), coalesce(l.order_date, l.payment_date),
         coalesce(sum(case when l.sale_amount > 0 and l.refund = 0 then coalesce(l.qty, 1) end), 0),
         coalesce(sum(case when l.refund < 0 then coalesce(l.qty, 1) end), 0),
         coalesce(sum(case when l.refund = 0 then l.sale_amount end), 0), sum(l.refund),
         sum(l.commission), sum(l.fixed_fee), sum(l.collection_fee), sum(l.shipping_fee), sum(l.reverse_shipping_fee),
         sum(l.pick_pack_fee + l.other_fees), sum(l.mp_fee), sum(l.taxes), sum(l.gst_on_fees), sum(l.tcs), sum(l.tds), sum(l.net),
         sum(l.itc_gst_tcs + l.itc_tds), count(*)
  from public.money_settled_lines l
  where l.payment_date is not null
    and (p_from is null or l.payment_date >= p_from) and (p_to is null or l.payment_date <= p_to)
  group by l.payment_date, coalesce(l.sku, '(no SKU)'), coalesce(l.order_date, l.payment_date);
end $$;

-- Profit per SKU for a period, from the summary.
create or replace function public.money_profit(p_from date, p_to date)
returns table (
  sku text, units_sold bigint, units_returned bigint, gross_sales numeric, refunds numeric,
  commission numeric, fixed_fee numeric, collection_fee numeric, shipping_fee numeric, reverse_shipping_fee numeric,
  other_fees numeric, gst_on_fees numeric, tcs numeric, tds numeric, net_payout numeric, itc numeric,
  cost numeric, cost_missing boolean, orders bigint)
language plpgsql stable security invoker set search_path = '' as $$
begin
  perform private.money_guard();
  return query
  select d.sku::text, sum(d.units_sold)::bigint, sum(d.units_returned)::bigint, sum(d.gross_sales), sum(d.refunds),
         sum(d.commission), sum(d.fixed_fee), sum(d.collection_fee), sum(d.shipping_fee), sum(d.reverse_shipping_fee),
         sum(d.other_fees), sum(d.gst_on_fees), sum(d.tcs), sum(d.tds), sum(d.net), sum(d.itc),
         coalesce(sum((d.units_sold - d.units_returned) * c.unit_cost), 0),
         coalesce(bool_or(c.unit_cost is null and (d.units_sold > 0 or d.units_returned > 0)), false),
         sum(d.lines)::bigint
  from public.money_sku_day d
  left join lateral (
    select k.purchase_cost + k.packaging_cost + k.freight as unit_cost
    from public.sku_costs k
    where k.sku = d.sku and k.effective_from <= d.order_day
    order by k.effective_from desc limit 1
  ) c on true
  where d.payment_date between p_from and p_to
  group by d.sku;
end $$;

create or replace function private.money_latest_day() returns date
language sql stable security definer set search_path = '' as $$
  select max(payment_date) from public.money_sku_day
$$;

-- Estimated profit for unsettled orders: the fee % comes from the summary of the last 90 days.
create or replace function public.money_estimate(p_from date, p_to date)
returns table (sku text, units bigint, price numeric, fee_pct numeric, fee_source text, revenue numeric,
               est_payout numeric, cost numeric, est_profit numeric, cost_missing boolean)
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_latest date := private.money_latest_day();
  v_default numeric := private.money_setting('money_default_fee_percent', 12);
begin
  perform private.money_guard();
  return query
  with open_items as (
    select i.sku, i.quantity, i.order_day
    from public.fk_order_items i
    where i.platform = 'flipkart' and i.stage in ('pending', 'dispatched') and i.sku is not null
      and i.order_day between p_from and p_to
      and not exists (select 1 from public.money_settled_lines l where l.order_item_id = i.order_item_id)
      and not exists (select 1 from public.fk_returns r where r.platform = 'flipkart' and r.order_item_id = i.order_item_id)
  ), per_sku as (
    select o.sku, sum(o.quantity)::bigint as units,
           sum(o.quantity * coalesce(private.money_unit_cost(o.sku, o.order_day), 0)) as cost,
           bool_or(private.money_unit_cost(o.sku, o.order_day) is null) as cost_missing
    from open_items o group by o.sku
  ), recent as (
    select d.sku, sum(d.gross_sales) as sold, sum(d.units_sold) as sold_units, sum(d.mp_fee + d.taxes) as fees
    from public.money_sku_day d
    where d.payment_date > v_latest - 90
    group by d.sku
  )
  select s.sku, s.units,
         coalesce(sl.selling_price, r.sold / nullif(r.sold_units, 0)) as price,
         coalesce(round(-r.fees / nullif(r.sold, 0) * 100, 2), v_default) as fee_pct,
         case when r.sold > 0 then 'recent settlements' else 'default setting' end,
         s.units * coalesce(sl.selling_price, r.sold / nullif(r.sold_units, 0), 0),
         s.units * coalesce(sl.selling_price, r.sold / nullif(r.sold_units, 0), 0)
           * (1 - coalesce(-r.fees / nullif(r.sold, 0) * 100, v_default) / 100),
         s.cost,
         s.units * coalesce(sl.selling_price, r.sold / nullif(r.sold_units, 0), 0)
           * (1 - coalesce(-r.fees / nullif(r.sold, 0) * 100, v_default) / 100) - s.cost,
         s.cost_missing
  from per_sku s
  left join recent r on r.sku = s.sku
  left join public.stock_listings sl on sl.platform = 'flipkart' and sl.sku = s.sku
  order by s.sku;
end $$;

-- Needs action reads this saved answer; it is worked out again after an upload, a cost change and every night.
create or replace function private.money_compute_flags() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_latest date := private.money_latest_day();
  v_low numeric := private.money_setting('money_low_margin_percent', 10);
  v_neg jsonb;
  v_low_rows jsonb;
  v_unpaid bigint;
  v_last_upload timestamptz;
  v_missing_cost bigint;
begin
  select max(created_at) into v_last_upload from public.money_uploads where status = 'done';
  if v_latest is null then
    return jsonb_build_object('latest', null, 'negative', '[]'::jsonb, 'low', '[]'::jsonb, 'unpaid', 0, 'cost_missing', 0,
                              'last_upload', v_last_upload, 'low_margin_percent', v_low);
  end if;

  create temp table if not exists _flags_profit (sku text, profit numeric, revenue numeric, cost_missing boolean) on commit drop;
  truncate _flags_profit;
  insert into _flags_profit
  select x.sku, (x.net_payout + x.itc - x.cost), (x.gross_sales + x.refunds), x.cost_missing
  from public.money_profit(v_latest - 29, v_latest) x
  where x.sku <> '(no SKU)';

  select
    coalesce(jsonb_agg(jsonb_build_object('sku', sku, 'margin', round(profit / revenue * 100, 1), 'profit', round(profit, 0))
                       order by profit / revenue) filter (where profit < 0), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('sku', sku, 'margin', round(profit / revenue * 100, 1), 'profit', round(profit, 0))
                       order by profit / revenue) filter (where profit >= 0 and profit / revenue * 100 < v_low), '[]'::jsonb)
  into v_neg, v_low_rows
  from _flags_profit where not cost_missing and revenue > 0;
  select count(*) into v_missing_cost from _flags_profit where cost_missing;
  select count(*) into v_unpaid from public.money_unpaid();

  return jsonb_build_object('latest', v_latest, 'negative', v_neg, 'low', v_low_rows, 'unpaid', v_unpaid,
                            'cost_missing', v_missing_cost, 'last_upload', v_last_upload, 'low_margin_percent', v_low);
end $$;

create or replace function public.money_refresh_flags() returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v jsonb;
begin
  perform private.money_guard();
  v := private.money_compute_flags();
  insert into public.money_flags_cache (id, payload, computed_at) values (true, v, now())
  on conflict (id) do update set payload = excluded.payload, computed_at = now();
  return v;
end $$;

create or replace function public.money_flags() returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v jsonb;
begin
  perform private.money_guard();
  select payload into v from public.money_flags_cache where id;
  return coalesce(v, '{"latest": null, "negative": [], "low": [], "unpaid": 0, "cost_missing": 0, "last_upload": null, "low_margin_percent": 10}'::jsonb);
end $$;

-- Closing an upload also adds up what it brought and saves the Needs action answer.
create or replace function public.money_finish_upload(p_upload uuid, p_summary jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  u public.money_uploads;
  v_from date;
  v_to date;
  v_total numeric;
  v_filled integer := 0;
  v_keep integer := greatest(private.money_setting('money_keep_months', 12), 1)::integer;
  v_cut date := current_date - make_interval(months => greatest(private.money_setting('money_keep_months', 12), 1)::integer);
begin
  perform private.money_guard();
  select * into u from public.money_uploads where id = p_upload;
  if not found then
    raise exception 'unknown upload';
  end if;

  if u.kind = 'settled' then
    -- A line with no SKU gets it from the order data (never trimmed: " RATH2" is a real SKU).
    update public.money_settled_lines l
    set sku = o.sku
    from public.fk_order_items o
    where l.upload_id = p_upload and l.sku is null and o.platform = 'flipkart' and o.order_item_id = l.order_item_id and o.sku is not null;
    get diagnostics v_filled = row_count;
    update public.money_settled_lines l
    set sku = p.sku
    from public.money_pnl_orders p
    where l.upload_id = p_upload and l.sku is null and p.order_item_id = l.order_item_id and p.sku is not null;

    select min(payment_date), max(payment_date), sum(net) into v_from, v_to, v_total
    from public.money_settled_lines where upload_id = p_upload;
  else
    select min(order_date), max(order_date), sum(amount_settled) into v_from, v_to, v_total
    from public.money_pnl_orders where upload_id = p_upload;
    update public.money_settled_lines l
    set sku = p.sku
    from public.money_pnl_orders p
    where l.sku is null and p.order_item_id = l.order_item_id and p.sku is not null;
    get diagnostics v_filled = row_count;
  end if;

  update public.money_uploads
  set status = 'done', finished_at = now(), period_from = v_from, period_to = v_to, total_net = v_total,
      summary = coalesce(p_summary, '{}'::jsonb)
  where id = p_upload;

  -- Keep the months the setting says, by the day the money moved or the order was placed.
  delete from public.money_settled_lines where payment_date < v_cut;
  delete from public.money_other_lines where payment_date < v_cut;
  delete from public.money_pnl_orders where order_date < v_cut;

  if u.kind = 'settled' then
    perform private.money_refresh_summary(v_from, v_to);
  elsif v_filled > 0 then
    perform private.money_refresh_summary();
  end if;
  perform public.money_refresh_flags();

  return jsonb_build_object('from', v_from, 'to', v_to, 'total', v_total, 'skus_filled', v_filled);
end $$;

-- Our maths against Flipkart's, in one pass over the lines.
create or replace function public.money_crosscheck(p_tolerance numeric default 5, p_limit integer default 200)
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_compared bigint;
  v_differ bigint;
  v_rows jsonb;
begin
  perform private.money_guard();
  with theirs as (
    select o.order_item_id, o.sku, p.id as payment_id, p.neft_id, (t.value ->> 1)::numeric as flipkart_amount
    from public.money_pnl_orders o
    cross join lateral jsonb_array_elements(o.txns) t
    join public.money_payments p on p.neft_id = t.value ->> 0
  ), ours as (
    select l.payment_id, l.order_item_id, sum(l.net) as amount
    from public.money_settled_lines l
    where l.payment_id in (select payment_id from theirs)
    group by l.payment_id, l.order_item_id
  ), covered as (
    select distinct payment_id from public.money_settled_lines where payment_id in (select payment_id from theirs)
  ), cc as (
    select t.order_item_id, t.sku, t.neft_id, t.flipkart_amount, coalesce(o.amount, 0) as our_amount
    from theirs t
    join covered c on c.payment_id = t.payment_id
    left join ours o on o.payment_id = t.payment_id and o.order_item_id = t.order_item_id
  )
  select count(*), count(*) filter (where abs(flipkart_amount - our_amount) > p_tolerance),
         coalesce((select jsonb_agg(to_jsonb(d)) from (
           select c.order_item_id, c.sku, c.neft_id, c.flipkart_amount, c.our_amount, round(c.our_amount - c.flipkart_amount, 2) as diff
           from cc c where abs(c.flipkart_amount - c.our_amount) > p_tolerance
           order by abs(c.flipkart_amount - c.our_amount) desc limit greatest(least(p_limit, 1000), 1)) d), '[]'::jsonb)
  into v_compared, v_differ, v_rows
  from cc;
  return jsonb_build_object('compared', v_compared, 'differ', v_differ, 'tolerance', p_tolerance, 'rows', v_rows);
end $$;

-- Wrong fees: the per-SKU "usual" is worked out once from the sold lines, then each line is compared.
create or replace function public.money_wrong_fees(p_points numeric default null)
returns table (order_item_id text, order_id text, sku text, payment_date date, problem text, sale numeric,
               fee_points numeric, usual_points numeric, extra_fee numeric)
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_points numeric := coalesce(p_points, private.money_setting('money_fee_deviation_points', 2));
begin
  perform private.money_guard();
  return query
  with sold as materialized (
    select l.order_item_id, l.order_id, l.sku, l.payment_date, l.sale_amount, l.commission, l.commission_rate, l.fixed_fee,
           greatest(coalesce(l.qty, 1), 1) as units, -l.fixed_fee / greatest(coalesce(l.qty, 1), 1) as fixed_unit
    from public.money_settled_lines l
    where l.sale_amount > 0 and l.refund = 0 and l.sku is not null
  ), usual as materialized (
    select s.sku,
           percentile_cont(0.5) within group (order by s.commission_rate) filter (where s.commission_rate is not null)::numeric as rate,
           percentile_cont(0.95) within group (order by s.fixed_unit)::numeric as fixed_p95
    from sold s group by s.sku having count(*) >= 20
  ), rate_off as (
    select s.order_item_id, s.order_id, s.sku, s.payment_date, 'Commission % is far from usual'::text as problem, s.sale_amount as sale,
           s.commission_rate as fee_points, round(u.rate, 2) as usual_points,
           round(greatest(-s.commission - u.rate / 100 * s.sale_amount, 0), 2) as extra_fee
    from sold s join usual u on u.sku = s.sku
    where s.commission_rate is not null and u.rate is not null and abs(s.commission_rate - u.rate) > v_points
  ), fixed_off as (
    select s.order_item_id, s.order_id, s.sku, s.payment_date, 'Fixed fee above usual'::text, s.sale_amount,
           round(-s.fixed_fee / s.sale_amount * 100, 2), round(u.fixed_p95 / (s.sale_amount / s.units) * 100, 2),
           round((s.fixed_unit - u.fixed_p95) * s.units, 2)
    from sold s join usual u on u.sku = s.sku
    where (s.fixed_unit - u.fixed_p95) * s.units / s.sale_amount * 100 > v_points
  ), twice as (
    select l.order_item_id, min(l.order_id), min(l.sku), max(l.payment_date), 'Fee charged twice'::text, sum(l.sale_amount),
           null::numeric, null::numeric,
           round(-(sum(l.commission + l.fixed_fee + l.collection_fee) - min(l.commission + l.fixed_fee + l.collection_fee)), 2)
    from public.money_settled_lines l
    where l.refund = 0 and l.sale_amount > 0 and (l.commission + l.fixed_fee + l.collection_fee) <> 0
    group by l.order_item_id
    having count(*) > 1
  )
  select * from rate_off union all select * from fixed_off union all select * from twice
  order by 9 desc nulls last;
end $$;

-- Every night: the Needs action answer is worked out again (an order that has become overdue, for instance).
create or replace function private.money_nightly() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v jsonb;
begin
  -- Runs from the scheduler, with no signed-in user: the money functions are told it is the service.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v := private.money_compute_flags();
  insert into public.money_flags_cache (id, payload, computed_at) values (true, v, now())
  on conflict (id) do update set payload = excluded.payload, computed_at = now();
end $$;
select cron.schedule('money-nightly', '15 4 * * *', $$select private.money_nightly()$$);

-- Fill the summary from the lines already imported, and the saved answer.
select private.money_refresh_summary();
select private.money_nightly();

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to service_role;
grant execute on function private.user_role(), private.is_staff(), private.can_see_post(uuid, uuid, uuid), private.can_see_post_id(uuid) to authenticated;
grant execute on function private.money_allowed(), private.money_guard(), private.money_setting(text, numeric), private.money_unit_cost(text, date),
  private.money_latest_day(), private.money_slab_upper(numeric), private.try_num(text) to authenticated;
revoke all on function public.money_refresh_flags() from public, anon;
grant execute on function public.money_refresh_flags() to authenticated, service_role;
do $$
declare
  f text;
begin
  foreach f in array array['money_profit(date, date)', 'money_estimate(date, date)', 'money_flags()', 'money_finish_upload(uuid, jsonb)',
                           'money_crosscheck(numeric, integer)', 'money_wrong_fees(numeric)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
