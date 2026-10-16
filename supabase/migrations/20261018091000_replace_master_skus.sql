-- The owner's "Upload master SKU list" (Settings). The uploaded list REPLACES the mapping: SKUs not in it are
-- removed, new ones added, moved ones changed, and products left with no SKU are removed. Returns what changed.
-- Owner only; the whole replacement is one transaction, so a failed upload changes nothing.

create or replace function public.replace_master_skus(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_total integer;
  v_added integer;
  v_changed integer;
  v_removed integer;
  v_products integer;
  v_new_products integer;
begin
  if (select auth.uid()) is null or coalesce(private.user_role(), '') <> 'owner' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'the list is empty' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'the list has more than 5000 lines' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_rows) as x(master text, sku text)
             where coalesce(btrim(x.master), '') = '' or coalesce(btrim(x.sku), '') = ''
                or length(x.master) > 200 or length(x.sku) > 200) then
    raise exception 'every line needs a product name and a SKU (200 characters at most)' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_rows) as x(master text, sku text)
             group by x.sku having count(distinct btrim(x.master)) > 1) then
    raise exception 'a SKU is listed under two products' using errcode = '22023';
  end if;

  with n as (select distinct x.sku, btrim(x.master) as master from jsonb_to_recordset(p_rows) as x(master text, sku text))
  select count(*),
         count(*) filter (where s.channel_sku is null),
         count(*) filter (where s.channel_sku is not null and m.name <> n.master)
  into v_total, v_added, v_changed
  from n
  left join public.sku_master s on s.channel_sku = n.sku
  left join public.master_products m on m.id = s.master_id;

  select count(*) into v_removed from public.sku_master s
  where not exists (select 1 from jsonb_to_recordset(p_rows) as x(master text, sku text) where x.sku = s.channel_sku);

  insert into public.master_products (name)
  select distinct btrim(x.master) from jsonb_to_recordset(p_rows) as x(master text, sku text)
  on conflict (name) do nothing;
  get diagnostics v_new_products = row_count;

  delete from public.sku_master s
  where not exists (select 1 from jsonb_to_recordset(p_rows) as x(master text, sku text) where x.sku = s.channel_sku);

  insert into public.sku_master (channel_sku, master_id)
  select distinct x.sku, m.id
  from jsonb_to_recordset(p_rows) as x(master text, sku text)
  join public.master_products m on m.name = btrim(x.master)
  on conflict (channel_sku) do update set master_id = excluded.master_id, updated_at = now()
  where public.sku_master.master_id is distinct from excluded.master_id;

  delete from public.master_products m
  where not exists (select 1 from public.sku_master s where s.master_id = m.id);

  select count(*) into v_products from public.master_products;

  return jsonb_build_object('rows', v_total, 'added', v_added, 'changed', v_changed, 'removed', v_removed,
                            'unchanged', v_total - v_added - v_changed, 'products', v_products, 'new_products', v_new_products);
end $$;

revoke all on function public.replace_master_skus(jsonb) from public, anon;
grant execute on function public.replace_master_skus(jsonb) to authenticated;
