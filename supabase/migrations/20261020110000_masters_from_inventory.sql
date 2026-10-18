-- The master SKUs are the VR Prime inventory products. Each live stock sync adds a master for every product VR Prime lists
-- (its code and name), so the Master SKUs tab always offers exactly what the inventory software has, and a Flipkart SKU is
-- linked to one of them by hand (with the units one order uses). Stock then needs no matching: the master's code is the
-- inventory product's code.
--
-- Nothing is ever removed here: a product that disappears from VR Prime keeps its master and its links. A name that is already
-- taken by another product gets its code added, so the unique name rule never stops a sync.

create or replace function public.inventory_sync_save(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_products integer;
  v_pieces bigint;
  v_before integer;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'the API returned no products' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 20000 then
    raise exception 'the API returned too many lines' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_rows) as x(code text, name text, wid uuid, pieces integer)
             where coalesce(btrim(x.code), '') = '' or length(x.code) > 100
                or coalesce(btrim(x.name), '') = '' or length(x.name) > 200
                or x.wid is null or x.pieces is null or x.pieces < 0) then
    raise exception 'every line needs a product code, a name, a warehouse and pieces of 0 or more' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_rows) as x(wid uuid)
             where not exists (select 1 from public.warehouses w where w.id = x.wid)) then
    raise exception 'a warehouse in the answer is not in the app' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_rows) as x(code text, wid uuid) group by btrim(x.code), x.wid having count(*) > 1) then
    raise exception 'a product is in the answer twice' using errcode = '22023';
  end if;

  select count(distinct btrim(x.code)), coalesce(sum(x.pieces), 0) into v_products, v_pieces
  from jsonb_to_recordset(p_rows) as x(code text, pieces integer);

  select products into v_before from public.inventory_uploads order by uploaded_at desc limit 1;
  if v_before is not null and v_before >= 10 and v_products * 2 < v_before then
    raise exception 'the API listed % products, far fewer than the % before; not saved', v_products, v_before using errcode = '22023';
  end if;

  insert into public.inventory_uploads (uploaded_by, file_name, report_month, products, pieces)
  values (null, 'VR Prime API', to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM'), v_products, v_pieces)
  returning id into v_id;

  insert into public.inventory_stock (code, warehouse_id, name, pieces, upload_id)
  select btrim(x.code), x.wid, btrim(x.name), x.pieces, v_id
  from jsonb_to_recordset(p_rows) as x(code text, name text, wid uuid, pieces integer)
  on conflict (code, warehouse_id) do update set name = excluded.name, pieces = excluded.pieces, upload_id = excluded.upload_id;

  update public.inventory_stock set pieces = 0, upload_id = v_id where upload_id <> v_id;

  -- A master for every product VR Prime lists (codes longer than a master's 60 are left out). The name is VR Prime's; when
  -- another product already uses it, the code is added so both fit.
  insert into public.master_products (name, code)
  select left(case when d.same_name > 1 or exists (select 1 from public.master_products m where m.name = d.name and m.code is distinct from d.code)
                   then d.name || ' (' || d.code || ')' else d.name end, 200),
         d.code
  from (
    select btrim(x.code) as code, min(btrim(x.name)) as name,
           count(*) over (partition by min(btrim(x.name))) as same_name
    from jsonb_to_recordset(p_rows) as x(code text, name text)
    where length(btrim(x.code)) between 1 and 60
    group by btrim(x.code)
  ) d
  on conflict (code) do update set name = excluded.name;

  delete from public.inventory_uploads where uploaded_by is null and file_name = 'VR Prime API' and uploaded_at < now() - interval '2 days' and id <> v_id;

  update public.inventory_sync_state
  set last_try_at = now(), last_ok_at = now(), last_error = null, last_products = v_products, last_pieces = v_pieces
  where id;

  return jsonb_build_object('products', v_products, 'pieces', v_pieces);
end $$;
revoke all on function public.inventory_sync_save(jsonb) from public, anon, authenticated;
grant execute on function public.inventory_sync_save(jsonb) to service_role;
