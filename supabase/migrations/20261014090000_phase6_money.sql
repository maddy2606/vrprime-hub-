-- Phase 6: money. Flipkart settlement reports, SKU costs, profit per SKU, weight overcharges, settlement checks.
--
-- EVERYTHING HERE IS OWNER ONLY, in the database: every table has one row-level-security policy that lets a
-- signed-in owner through and nobody else (admins and warehouse users read nothing, write nothing), and every
-- function refuses anyone who is not an owner. The import functions also accept the service role, which is how
-- the import script run by the developer works; the service role is never exposed to a browser.
--
-- No buyer personal data is stored: the importers only read the money, SKU, date and ID columns.

-- ---------------------------------------------------------------------------
-- The owner check
-- ---------------------------------------------------------------------------

create or replace function private.money_allowed() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.user_role() = 'owner', false)
         or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
$$;

create or replace function private.money_guard() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.money_allowed() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.money_uploads (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('settled', 'pnl')),
  filename text not null,
  period_from date,
  period_to date,
  rows_seen integer not null default 0,
  rows_added integer not null default 0,
  rows_dup integer not null default 0,
  rows_updated integer not null default 0,
  other_added integer not null default 0,
  total_net numeric(16, 3),
  summary jsonb not null default '{}'::jsonb,
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  error text,
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

-- One row per bank payment (NEFT) so the long NEFT text is not repeated on every line.
create table public.money_payments (
  id integer generated always as identity primary key,
  neft_id text not null unique,
  neft_type text,
  payment_date date
);
create index money_payments_date_idx on public.money_payments (payment_date);

-- Settled Transactions, sheet "Orders": one row per order item per payment.
-- Fee columns are negative numbers (money out), as in the report.
create table public.money_settled_lines (
  key uuid primary key,
  upload_id uuid not null references public.money_uploads (id) on delete cascade,
  payment_id integer not null references public.money_payments (id),
  payment_date date,
  order_id text,
  order_item_id text not null,
  sku text,
  order_date date,
  dispatch_date date,
  qty integer,
  fulfilment text,
  return_type text,
  invoice_id text,
  sale_amount numeric(14, 3) not null default 0,
  offer_amount numeric(14, 3) not null default 0,
  refund numeric(14, 3) not null default 0,
  addons numeric(14, 3) not null default 0,
  mp_fee numeric(14, 3) not null default 0,
  taxes numeric(14, 3) not null default 0,
  offer_adj numeric(14, 3) not null default 0,
  protection_fund numeric(14, 3) not null default 0,
  commission_rate numeric(8, 3),
  commission numeric(14, 3) not null default 0,
  fixed_fee numeric(14, 3) not null default 0,
  collection_fee numeric(14, 3) not null default 0,
  pick_pack_fee numeric(14, 3) not null default 0,
  shipping_fee numeric(14, 3) not null default 0,
  reverse_shipping_fee numeric(14, 3) not null default 0,
  other_fees numeric(14, 3) not null default 0,
  gst_on_fees numeric(14, 3) not null default 0,
  tcs numeric(14, 3) not null default 0,
  tds numeric(14, 3) not null default 0,
  net numeric(14, 3) not null default 0,
  itc_gst_tcs numeric(14, 3) not null default 0,
  itc_tds numeric(14, 3) not null default 0,
  dead_weight numeric(9, 3),
  vol_weight numeric(9, 3),
  weight_source text,
  weight_type text,
  weight_slab text,
  zone text,
  lbh text,
  extra jsonb
);
create index money_settled_date_idx on public.money_settled_lines (payment_date);
create index money_settled_item_idx on public.money_settled_lines (order_item_id);
create index money_settled_sku_idx on public.money_settled_lines (sku);
create index money_settled_upload_idx on public.money_settled_lines (upload_id);

-- The other sheets of a Settled Transactions report: ads, Google ads, storage and recall, SPF claims, fines,
-- value added services, MP fee rebates, TDS and TCS recoveries.
-- amount = the settlement value (cash); expense = what it costs (negative) or earns (positive) as profit and loss.
create table public.money_other_lines (
  key uuid primary key,
  upload_id uuid not null references public.money_uploads (id) on delete cascade,
  kind text not null,
  payment_id integer references public.money_payments (id),
  payment_date date,
  sku text,
  ref text,
  ref_date date,
  amount numeric(14, 3) not null default 0,
  expense numeric(14, 3) not null default 0,
  gst numeric(14, 3) not null default 0,
  extra jsonb
);
create index money_other_date_idx on public.money_other_lines (payment_date, kind);
create index money_other_upload_idx on public.money_other_lines (upload_id);

-- Profit and Loss Report, sheet "Orders P&L": Flipkart's own figures per order item.
create table public.money_pnl_orders (
  order_item_id text primary key,
  upload_id uuid not null references public.money_uploads (id) on delete cascade,
  order_id text,
  order_date date,
  sku text,
  fulfilment text,
  status text,
  gross_units numeric(10, 2),
  returned_units numeric(10, 2),
  net_units numeric(10, 2),
  order_item_value numeric(14, 3),
  fsp numeric(14, 3),
  estimated_net_sales numeric(14, 3),
  accounted_sales numeric(14, 3),
  seller_discount numeric(14, 3),
  total_expenses numeric(14, 3),
  commission numeric(14, 3),
  collection_fee numeric(14, 3),
  fixed_fee numeric(14, 3),
  pick_pack_fee numeric(14, 3),
  shipping_fee numeric(14, 3),
  reverse_shipping_fee numeric(14, 3),
  gst numeric(14, 3),
  tcs numeric(14, 3),
  tds numeric(14, 3),
  rewards numeric(14, 3),
  spf numeric(14, 3),
  bank_projected numeric(14, 3),
  itc numeric(14, 3),
  net_earnings numeric(14, 3),
  amount_settled numeric(14, 3),
  amount_pending numeric(14, 3),
  -- [[neft id, amount], ...] for the payments that settled this order item
  txns jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
create index money_pnl_date_idx on public.money_pnl_orders (order_date);
create index money_pnl_upload_idx on public.money_pnl_orders (upload_id);

-- What each SKU costs. The cost in force on the order date is used, so old orders keep their old cost.
create table public.sku_costs (
  sku text not null check (sku <> ''),
  effective_from date not null,
  purchase_cost numeric(12, 2) not null check (purchase_cost >= 0),
  packaging_cost numeric(12, 2) not null default 0 check (packaging_cost >= 0),
  freight numeric(12, 2) not null default 0 check (freight >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  primary key (sku, effective_from)
);

-- ---------------------------------------------------------------------------
-- Row level security: owner only, nothing for anyone else
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['money_uploads', 'money_payments', 'money_settled_lines', 'money_other_lines', 'money_pnl_orders', 'sku_costs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select private.user_role()) = ''owner'') with check ((select private.user_role()) = ''owner'')',
      t || '_owner_only', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Settings (owner changes them on the Settings page)
-- ---------------------------------------------------------------------------

insert into public.app_settings (key, value) values
  ('money_low_margin_percent', '10'),
  ('money_default_fee_percent', '12'),
  ('money_unpaid_after_days', '15'),
  ('money_fee_deviation_points', '2'),
  ('money_upload_reminder_days', '14'),
  ('money_keep_months', '12')
on conflict (key) do nothing;

create or replace function private.money_setting(p_key text, p_default numeric) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((select private.try_num(value #>> '{}') from public.app_settings where key = p_key), p_default)
$$;

-- ---------------------------------------------------------------------------
-- Importing: the browser (or the import script) sends rows in batches of about 1,000
-- ---------------------------------------------------------------------------

create or replace function public.money_begin_upload(p_kind text, p_filename text) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
begin
  perform private.money_guard();
  insert into public.money_uploads (kind, filename, uploaded_by)
  values (p_kind, left(p_filename, 300), (select auth.uid()))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.money_add_settled(p_upload uuid, p_rows jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_seen integer := jsonb_array_length(p_rows);
  v_added integer;
begin
  perform private.money_guard();

  insert into public.money_payments (neft_id, neft_type, payment_date)
  select distinct on (r.neft_id) r.neft_id, r.neft_type, r.payment_date
  from jsonb_to_recordset(p_rows) as r(neft_id text, neft_type text, payment_date date)
  where r.neft_id is not null
  on conflict (neft_id) do nothing;

  insert into public.money_settled_lines (
    key, upload_id, payment_id, payment_date, order_id, order_item_id, sku, order_date, dispatch_date, qty,
    fulfilment, return_type, invoice_id, sale_amount, offer_amount, refund, addons, mp_fee, taxes, offer_adj,
    protection_fund, commission_rate, commission, fixed_fee, collection_fee, pick_pack_fee, shipping_fee,
    reverse_shipping_fee, other_fees, gst_on_fees, tcs, tds, net, itc_gst_tcs, itc_tds, dead_weight, vol_weight,
    weight_source, weight_type, weight_slab, zone, lbh, extra)
  select
    md5(r.key)::uuid, p_upload, p.id, r.payment_date, r.order_id, r.order_item_id, r.sku, r.order_date, r.dispatch_date, r.qty,
    r.fulfilment, r.return_type, r.invoice_id,
    coalesce(r.sale_amount, 0), coalesce(r.offer_amount, 0), coalesce(r.refund, 0), coalesce(r.addons, 0),
    coalesce(r.mp_fee, 0), coalesce(r.taxes, 0), coalesce(r.offer_adj, 0), coalesce(r.protection_fund, 0),
    r.commission_rate, coalesce(r.commission, 0), coalesce(r.fixed_fee, 0), coalesce(r.collection_fee, 0),
    coalesce(r.pick_pack_fee, 0), coalesce(r.shipping_fee, 0), coalesce(r.reverse_shipping_fee, 0),
    coalesce(r.other_fees, 0), coalesce(r.gst_on_fees, 0), coalesce(r.tcs, 0), coalesce(r.tds, 0),
    coalesce(r.net, 0), coalesce(r.itc_gst_tcs, 0), coalesce(r.itc_tds, 0), r.dead_weight, r.vol_weight,
    r.weight_source, r.weight_type, r.weight_slab, r.zone, r.lbh, r.extra
  from jsonb_to_recordset(p_rows) as r(
    key text, neft_id text, neft_type text, payment_date date, order_id text, order_item_id text, sku text,
    order_date date, dispatch_date date, qty integer, fulfilment text, return_type text, invoice_id text,
    sale_amount numeric, offer_amount numeric, refund numeric, addons numeric, mp_fee numeric, taxes numeric,
    offer_adj numeric, protection_fund numeric, commission_rate numeric, commission numeric, fixed_fee numeric,
    collection_fee numeric, pick_pack_fee numeric, shipping_fee numeric, reverse_shipping_fee numeric,
    other_fees numeric, gst_on_fees numeric, tcs numeric, tds numeric, net numeric, itc_gst_tcs numeric,
    itc_tds numeric, dead_weight numeric, vol_weight numeric, weight_source text, weight_type text,
    weight_slab text, zone text, lbh text, extra jsonb)
  join public.money_payments p on p.neft_id = r.neft_id
  on conflict (key) do nothing;
  get diagnostics v_added = row_count;

  update public.money_uploads
  set rows_seen = rows_seen + v_seen, rows_added = rows_added + v_added, rows_dup = rows_dup + (v_seen - v_added)
  where id = p_upload;
  return jsonb_build_object('seen', v_seen, 'added', v_added);
end $$;

create or replace function public.money_add_other(p_upload uuid, p_rows jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_seen integer := jsonb_array_length(p_rows);
  v_added integer;
begin
  perform private.money_guard();

  insert into public.money_payments (neft_id, neft_type, payment_date)
  select distinct on (r.neft_id) r.neft_id, null, r.payment_date
  from jsonb_to_recordset(p_rows) as r(neft_id text, payment_date date)
  where r.neft_id is not null
  on conflict (neft_id) do nothing;

  insert into public.money_other_lines (key, upload_id, kind, payment_id, payment_date, sku, ref, ref_date, amount, expense, gst, extra)
  select md5(r.key)::uuid, p_upload, r.kind, p.id, r.payment_date, r.sku, r.ref, r.ref_date,
         coalesce(r.amount, 0), coalesce(r.expense, 0), coalesce(r.gst, 0), r.extra
  from jsonb_to_recordset(p_rows) as r(key text, kind text, neft_id text, payment_date date, sku text, ref text,
                                       ref_date date, amount numeric, expense numeric, gst numeric, extra jsonb)
  left join public.money_payments p on p.neft_id = r.neft_id
  on conflict (key) do nothing;
  get diagnostics v_added = row_count;

  update public.money_uploads
  set other_added = other_added + v_added
  where id = p_upload;
  return jsonb_build_object('seen', v_seen, 'added', v_added);
end $$;

-- P&L orders are replaced by a newer report: the figures mature as returns and payments come in.
create or replace function public.money_add_pnl(p_upload uuid, p_rows jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_seen integer := jsonb_array_length(p_rows);
  v_new integer;
  v_changed integer;
begin
  perform private.money_guard();

  select count(*) into v_new
  from jsonb_to_recordset(p_rows) as r(order_item_id text)
  where not exists (select 1 from public.money_pnl_orders o where o.order_item_id = r.order_item_id);

  insert into public.money_pnl_orders (
    order_item_id, upload_id, order_id, order_date, sku, fulfilment, status, gross_units, returned_units, net_units,
    order_item_value, fsp, estimated_net_sales, accounted_sales, seller_discount, total_expenses, commission,
    collection_fee, fixed_fee, pick_pack_fee, shipping_fee, reverse_shipping_fee, gst, tcs, tds, rewards, spf,
    bank_projected, itc, net_earnings, amount_settled, amount_pending, txns)
  select r.order_item_id, p_upload, r.order_id, r.order_date, r.sku, r.fulfilment, r.status, r.gross_units,
         r.returned_units, r.net_units, r.order_item_value, r.fsp, r.estimated_net_sales, r.accounted_sales,
         r.seller_discount, r.total_expenses, r.commission, r.collection_fee, r.fixed_fee, r.pick_pack_fee,
         r.shipping_fee, r.reverse_shipping_fee, r.gst, r.tcs, r.tds, r.rewards, r.spf, r.bank_projected, r.itc,
         r.net_earnings, r.amount_settled, r.amount_pending, coalesce(r.txns, '[]'::jsonb)
  from jsonb_to_recordset(p_rows) as r(
    order_item_id text, order_id text, order_date date, sku text, fulfilment text, status text,
    gross_units numeric, returned_units numeric, net_units numeric, order_item_value numeric, fsp numeric,
    estimated_net_sales numeric, accounted_sales numeric, seller_discount numeric, total_expenses numeric,
    commission numeric, collection_fee numeric, fixed_fee numeric, pick_pack_fee numeric, shipping_fee numeric,
    reverse_shipping_fee numeric, gst numeric, tcs numeric, tds numeric, rewards numeric, spf numeric,
    bank_projected numeric, itc numeric, net_earnings numeric, amount_settled numeric, amount_pending numeric,
    txns jsonb)
  on conflict (order_item_id) do update set
    upload_id = excluded.upload_id, order_id = excluded.order_id, order_date = excluded.order_date, sku = excluded.sku,
    fulfilment = excluded.fulfilment, status = excluded.status, gross_units = excluded.gross_units,
    returned_units = excluded.returned_units, net_units = excluded.net_units,
    order_item_value = excluded.order_item_value, fsp = excluded.fsp,
    estimated_net_sales = excluded.estimated_net_sales, accounted_sales = excluded.accounted_sales,
    seller_discount = excluded.seller_discount, total_expenses = excluded.total_expenses,
    commission = excluded.commission, collection_fee = excluded.collection_fee, fixed_fee = excluded.fixed_fee,
    pick_pack_fee = excluded.pick_pack_fee, shipping_fee = excluded.shipping_fee,
    reverse_shipping_fee = excluded.reverse_shipping_fee, gst = excluded.gst, tcs = excluded.tcs, tds = excluded.tds,
    rewards = excluded.rewards, spf = excluded.spf, bank_projected = excluded.bank_projected, itc = excluded.itc,
    net_earnings = excluded.net_earnings, amount_settled = excluded.amount_settled,
    amount_pending = excluded.amount_pending, txns = excluded.txns, updated_at = now()
  where (public.money_pnl_orders.amount_settled, public.money_pnl_orders.bank_projected, public.money_pnl_orders.status,
         public.money_pnl_orders.txns)
        is distinct from (excluded.amount_settled, excluded.bank_projected, excluded.status, excluded.txns);
  get diagnostics v_changed = row_count;

  update public.money_uploads
  set rows_seen = rows_seen + v_seen,
      rows_added = rows_added + v_new,
      rows_updated = rows_updated + greatest(v_changed - v_new, 0),
      rows_dup = rows_dup + (v_seen - v_changed)
  where id = p_upload;
  return jsonb_build_object('seen', v_seen, 'added', v_new, 'changed', v_changed);
end $$;

-- Closes an upload: fills missing SKUs from the order data, works out the date range and the total, drops old data.
create or replace function public.money_finish_upload(p_upload uuid, p_summary jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  u public.money_uploads;
  v_from date;
  v_to date;
  v_total numeric;
  v_filled integer := 0;
  v_keep integer := greatest(private.money_setting('money_keep_months', 12), 1)::integer;
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
  end if;

  update public.money_uploads
  set status = 'done', finished_at = now(), period_from = v_from, period_to = v_to, total_net = v_total,
      summary = coalesce(p_summary, '{}'::jsonb)
  where id = p_upload;

  -- Keep 12 months (the setting), by the day the money moved or the order was placed.
  delete from public.money_settled_lines where payment_date < (current_date - make_interval(months => v_keep));
  delete from public.money_other_lines where payment_date < (current_date - make_interval(months => v_keep));
  delete from public.money_pnl_orders where order_date < (current_date - make_interval(months => v_keep));

  return jsonb_build_object('from', v_from, 'to', v_to, 'total', v_total, 'skus_filled', v_filled);
end $$;

create or replace function public.money_fail_upload(p_upload uuid, p_error text) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  perform private.money_guard();
  update public.money_uploads set status = 'failed', error = left(p_error, 500), finished_at = now() where id = p_upload;
end $$;

-- ---------------------------------------------------------------------------
-- Costs
-- ---------------------------------------------------------------------------

-- The unit cost in force for a SKU on a day.
create or replace function private.money_unit_cost(p_sku text, p_day date) returns numeric
language sql stable security definer set search_path = '' as $$
  select c.purchase_cost + c.packaging_cost + c.freight
  from public.sku_costs c
  where c.sku = p_sku and c.effective_from <= p_day
  order by c.effective_from desc
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- Profit per SKU. The period is by the day the money was settled (payment date).
-- Units sold: lines with a sale and no refund. Units returned: lines with a refund (they come back to stock).
-- Profit = net payout + input tax credits (Flipkart's "Net Earnings") - cost of the units kept.
-- ---------------------------------------------------------------------------

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
  with lines as (
    select l.*,
           private.money_unit_cost(l.sku, coalesce(l.order_date, l.payment_date)) as unit_cost
    from public.money_settled_lines l
    where l.payment_date between p_from and p_to
  )
  select coalesce(l.sku, '(no SKU)')::text,
         coalesce(sum(case when l.sale_amount > 0 and l.refund = 0 then coalesce(l.qty, 1) end), 0)::bigint,
         coalesce(sum(case when l.refund < 0 then coalesce(l.qty, 1) end), 0)::bigint,
         coalesce(sum(case when l.refund = 0 then l.sale_amount end), 0),
         coalesce(sum(l.refund), 0),
         sum(l.commission), sum(l.fixed_fee), sum(l.collection_fee), sum(l.shipping_fee), sum(l.reverse_shipping_fee),
         sum(l.pick_pack_fee + l.other_fees),
         sum(l.gst_on_fees), sum(l.tcs), sum(l.tds), sum(l.net), sum(l.itc_gst_tcs + l.itc_tds),
         coalesce(sum(case when l.sale_amount > 0 and l.refund = 0 then coalesce(l.qty, 1) * coalesce(l.unit_cost, 0)
                           when l.refund < 0 then -coalesce(l.qty, 1) * coalesce(l.unit_cost, 0) end), 0),
         coalesce(bool_or(l.unit_cost is null and (l.sale_amount > 0 or l.refund < 0)), false),
         count(distinct l.order_item_id)
  from lines l
  group by coalesce(l.sku, '(no SKU)');
end $$;

-- The last day any settlement money moved: reports are always a little behind, so "recent" means recent to this.
create or replace function private.money_latest_day() returns date
language sql stable security definer set search_path = '' as $$
  select max(payment_date) from public.money_settled_lines
$$;

-- Account-level lines for a period: ads, Google ads, storage, fines and the rest. Not tied to a SKU.
create or replace function public.money_account_lines(p_from date, p_to date)
returns table (kind text, expense numeric, amount numeric, lines bigint)
language plpgsql stable security invoker set search_path = '' as $$
begin
  perform private.money_guard();
  return query
  select o.kind, sum(o.expense), sum(o.amount), count(*)
  from public.money_other_lines o
  where o.payment_date between p_from and p_to
  group by o.kind
  order by o.kind;
end $$;

-- Every line behind one SKU, for the drill-down.
create or replace function public.money_sku_lines(p_sku text, p_from date, p_to date, p_limit integer default 100, p_offset integer default 0)
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_total bigint;
  v_rows jsonb;
begin
  perform private.money_guard();
  select count(*) into v_total
  from public.money_settled_lines l
  where l.payment_date between p_from and p_to and l.sku is not distinct from nullif(p_sku, '(no SKU)');

  select coalesce(jsonb_agg(to_jsonb(x) order by x.payment_date desc, x.order_item_id), '[]'::jsonb) into v_rows
  from (
    select l.order_item_id, l.order_id, l.payment_date, l.order_date, l.qty, l.sale_amount, l.refund, l.commission,
           l.fixed_fee, l.collection_fee, l.shipping_fee, l.reverse_shipping_fee, l.pick_pack_fee + l.other_fees as other_fees,
           l.gst_on_fees, l.tcs, l.tds, l.net, l.itc_gst_tcs + l.itc_tds as itc, l.return_type,
           private.money_unit_cost(l.sku, coalesce(l.order_date, l.payment_date)) as unit_cost
    from public.money_settled_lines l
    where l.payment_date between p_from and p_to and l.sku is not distinct from nullif(p_sku, '(no SKU)')
    order by l.payment_date desc, l.order_item_id
    limit greatest(least(p_limit, 500), 1) offset greatest(p_offset, 0)
  ) x;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;

-- Estimated profit for orders not settled yet: the SKU's current price, its recent fee %, its cost.
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
    select l.sku,
           sum(case when l.sale_amount > 0 and l.refund = 0 then l.sale_amount end) as sold,
           sum(case when l.sale_amount > 0 and l.refund = 0 then coalesce(l.qty, 1) end) as sold_units,
           sum(l.mp_fee + l.taxes) as fees
    from public.money_settled_lines l
    where l.payment_date > v_latest - 90
    group by l.sku
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

-- Our maths against Flipkart's: for each payment of each P&L order, what the P&L says was paid against what the
-- Settled Transactions report says for the same payment and order item.
create or replace function public.money_crosscheck(p_tolerance numeric default 5, p_limit integer default 200)
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_compared bigint;
  v_differ bigint;
  v_rows jsonb;
begin
  perform private.money_guard();
  with cc as (
    select o.order_item_id, o.sku, p.neft_id, (t.value ->> 1)::numeric as flipkart_amount,
           coalesce((select sum(l.net) from public.money_settled_lines l
                     where l.payment_id = p.id and l.order_item_id = o.order_item_id), 0) as our_amount
    from public.money_pnl_orders o
    cross join lateral jsonb_array_elements(o.txns) t
    join public.money_payments p on p.neft_id = t.value ->> 0
    where exists (select 1 from public.money_settled_lines x where x.payment_id = p.id limit 1)
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

-- Weight overcharges: orders where Flipkart charged a bigger weight slab than our own package says.
-- Dead weight = the listing's weight in kg. Volumetric = L x B x H (cm) / 5000, the divisor the report itself uses.
-- Slabs: 0.5 kg steps up to 2.5 kg, then 1 kg steps (as in the report). Extra fee = what was paid minus the usual fee
-- for the right slab in the same zone (middle value of the other charges), when there are others to compare with.
create or replace function private.money_slab_upper(p_kg numeric) returns numeric
language sql immutable set search_path = '' as $$
  select case when p_kg <= 2.5 then ceil(p_kg / 0.5) * 0.5 else ceil(p_kg) end
$$;

create or replace function public.money_weight(p_from date, p_to date)
returns table (order_item_id text, order_id text, sku text, payment_date date, zone text, weight_type text,
               charged_slab text, charged_kg numeric, our_kg numeric, our_slab_kg numeric, fee_paid numeric,
               usual_fee numeric, extra_fee numeric)
language plpgsql stable security invoker set search_path = '' as $$
begin
  perform private.money_guard();
  return query
  with charged as (
    select l.*, nullif(split_part(l.weight_slab, '-', 2), '')::numeric as charged_upper,
           -(l.shipping_fee + l.reverse_shipping_fee) as fee
    from public.money_settled_lines l
    where l.weight_slab is not null and l.weight_slab ~ '^[0-9.]+-[0-9.]+$'
      and l.payment_date between p_from and p_to
  ), mine as (
    select c.*, pk.kg as our_kg
    from charged c
    left join lateral (
      select greatest(coalesce(d.kg, 0), d.l * d.b * d.h / 5000.0) as kg
      from public.stock_listings sl,
           lateral jsonb_array_elements(case when jsonb_typeof(sl.packages) = 'array' then sl.packages else '[]'::jsonb end) x,
           lateral (select private.try_num(x #>> '{dimensions,length}') as l, private.try_num(x #>> '{dimensions,breadth}') as b,
                           private.try_num(x #>> '{dimensions,height}') as h, private.try_num(x ->> 'weight') as kg) d
      where sl.platform = 'flipkart' and sl.sku = c.sku and d.l > 0 and d.b > 0 and d.h > 0
      order by d.l * d.b * d.h desc
      limit 1
    ) pk on true
  ), usual as (
    select m.zone, m.charged_upper, percentile_cont(0.5) within group (order by m.fee) as fee
    from mine m
    where m.our_kg is not null and private.money_slab_upper(m.our_kg) >= m.charged_upper and m.fee > 0
    group by m.zone, m.charged_upper
  )
  select m.order_item_id, m.order_id, m.sku, m.payment_date, m.zone, m.weight_type, m.weight_slab, m.charged_upper,
         round(m.our_kg, 3), private.money_slab_upper(m.our_kg), m.fee, u.fee,
         case when u.fee is null then null else greatest(m.fee - u.fee, 0) end
  from mine m
  left join usual u on u.zone is not distinct from m.zone and u.charged_upper = private.money_slab_upper(m.our_kg)
  where m.our_kg is not null and m.charged_upper > private.money_slab_upper(m.our_kg)
  order by m.payment_date desc, m.order_item_id;
end $$;

-- Settlement checker, part 1: shipped orders with no money line, long enough after the order that it should have paid.
-- Only orders up to the latest settlement day we hold are judged, so a report that is a month old does not make
-- every new order look unpaid.
create or replace function public.money_unpaid(p_days integer default null)
returns table (order_item_id text, order_id text, sku text, qty integer, order_day date, days_ago integer)
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_days integer := coalesce(p_days, private.money_setting('money_unpaid_after_days', 15)::integer);
  v_latest date := private.money_latest_day();
begin
  perform private.money_guard();
  if v_latest is null then
    return;
  end if;
  return query
  select i.order_item_id, i.order_id, i.sku, i.quantity, i.order_day, (current_date - i.order_day)
  from public.fk_order_items i
  where i.platform = 'flipkart' and i.stage = 'dispatched'
    and i.order_day <= v_latest - v_days
    and not exists (select 1 from public.money_settled_lines l where l.order_item_id = i.order_item_id)
    and not exists (select 1 from public.fk_returns r where r.platform = 'flipkart' and r.order_item_id = i.order_item_id)
    and not exists (select 1 from public.money_pnl_orders p where p.order_item_id = i.order_item_id and p.status in ('CANCELLED', 'RETURNED', 'RETURN_REQUESTED'))
  order by i.order_day, i.order_item_id;
end $$;

-- Settlement checker, part 2: fees far from the SKU's usual, and fees charged twice for one order item.
create or replace function public.money_wrong_fees(p_points numeric default null)
returns table (order_item_id text, order_id text, sku text, payment_date date, problem text, sale numeric,
               fee_points numeric, usual_points numeric, extra_fee numeric)
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_points numeric := coalesce(p_points, private.money_setting('money_fee_deviation_points', 2));
begin
  perform private.money_guard();
  return query
  with sold as (
    select l.*, -(l.commission + l.fixed_fee + l.collection_fee) as fees
    from public.money_settled_lines l
    where l.sale_amount > 0 and l.refund = 0 and l.sku is not null
  ), usual as (
    select s.sku, percentile_cont(0.5) within group (order by s.fees / s.sale_amount * 100) as pts
    from sold s group by s.sku having count(*) >= 20
  ), off as (
    select s.order_item_id, s.order_id, s.sku, s.payment_date, 'Fee % is far from usual'::text as problem, s.sale_amount as sale,
           round(s.fees / s.sale_amount * 100, 2) as fee_points, round(u.pts::numeric, 2) as usual_points,
           round(greatest(s.fees - u.pts::numeric / 100 * s.sale_amount, 0), 2) as extra_fee
    from sold s join usual u on u.sku = s.sku
    where abs(s.fees / s.sale_amount * 100 - u.pts) > v_points
  ), twice as (
    select l.order_item_id, min(l.order_id) as order_id, min(l.sku) as sku, max(l.payment_date) as payment_date,
           'Fee charged twice'::text as problem, sum(l.sale_amount) as sale,
           null::numeric as fee_points, null::numeric as usual_points,
           round(-(sum(l.commission + l.fixed_fee + l.collection_fee) - min(l.commission + l.fixed_fee + l.collection_fee)), 2) as extra_fee
    from public.money_settled_lines l
    where l.refund = 0 and l.sale_amount > 0 and (l.commission + l.fixed_fee + l.collection_fee) <> 0
    group by l.order_item_id
    having count(*) > 1
  )
  select * from off union all select * from twice
  order by 9 desc nulls last;
end $$;

-- What Needs action shows to the owner.
create or replace function public.money_flags()
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_latest date := private.money_latest_day();
  v_low numeric := private.money_setting('money_low_margin_percent', 10);
  v_neg jsonb;
  v_low_rows jsonb;
  v_unpaid bigint;
  v_last_upload timestamptz;
  v_missing_cost bigint;
begin
  perform private.money_guard();
  select max(created_at) into v_last_upload from public.money_uploads where status = 'done';
  if v_latest is null then
    return jsonb_build_object('latest', null, 'negative', '[]'::jsonb, 'low', '[]'::jsonb, 'unpaid', 0, 'cost_missing', 0,
                              'last_upload', v_last_upload, 'low_margin_percent', v_low);
  end if;

  with p as (
    select x.sku, (x.net_payout + x.itc - x.cost) as profit, (x.gross_sales + x.refunds) as revenue
    from public.money_profit(v_latest - 29, v_latest) x
    where not x.cost_missing and x.sku <> '(no SKU)' and (x.gross_sales + x.refunds) > 0
  )
  select
    coalesce(jsonb_agg(jsonb_build_object('sku', sku, 'margin', round(profit / revenue * 100, 1), 'profit', round(profit, 0))
                       order by profit / revenue) filter (where profit < 0), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('sku', sku, 'margin', round(profit / revenue * 100, 1), 'profit', round(profit, 0))
                       order by profit / revenue) filter (where profit >= 0 and profit / revenue * 100 < v_low), '[]'::jsonb)
  into v_neg, v_low_rows
  from p;

  select count(*) into v_unpaid from public.money_unpaid();
  select count(distinct x.sku) into v_missing_cost
  from public.money_profit(v_latest - 29, v_latest) x where x.cost_missing and x.sku <> '(no SKU)';

  return jsonb_build_object('latest', v_latest, 'negative', v_neg, 'low', v_low_rows, 'unpaid', v_unpaid,
                            'cost_missing', v_missing_cost, 'last_upload', v_last_upload, 'low_margin_percent', v_low);
end $$;

-- Reminder to the owners when nothing has been uploaded for a while.
create or replace function private.money_upload_reminder() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_days integer := greatest(private.money_setting('money_upload_reminder_days', 14), 1)::integer;
  v_last timestamptz;
  v_sent integer := 0;
  u uuid;
begin
  select max(created_at) into v_last from public.money_uploads where status = 'done';
  if v_last is null or v_last > now() - make_interval(days => v_days) then
    return 0;
  end if;
  for u in select p.id from public.profiles p where p.active and p.role = 'owner'
           and not exists (select 1 from public.notifications n where n.user_id = p.id and n.kind = 'money_reminder'
                           and n.created_at > now() - interval '7 days') loop
    insert into public.notifications (user_id, kind, title, body)
    values (u, 'money_reminder', 'Upload a Flipkart settlement report',
            'Nothing has been uploaded to Money for ' || v_days || '+ days. Download Settled Transactions and the Profit and Loss Report from Seller Hub (Payments, Reports).');
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end $$;

select cron.schedule('money-upload-reminder', '30 4 * * *', $$select private.money_upload_reminder()$$);

drop trigger notifications_push on public.notifications;
create trigger notifications_push after insert on public.notifications
  for each row when (new.kind in ('assigned', 'comment', 'done', 'test', 'dispatch_risk', 'listing_live', 'listing_not_found', 'money_reminder'))
  execute function private.notifications_push();

-- ---------------------------------------------------------------------------
-- Ticket issue types for what the checkers find
-- ---------------------------------------------------------------------------

alter table public.tickets drop constraint tickets_issue_type_check;
alter table public.tickets add constraint tickets_issue_type_check
  check (issue_type in ('wrong_return', 'payment_missing', 'listing_blocked', 'claim', 'other', 'weight_overcharge', 'wrong_fee'));

-- ---------------------------------------------------------------------------
-- Grants: owner only (each function also checks), nothing for anon
-- ---------------------------------------------------------------------------

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to service_role;
grant execute on function private.user_role(), private.is_staff(), private.can_see_post(uuid, uuid, uuid), private.can_see_post_id(uuid) to authenticated;
grant execute on function private.money_allowed(), private.money_guard(), private.money_setting(text, numeric), private.money_unit_cost(text, date),
  private.money_latest_day(), private.money_slab_upper(numeric), private.try_num(text) to authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'money_begin_upload(text, text)', 'money_add_settled(uuid, jsonb)', 'money_add_other(uuid, jsonb)', 'money_add_pnl(uuid, jsonb)',
    'money_finish_upload(uuid, jsonb)', 'money_fail_upload(uuid, text)', 'money_profit(date, date)', 'money_account_lines(date, date)',
    'money_sku_lines(text, date, date, integer, integer)', 'money_estimate(date, date)', 'money_crosscheck(numeric, integer)',
    'money_weight(date, date)', 'money_unpaid(integer)', 'money_wrong_fees(numeric)', 'money_flags()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
