-- Phase 6: the heavy checks run in the background.
--
-- A signed-in user's database request is cut off after 8 seconds, and the free database needs longer than that to
-- check 400,000 lines for wrong fees or to compare 100,000 orders with Flipkart's own report. So an upload only says
-- "numbers need working out" (money_state); a job that runs every minute does the work as the database itself,
-- and the pages read the saved answers. Needs action, the Profit tab and the Costs tab are instant.

create table public.money_state (
  id boolean primary key default true check (id),
  summary_dirty boolean not null default false,
  summary_from date,
  summary_to date,
  summary_full boolean not null default false,
  checks_dirty boolean not null default false,
  flags_dirty boolean not null default false,
  working boolean not null default false,
  refreshed_at timestamptz,
  crosscheck jsonb
);
insert into public.money_state (id) values (true);

create table public.money_wrong_fee_rows (
  order_item_id text not null,
  order_id text,
  sku text,
  payment_date date,
  problem text not null,
  sale numeric,
  fee_points numeric,
  usual_points numeric,
  extra_fee numeric
);
create index money_wrong_fee_rows_extra_idx on public.money_wrong_fee_rows (extra_fee desc nulls last);

do $$
declare
  t text;
begin
  foreach t in array array['money_state', 'money_wrong_fee_rows'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select private.user_role()) = ''owner'')', t || '_owner_read', t);
  end loop;
end $$;

create index money_settled_payment_idx on public.money_settled_lines (payment_id, order_item_id);

-- ---------------------------------------------------------------------------
-- The calculations, without the owner check: only the job (and the owner's functions below) call them.
-- ---------------------------------------------------------------------------

create or replace function private.money_crosscheck_compute(p_tolerance numeric default 5, p_limit integer default 200)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_compared bigint;
  v_differ bigint;
  v_rows jsonb;
begin
  with theirs as (
    select o.order_item_id, o.sku, p.id as payment_id, p.neft_id, (t.value ->> 1)::numeric as flipkart_amount
    from public.money_pnl_orders o
    cross join lateral jsonb_array_elements(o.txns) t
    join public.money_payments p on p.neft_id = t.value ->> 0
    where exists (select 1 from public.money_settled_lines x where x.payment_id = p.id limit 1)
  ), ours as (
    select l.payment_id, l.order_item_id, sum(l.net) as amount
    from public.money_settled_lines l
    where l.payment_id in (select distinct payment_id from theirs)
    group by l.payment_id, l.order_item_id
  ), cc as materialized (
    select t.order_item_id, t.sku, t.neft_id, t.flipkart_amount, coalesce(o.amount, 0) as our_amount
    from theirs t
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

create or replace function private.money_wrong_fees_compute(p_points numeric default null)
returns table (order_item_id text, order_id text, sku text, payment_date date, problem text, sale numeric,
               fee_points numeric, usual_points numeric, extra_fee numeric)
language plpgsql security definer set search_path = '' as $$
declare
  v_points numeric := coalesce(p_points, private.money_setting('money_fee_deviation_points', 2));
begin
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
  select * from rate_off union all select * from fixed_off union all select * from twice;
end $$;

-- What the pages read.
create or replace function public.money_crosscheck(p_tolerance numeric default 5, p_limit integer default 200)
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v jsonb;
begin
  perform private.money_guard();
  select crosscheck into v from public.money_state where id;
  return coalesce(v, '{"compared": 0, "differ": 0, "tolerance": 5, "rows": []}'::jsonb);
end $$;

create or replace function public.money_wrong_fees(p_points numeric default null)
returns table (order_item_id text, order_id text, sku text, payment_date date, problem text, sale numeric,
               fee_points numeric, usual_points numeric, extra_fee numeric)
language plpgsql stable security invoker set search_path = '' as $$
begin
  perform private.money_guard();
  return query
  select f.order_item_id, f.order_id, f.sku, f.payment_date, f.problem, f.sale, f.fee_points, f.usual_points, f.extra_fee
  from public.money_wrong_fee_rows f
  order by f.extra_fee desc nulls last;
end $$;

-- ---------------------------------------------------------------------------
-- Telling the job there is work, and the job
-- ---------------------------------------------------------------------------

create or replace function private.money_mark(p_summary_from date default null, p_summary_to date default null,
                                              p_full boolean default false, p_checks boolean default true, p_flags boolean default true)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.money_state s
  set summary_dirty = s.summary_dirty or p_summary_from is not null or p_full,
      summary_from = case when p_summary_from is null then s.summary_from else least(coalesce(s.summary_from, p_summary_from), p_summary_from) end,
      summary_to = case when p_summary_to is null then s.summary_to else greatest(coalesce(s.summary_to, p_summary_to), p_summary_to) end,
      summary_full = s.summary_full or p_full,
      checks_dirty = s.checks_dirty or p_checks,
      flags_dirty = s.flags_dirty or p_flags
  where s.id;
end $$;

create or replace function private.money_refresh_pending() returns text
language plpgsql security definer set search_path = '' as $$
declare
  s public.money_state;
  v_cut date;
  v_done text := '';
  v_flags jsonb;
begin
  select * into s from public.money_state where id for update skip locked;
  if not found or s.working or not (s.summary_dirty or s.checks_dirty or s.flags_dirty) then
    return 'idle';
  end if;
  -- A stuck "working" flag is cleared by the next run if the last one died: it is only set inside this transaction.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('work_mem', '128MB', true);
  perform set_config('statement_timeout', '0', true);

  v_cut := current_date - make_interval(months => greatest(private.money_setting('money_keep_months', 12), 1)::integer);
  if s.summary_dirty then
    if s.summary_full or s.summary_from is null then
      perform private.money_refresh_summary();
    else
      perform private.money_refresh_summary(s.summary_from, s.summary_to);
    end if;
    delete from public.money_sku_day where payment_date < v_cut;
    v_done := v_done || 'summary ';
  end if;
  if s.checks_dirty then
    delete from public.money_wrong_fee_rows;
    insert into public.money_wrong_fee_rows select * from private.money_wrong_fees_compute();
    update public.money_state set crosscheck = private.money_crosscheck_compute(5, 200) where id;
    v_done := v_done || 'checks ';
  end if;
  v_flags := private.money_compute_flags();
  insert into public.money_flags_cache (id, payload, computed_at) values (true, v_flags, now())
  on conflict (id) do update set payload = excluded.payload, computed_at = now();
  v_done := v_done || 'flags';

  update public.money_state
  set summary_dirty = false, summary_from = null, summary_to = null, summary_full = false, checks_dirty = false, flags_dirty = false,
      refreshed_at = now()
  where id;
  return v_done;
end $$;

select cron.schedule('money-refresh', '* * * * *', $$select private.money_refresh_pending()$$);
-- The nightly job is now just "mark everything", so the unpaid count moves on as orders age.
create or replace function private.money_nightly() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.money_mark(null, null, false, true, true);
end $$;

-- Closing an upload no longer works anything out itself.
create or replace function public.money_finish_upload(p_upload uuid, p_summary jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  u public.money_uploads;
  v_from date;
  v_to date;
  v_total numeric;
  v_filled integer := 0;
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
  end if;

  update public.money_uploads
  set status = 'done', finished_at = now(), period_from = v_from, period_to = v_to, total_net = v_total,
      summary = coalesce(p_summary, '{}'::jsonb)
  where id = p_upload;

  -- Keep the months the setting says, by the day the money moved or the order was placed.
  delete from public.money_settled_lines where payment_date < v_cut;
  delete from public.money_other_lines where payment_date < v_cut;
  delete from public.money_pnl_orders where order_date < v_cut;

  -- The P&L report fills in SKUs that settled lines were missing: that touches any day, so it adds up everything.
  if u.kind = 'settled' then
    perform private.money_mark(v_from, v_to, false, true, true);
  else
    perform private.money_mark(null, null, true, true, true);
  end if;

  return jsonb_build_object('from', v_from, 'to', v_to, 'total', v_total, 'skus_filled', v_filled);
end $$;

-- A cost or a setting changed: the saved Needs action answer (and the checks, for a setting) are worked out again.
create or replace function private.money_costs_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.money_mark(null, null, false, false, true);
  return null;
end $$;
create trigger sku_costs_changed after insert or update or delete on public.sku_costs
  for each statement execute function private.money_costs_changed();

create or replace function private.money_setting_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.key like 'money\_%' and new.value is distinct from old.value then
    perform private.money_mark(null, null, false, true, true);
  end if;
  return null;
end $$;
create trigger app_settings_money_changed after update on public.app_settings
  for each row execute function private.money_setting_changed();

-- Work out everything once. The job picks this up within a minute (it is too long to run inside this migration).
select private.money_mark(null, null, true, true, true);

-- Estimate: add up per SKU and day first, then look the cost up once for each, not once per order.
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
    select i.sku, i.order_day, sum(i.quantity)::bigint as units
    from public.fk_order_items i
    where i.platform = 'flipkart' and i.stage in ('pending', 'dispatched') and i.sku is not null
      and i.order_day between p_from and p_to
      and not exists (select 1 from public.money_settled_lines l where l.order_item_id = i.order_item_id)
      and not exists (select 1 from public.fk_returns r where r.platform = 'flipkart' and r.order_item_id = i.order_item_id)
    group by i.sku, i.order_day
  ), per_sku as (
    select o.sku, sum(o.units)::bigint as units, sum(o.units * coalesce(c.unit_cost, 0)) as cost, bool_or(c.unit_cost is null) as cost_missing
    from open_items o
    left join lateral (
      select k.purchase_cost + k.packaging_cost + k.freight as unit_cost
      from public.sku_costs k where k.sku = o.sku and k.effective_from <= o.order_day
      order by k.effective_from desc limit 1
    ) c on true
    group by o.sku
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

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to service_role;
grant execute on function private.user_role(), private.is_staff(), private.can_see_post(uuid, uuid, uuid), private.can_see_post_id(uuid) to authenticated;
grant execute on function private.money_allowed(), private.money_guard(), private.money_setting(text, numeric), private.money_unit_cost(text, date),
  private.money_latest_day(), private.money_slab_upper(numeric), private.try_num(text), private.money_mark(date, date, boolean, boolean, boolean) to authenticated;
do $$
declare
  f text;
begin
  foreach f in array array['money_crosscheck(numeric, integer)', 'money_wrong_fees(numeric)', 'money_finish_upload(uuid, jsonb)', 'money_estimate(date, date)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
