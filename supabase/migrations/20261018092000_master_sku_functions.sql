-- Master SKU management functions (the Master SKUs tab). Owner and admin may link, unlink, remove and import;
-- only the owner may REPLACE the whole list (replace_master_skus). Every function checks the caller itself.
--
--   master_link_sku(sku, master, units)  link a Flipkart SKU to a product (or move it / change its units); a removed
--                                        SKU that is linked comes back into the checks
--   master_unlink_sku(sku)               unlink: the SKU goes back to "Not linked yet"
--   master_exclude_sku(sku)              "Remove": out of the checks and lists (and unlinked)
--   master_restore_sku(sku)              put a removed SKU back ("Not linked yet", or its product if still linked)
--   master_import(rows)                  merge products (code, name) and optional links (sku, units) from Excel/CSV;
--                                        nothing is removed
--   replace_master_skus(rows)            owner: the list REPLACES the mapping (now with units and codes)

create or replace function private.require_master_editor() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or coalesce(private.user_role(), '') not in ('owner', 'admin') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
end $$;

create or replace function private.check_master_sku(p_sku text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_sku is null or btrim(p_sku) = '' or length(p_sku) > 200 then
    raise exception 'a SKU must be 1 to 200 characters' using errcode = '22023';
  end if;
end $$;

create or replace function public.master_link_sku(p_sku text, p_master uuid, p_units integer default 1) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_master_editor();
  perform private.check_master_sku(p_sku);
  if p_units is null or p_units < 1 or p_units > 1000 then
    raise exception 'units per order must be 1 to 1000' using errcode = '22023';
  end if;
  if not exists (select 1 from public.master_products where id = p_master) then
    raise exception 'that master SKU does not exist' using errcode = '22023';
  end if;
  insert into public.sku_master (channel_sku, master_id, units_per_order) values (p_sku, p_master, p_units)
  on conflict (channel_sku) do update set master_id = excluded.master_id, units_per_order = excluded.units_per_order, updated_at = now();
  delete from public.sku_excluded where channel_sku = p_sku;
end $$;

create or replace function public.master_unlink_sku(p_sku text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_master_editor();
  delete from public.sku_master where channel_sku = p_sku;
end $$;

create or replace function public.master_exclude_sku(p_sku text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_master_editor();
  perform private.check_master_sku(p_sku);
  insert into public.sku_excluded (channel_sku, excluded_by) values (p_sku, (select auth.uid()))
  on conflict (channel_sku) do nothing;
  delete from public.sku_master where channel_sku = p_sku;
end $$;

create or replace function public.master_restore_sku(p_sku text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_master_editor();
  delete from public.sku_excluded where channel_sku = p_sku;
end $$;

-- Merge from Excel or CSV. Each row: name (required), code (optional), sku and units (optional). A product is found
-- by its code first, then its name; a new code or name fills in what is missing. Links are added or changed, never
-- removed. Returns what changed.
create or replace function public.master_import(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_id uuid;
  v_code text;
  v_name text;
  v_units integer;
  v_old public.sku_master;
  v_products_added integer := 0;
  v_products_updated integer := 0;
  v_links_added integer := 0;
  v_links_changed integer := 0;
begin
  perform private.require_master_editor();
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'the list is empty' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'the list has more than 5000 lines' using errcode = '22023';
  end if;

  for r in select * from jsonb_to_recordset(p_rows) as x(code text, name text, sku text, units integer) loop
    v_name := nullif(btrim(coalesce(r.name, '')), '');
    v_code := nullif(btrim(coalesce(r.code, '')), '');
    if v_name is null and v_code is null then
      raise exception 'every line needs a master SKU code or name' using errcode = '22023';
    end if;
    if length(coalesce(v_name, '')) > 200 or length(coalesce(v_code, '')) > 60 then
      raise exception 'a name is 200 characters at most and a code 60' using errcode = '22023';
    end if;

    v_id := null;
    if v_code is not null then
      select id into v_id from public.master_products where code = v_code;
    end if;
    if v_id is null and v_name is not null then
      select id into v_id from public.master_products where name = v_name;
    end if;

    if v_id is null then
      if v_name is null then
        raise exception 'master SKU % is new, so it needs a name', v_code using errcode = '22023';
      end if;
      insert into public.master_products (code, name) values (v_code, v_name) returning id into v_id;
      v_products_added := v_products_added + 1;
    else
      update public.master_products m
      set code = coalesce(v_code, m.code), name = coalesce(v_name, m.name)
      where m.id = v_id and (m.code is distinct from coalesce(v_code, m.code) or m.name is distinct from coalesce(v_name, m.name));
      if found then
        v_products_updated := v_products_updated + 1;
      end if;
    end if;

    if r.sku is not null and btrim(r.sku) <> '' then
      perform private.check_master_sku(r.sku);
      v_units := coalesce(r.units, 1);
      if v_units < 1 or v_units > 1000 then
        raise exception 'units per order must be 1 to 1000 (SKU %)', r.sku using errcode = '22023';
      end if;
      select * into v_old from public.sku_master where channel_sku = r.sku;
      if not found then
        v_links_added := v_links_added + 1;
      elsif v_old.master_id <> v_id or v_old.units_per_order <> v_units then
        v_links_changed := v_links_changed + 1;
      end if;
      insert into public.sku_master (channel_sku, master_id, units_per_order) values (r.sku, v_id, v_units)
      on conflict (channel_sku) do update set master_id = excluded.master_id, units_per_order = excluded.units_per_order, updated_at = now()
      where public.sku_master.master_id is distinct from excluded.master_id or public.sku_master.units_per_order is distinct from excluded.units_per_order;
      delete from public.sku_excluded where channel_sku = r.sku;
    end if;
  end loop;

  return jsonb_build_object('products_added', v_products_added, 'products_updated', v_products_updated,
                            'links_added', v_links_added, 'links_changed', v_links_changed,
                            'products', (select count(*) from public.master_products), 'links', (select count(*) from public.sku_master));
end $$;

-- Owner: the uploaded list REPLACES the mapping. Rows: master (name), sku, and optional units and code. SKUs not in the
-- list are unlinked, products left with no SKU are removed, codes are set where given.
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
  where not exists (select 1 from public.sku_master s where s.master_id = m.id);

  select count(*) into v_products from public.master_products;

  return jsonb_build_object('rows', v_total, 'added', v_added, 'changed', v_changed, 'removed', v_removed,
                            'unchanged', v_total - v_added - v_changed, 'products', v_products);
end $$;

revoke all on function private.require_master_editor() from public, anon, authenticated;
revoke all on function private.check_master_sku(text) from public, anon, authenticated;
revoke all on function public.master_link_sku(text, uuid, integer) from public, anon;
revoke all on function public.master_unlink_sku(text) from public, anon;
revoke all on function public.master_exclude_sku(text) from public, anon;
revoke all on function public.master_restore_sku(text) from public, anon;
revoke all on function public.master_import(jsonb) from public, anon;
revoke all on function public.replace_master_skus(jsonb) from public, anon;
grant execute on function public.master_link_sku(text, uuid, integer) to authenticated;
grant execute on function public.master_unlink_sku(text) to authenticated;
grant execute on function public.master_exclude_sku(text) to authenticated;
grant execute on function public.master_restore_sku(text) to authenticated;
grant execute on function public.master_import(jsonb) to authenticated;
grant execute on function public.replace_master_skus(jsonb) to authenticated;
