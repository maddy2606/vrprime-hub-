-- How returns appear in a settled report, learnt from the real files:
--   * a line with a sale and no refund is a sold unit that was paid;
--   * a returned order comes in one of two forms. Returned before it was paid out: ONE line with the sale AND a refund
--     of the same amount (they cancel inside the line, so no money moved except the return fees). Returned after it was
--     paid out: a line with no sale and a refund (the money is taken back).
-- So gross sales = every sale amount, refunds = every refund, and sales kept = their sum. A unit's cost comes back only
-- in the second form (the first was never counted as sold). The summary table is rebuilt by the background job.

alter table public.money_sku_day
  add column units_returned_paid integer not null default 0,
  add column sold_sales numeric(16, 3) not null default 0;

create or replace function private.money_refresh_summary(p_from date default null, p_to date default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.money_sku_day
  where (p_from is null or payment_date >= p_from) and (p_to is null or payment_date <= p_to);

  insert into public.money_sku_day (payment_date, sku, order_day, units_sold, units_returned, units_returned_paid, gross_sales, sold_sales,
      refunds, commission, fixed_fee, collection_fee, shipping_fee, reverse_shipping_fee, other_fees, mp_fee, taxes, gst_on_fees, tcs, tds,
      net, itc, lines)
  select l.payment_date, coalesce(l.sku, '(no SKU)'), coalesce(l.order_date, l.payment_date),
         coalesce(sum(case when l.sale_amount > 0 and l.refund = 0 then coalesce(l.qty, 1) end), 0),
         coalesce(sum(case when l.refund < 0 then coalesce(l.qty, 1) end), 0),
         coalesce(sum(case when l.refund < 0 and l.sale_amount <= 0 then coalesce(l.qty, 1) end), 0),
         sum(l.sale_amount),
         coalesce(sum(case when l.refund = 0 then l.sale_amount end), 0),
         sum(l.refund),
         sum(l.commission), sum(l.fixed_fee), sum(l.collection_fee), sum(l.shipping_fee), sum(l.reverse_shipping_fee),
         sum(l.pick_pack_fee + l.other_fees), sum(l.mp_fee), sum(l.taxes), sum(l.gst_on_fees), sum(l.tcs), sum(l.tds), sum(l.net),
         sum(l.itc_gst_tcs + l.itc_tds), count(*)
  from public.money_settled_lines l
  where l.payment_date is not null
    and (p_from is null or l.payment_date >= p_from) and (p_to is null or l.payment_date <= p_to)
  group by l.payment_date, coalesce(l.sku, '(no SKU)'), coalesce(l.order_date, l.payment_date);
end $$;

drop function public.money_profit(date, date);
create function public.money_profit(p_from date, p_to date)
returns table (
  sku text, units_sold bigint, units_returned bigint, units_returned_paid bigint, gross_sales numeric, refunds numeric,
  commission numeric, fixed_fee numeric, collection_fee numeric, shipping_fee numeric, reverse_shipping_fee numeric,
  other_fees numeric, gst_on_fees numeric, tcs numeric, tds numeric, net_payout numeric, itc numeric,
  cost numeric, cost_missing boolean, orders bigint)
language plpgsql stable security invoker set search_path = '' as $$
begin
  perform private.money_guard();
  return query
  select d.sku::text, sum(d.units_sold)::bigint, sum(d.units_returned)::bigint, sum(d.units_returned_paid)::bigint,
         sum(d.gross_sales), sum(d.refunds),
         sum(d.commission), sum(d.fixed_fee), sum(d.collection_fee), sum(d.shipping_fee), sum(d.reverse_shipping_fee),
         sum(d.other_fees), sum(d.gst_on_fees), sum(d.tcs), sum(d.tds), sum(d.net), sum(d.itc),
         coalesce(sum((d.units_sold - d.units_returned_paid) * c.unit_cost), 0),
         coalesce(bool_or(c.unit_cost is null and (d.units_sold > 0 or d.units_returned_paid > 0)), false),
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
revoke all on function public.money_profit(date, date) from public, anon;
grant execute on function public.money_profit(date, date) to authenticated, service_role;

-- The fee % of the estimate is the fees (returns included) over the sales that were kept and paid.
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
    select d.sku, sum(d.sold_sales) as sold, sum(d.units_sold) as sold_units, sum(d.mp_fee + d.taxes) as fees
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
revoke all on function public.money_estimate(date, date) from public, anon;
grant execute on function public.money_estimate(date, date) to authenticated, service_role;

-- Empty the old numbers now; the job fills the summary again within a minute.
delete from public.money_sku_day;
select private.money_mark(null, null, true, false, true);
