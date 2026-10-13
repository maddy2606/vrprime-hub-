-- "sku is not distinct from" cannot use the SKU index; ask for a SKU with "=" (and for no SKU with "is null").
create or replace function public.money_sku_lines(p_sku text, p_from date, p_to date, p_limit integer default 100, p_offset integer default 0)
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_total bigint;
  v_rows jsonb;
  v_none boolean := (p_sku = '(no SKU)');
begin
  perform private.money_guard();
  select count(*) into v_total
  from public.money_settled_lines l
  where l.payment_date between p_from and p_to and ((v_none and l.sku is null) or (not v_none and l.sku = p_sku));

  select coalesce(jsonb_agg(to_jsonb(x) order by x.payment_date desc, x.order_item_id), '[]'::jsonb) into v_rows
  from (
    select l.order_item_id, l.order_id, l.payment_date, l.order_date, l.qty, l.sale_amount, l.refund, l.commission,
           l.fixed_fee, l.collection_fee, l.shipping_fee, l.reverse_shipping_fee, l.pick_pack_fee + l.other_fees as other_fees,
           l.gst_on_fees, l.tcs, l.tds, l.net, l.itc_gst_tcs + l.itc_tds as itc, l.return_type,
           private.money_unit_cost(l.sku, coalesce(l.order_date, l.payment_date)) as unit_cost
    from public.money_settled_lines l
    where l.payment_date between p_from and p_to and ((v_none and l.sku is null) or (not v_none and l.sku = p_sku))
    order by l.payment_date desc, l.order_item_id
    limit greatest(least(p_limit, 500), 1) offset greatest(p_offset, 0)
  ) x;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;
revoke all on function public.money_sku_lines(text, date, date, integer, integer) from public, anon;
grant execute on function public.money_sku_lines(text, date, date, integer, integer) to authenticated, service_role;
