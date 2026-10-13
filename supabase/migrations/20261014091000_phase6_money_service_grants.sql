-- The import script runs as the service role (never in a browser): give it the same table access the owner has.
grant select, insert, update, delete on public.money_uploads, public.money_payments, public.money_settled_lines,
  public.money_other_lines, public.money_pnl_orders, public.sku_costs to service_role;
grant usage on all sequences in schema public to service_role;
