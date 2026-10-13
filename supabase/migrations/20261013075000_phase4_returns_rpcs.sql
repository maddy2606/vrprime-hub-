-- Performance: the Returns tab reads a page of returns at a time, and the totals, from the database.
-- Runs as the caller (security invoker): a warehouse user only gets their own warehouses' returns.

-- Totals for the last 30 days: units and lines, courier and customer apart.
create or replace function public.flipkart_returns_summary(p_wh uuid default null) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with t as (select (now() at time zone 'Asia/Kolkata')::date as today)
  select jsonb_build_object(
    'courier_units', coalesce(sum(r.quantity) filter (where r.source = 'courier_return'), 0),
    'customer_units', coalesce(sum(r.quantity) filter (where r.source = 'customer_return'), 0),
    'courier_lines', count(*) filter (where r.source = 'courier_return'),
    'customer_lines', count(*) filter (where r.source = 'customer_return'))
  from public.fk_returns r, t
  where r.platform = 'flipkart' and r.created_date > t.today - 30 and (p_wh is null or r.warehouse_id = p_wh)
$$;
revoke all on function public.flipkart_returns_summary(uuid) from public, anon;
grant execute on function public.flipkart_returns_summary(uuid) to authenticated, service_role;

create or replace function public.flipkart_returns_page(
  p_wh uuid default null, p_source text default null, p_q text default null,
  p_sort text default 'date', p_dir text default 'desc', p_limit integer default 50, p_offset integer default 0
) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_pat text := case when coalesce(btrim(p_q), '') = '' then null
                     else '%' || replace(replace(replace(btrim(p_q), '\', '\'), '%', '\%'), '_', '\_') || '%' end;
  v_col text := case p_sort when 'sku' then 'sku' when 'type' then 'source' when 'reason' then 'reason' when 'qty' then 'quantity'
                            when 'status' then 'return_status' when 'order' then 'order_id' else 'created_date' end;
  v_dir text := case when lower(p_dir) = 'asc' then 'asc' else 'desc' end;
  v_result jsonb;
begin
  execute format($q$
    with base as (
      select r.* from public.fk_returns r
      where r.platform = 'flipkart' and r.created_date > (now() at time zone 'Asia/Kolkata')::date - 30
        and ($1 is null or r.warehouse_id = $1)
        and ($2 is null or r.source = $2)
        and ($3 is null or r.sku ilike $3 or r.order_id ilike $3 or r.order_item_id ilike $3 or r.reason ilike $3 or r.sub_reason ilike $3)
    )
    select jsonb_build_object(
      'total', (select count(*) from base),
      'rows', coalesce((
        select jsonb_agg(to_jsonb(x)) from (
          select b.return_id, b.order_item_id, b.order_id, b.sku, b.quantity, b.warehouse_id, b.source, b.return_status, b.reason, b.sub_reason, b.created_date
          from base b order by b.%I %s nulls last, b.return_id, b.order_item_id
          limit %s offset %s
        ) x), '[]'::jsonb))
  $q$, v_col, v_dir, greatest(least(p_limit, 200), 1), greatest(p_offset, 0))
  into v_result using p_wh, p_source, v_pat;
  return v_result;
end $$;
revoke all on function public.flipkart_returns_page(uuid, text, text, text, text, integer, integer) from public, anon;
grant execute on function public.flipkart_returns_page(uuid, text, text, text, text, integer, integer) to authenticated, service_role;
