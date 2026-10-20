-- P&L page: each SKU's real Flipkart fee rate, from the uploaded Profit and Loss Reports (money_pnl_orders, Flipkart's
-- own figures per order item): its total expenses (commission, fixed, collection, pick and pack, shipping, reverse
-- shipping and GST on them, as Flipkart adds them up) against its accounted sales. The page applies the rate to the
-- SKU's sales; SKUs with no report data keep the default estimate.

create or replace function public.pnl_fee_rates()
returns table (sku text, items bigint, sales numeric, expenses numeric, first_day date, last_day date)
language plpgsql stable security invoker set search_path = '' as $$
begin
  perform private.money_guard();
  return query
  select p.sku, count(*)::bigint, coalesce(sum(p.accounted_sales), 0), coalesce(sum(p.total_expenses), 0), min(p.order_date), max(p.order_date)
  from public.money_pnl_orders p
  where p.sku is not null and coalesce(p.accounted_sales, 0) > 0
  group by p.sku;
end $$;
revoke all on function public.pnl_fee_rates() from public, anon;
grant execute on function public.pnl_fee_rates() to authenticated, service_role;
