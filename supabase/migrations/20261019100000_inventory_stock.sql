-- Inventory stock from the VR Prime inventory report (inventory.vrprime.in → Reports → .xlsx), uploaded on the
-- Forecasting tab. Forecasting uses it instead of Flipkart's stock: one number per product and warehouse, in pieces.
--
--   inventory_uploads  one row per upload; the newest is the stock in use
--   inventory_stock    pieces per report product (its code and name) and warehouse, from the newest upload; products
--                      missing from a later upload are set to 0 (never deleted, so no DELETE is needed)
--   inventory_upload(file, month, rows)  owner and admin; rows [{code, name, wid, pieces}]
--
-- Staff read everything; a warehouse user reads only their own warehouses' stock.

create table public.inventory_uploads (
  id uuid primary key default gen_random_uuid(),
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid references public.profiles (id) on delete set null,
  file_name text not null check (length(file_name) between 1 and 300),
  report_month text check (report_month is null or length(report_month) <= 20),
  products integer not null check (products >= 0),
  pieces bigint not null check (pieces >= 0)
);
create index inventory_uploads_by_idx on public.inventory_uploads (uploaded_by);
create index inventory_uploads_at_idx on public.inventory_uploads (uploaded_at desc);

create table public.inventory_stock (
  code text not null check (length(btrim(code)) between 1 and 100),
  warehouse_id uuid not null references public.warehouses (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 200),
  pieces integer not null check (pieces >= 0),
  upload_id uuid not null references public.inventory_uploads (id) on delete cascade,
  primary key (code, warehouse_id)
);
create index inventory_stock_warehouse_idx on public.inventory_stock (warehouse_id);
create index inventory_stock_upload_idx on public.inventory_stock (upload_id);

alter table public.inventory_uploads enable row level security;
alter table public.inventory_stock enable row level security;
revoke all on public.inventory_uploads, public.inventory_stock from anon, authenticated;
grant select on public.inventory_uploads, public.inventory_stock to authenticated;
grant all on public.inventory_uploads, public.inventory_stock to service_role;

create policy inventory_uploads_select on public.inventory_uploads for select to authenticated
  using ((select private.user_role()) is not null);

create policy inventory_stock_select on public.inventory_stock for select to authenticated
  using (
    (select private.is_staff())
    or ((select private.user_role()) = 'warehouse'
        and warehouse_id in (select uw.warehouse_id from public.user_warehouses uw
                             where uw.user_id = (select auth.uid())))
  );

create or replace function public.inventory_upload(p_file text, p_month text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_products integer;
  v_pieces bigint;
begin
  perform private.require_master_editor();
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'the report has no products' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 20000 then
    raise exception 'the report has too many lines' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_rows) as x(code text, name text, wid uuid, pieces integer)
             where coalesce(btrim(x.code), '') = '' or length(x.code) > 100
                or coalesce(btrim(x.name), '') = '' or length(x.name) > 200
                or x.wid is null or x.pieces is null or x.pieces < 0) then
    raise exception 'every line needs a product code, a name, a warehouse and pieces of 0 or more' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_rows) as x(wid uuid)
             where not exists (select 1 from public.warehouses w where w.id = x.wid)) then
    raise exception 'a warehouse in the report is not in the app' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_rows) as x(code text, wid uuid) group by btrim(x.code), x.wid having count(*) > 1) then
    raise exception 'a product is in the report twice' using errcode = '22023';
  end if;

  select count(distinct btrim(x.code)), coalesce(sum(x.pieces), 0) into v_products, v_pieces
  from jsonb_to_recordset(p_rows) as x(code text, pieces integer);

  insert into public.inventory_uploads (uploaded_by, file_name, report_month, products, pieces)
  values ((select auth.uid()), left(coalesce(nullif(btrim(p_file), ''), 'inventory report'), 300), left(nullif(btrim(p_month), ''), 20), v_products, v_pieces)
  returning id into v_id;

  insert into public.inventory_stock (code, warehouse_id, name, pieces, upload_id)
  select btrim(x.code), x.wid, btrim(x.name), x.pieces, v_id
  from jsonb_to_recordset(p_rows) as x(code text, name text, wid uuid, pieces integer)
  on conflict (code, warehouse_id) do update set name = excluded.name, pieces = excluded.pieces, upload_id = excluded.upload_id;

  update public.inventory_stock set pieces = 0, upload_id = v_id where upload_id <> v_id;

  return jsonb_build_object('products', v_products, 'pieces', v_pieces);
end $$;

revoke all on function public.inventory_upload(text, text, jsonb) from public, anon;
grant execute on function public.inventory_upload(text, text, jsonb) to authenticated;
