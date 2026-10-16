-- Upload CSV (replace_master_skus) used to remove every product left with no Flipkart SKU. Kits changed that: a kit's
-- parts (e.g. Berry Car Perfume inside the Car Perfume combo) often have no Flipkart SKU of their own, and a kit may
-- have none either. Products that are a kit, or a part of one, are now kept. Everything else is unchanged.
--
-- Contains DELETE statements: paste this file in the Supabase SQL editor (the MCP apply stalls on deletes).

-- Owner: the uploaded list REPLACES the mapping. Rows: master (name), sku, and optional units and code. SKUs not in the
-- list are unlinked, products left with no SKU are removed (unless a kit or a part of one), codes are set where given.
create or replace function public.replace_master_skus(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_total integer;
  v_added integer;
  v_changed integer;
  v_removed integer;
  v_products integer;
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
  if exists (select 1 from jsonb_to_recordset(p_rows) as x(master text, sku text, units integer, code text)
             where coalesce(btrim(x.master), '') = '' or coalesce(btrim(x.sku), '') = ''
                or length(x.master) > 200 or length(x.sku) > 200 or length(coalesce(x.code, '')) > 60
                or coalesce(x.units, 1) not between 1 and 1000) then
    raise exception 'every line needs a product name and a SKU (200 characters at most) and units 1 to 1000' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_rows) as x(master text, sku text)
             group by x.sku having count(distinct btrim(x.master)) > 1) then
    raise exception 'a SKU is listed under two products' using errcode = '22023';
  end if;

  with n as (
    select distinct on (x.sku) x.sku, btrim(x.master) as master, coalesce(x.units, 1) as units
    from jsonb_to_recordset(p_rows) as x(master text, sku text, units integer)
    order by x.sku
  )
  select count(*),
         count(*) filter (where s.channel_sku is null),
         count(*) filter (where s.channel_sku is not null and (m.name <> n.master or s.units_per_order <> n.units))
  into v_total, v_added, v_changed
  from n
  left join public.sku_master s on s.channel_sku = n.sku
  left join public.master_products m on m.id = s.master_id;

  select count(*) into v_removed from public.sku_master s
  where not exists (select 1 from jsonb_to_recordset(p_rows) as x(master text, sku text) where x.sku = s.channel_sku);

  insert into public.master_products (name)
  select distinct btrim(x.master) from jsonb_to_recordset(p_rows) as x(master text, sku text)
  on conflict (name) do nothing;

  update public.master_products m
  set code = c.code
  from (select distinct on (btrim(x.master)) btrim(x.master) as master, btrim(x.code) as code
        from jsonb_to_recordset(p_rows) as x(master text, code text)
        where coalesce(btrim(x.code), '') <> ''
        order by btrim(x.master)) c
  where m.name = c.master and m.code is distinct from c.code
    and not exists (select 1 from public.master_products o where o.code = c.code and o.id <> m.id);

  delete from public.sku_master s
  where not exists (select 1 from jsonb_to_recordset(p_rows) as x(master text, sku text) where x.sku = s.channel_sku);

  insert into public.sku_master (channel_sku, master_id, units_per_order)
  select distinct on (x.sku) x.sku, m.id, coalesce(x.units, 1)
  from jsonb_to_recordset(p_rows) as x(master text, sku text, units integer)
  join public.master_products m on m.name = btrim(x.master)
  order by x.sku
  on conflict (channel_sku) do update set master_id = excluded.master_id, units_per_order = excluded.units_per_order, updated_at = now()
  where public.sku_master.master_id is distinct from excluded.master_id
     or public.sku_master.units_per_order is distinct from excluded.units_per_order;

  delete from public.sku_excluded e
  where exists (select 1 from jsonb_to_recordset(p_rows) as x(master text, sku text) where x.sku = e.channel_sku);

  delete from public.master_products m
  where not exists (select 1 from public.sku_master s where s.master_id = m.id)
    and jsonb_array_length(m.kit_parts) = 0
    and not exists (select 1 from public.master_products k, jsonb_array_elements(k.kit_parts) e where (e ->> 'part') = m.id::text);

  select count(*) into v_products from public.master_products;

  return jsonb_build_object('rows', v_total, 'added', v_added, 'changed', v_changed, 'removed', v_removed,
                            'unchanged', v_total - v_added - v_changed, 'products', v_products);
end $$;

revoke all on function public.replace_master_skus(jsonb) from public, anon;
grant execute on function public.replace_master_skus(jsonb) to authenticated;
