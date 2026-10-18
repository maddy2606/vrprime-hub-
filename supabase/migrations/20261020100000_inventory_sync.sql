-- Live stock from the VR Prime Inventory API (the in-house barcode scanner software), every 15 minutes and on "Sync now".
-- It feeds the same table the uploaded inventory report does (inventory_stock), so Forecasting's days of cover use it with
-- no other change.
--
--   inventory_sync_state       one row: when the last sync was tried, when it last worked, and the last error
--   inventory_sync_save(rows)  the Edge Function's save (service role only): rows [{code, name, wid, pieces}]
--   request_inventory_sync()   the "Sync now" button (owner and admin)
--   cron 'inventory-sync'      every 15 minutes
--
-- The API login (VRPRIME_API_USERNAME and VRPRIME_API_PASSWORD) lives only in Supabase Edge Function secrets.

create table public.inventory_sync_state (
  id boolean primary key default true check (id),
  last_try_at timestamptz,
  last_ok_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 500),
  last_products integer,
  last_pieces bigint
);
insert into public.inventory_sync_state (id) values (true);

alter table public.inventory_sync_state enable row level security;
revoke all on public.inventory_sync_state from public, anon, authenticated;
grant select on public.inventory_sync_state to authenticated;
grant all on public.inventory_sync_state to service_role;
create policy inventory_sync_state_select on public.inventory_sync_state for select to authenticated
  using ((select private.is_staff()));

-- The save. Same checks as the report upload, no person involved, and one more: an answer with far fewer products than
-- the last one is refused, so a half-empty reply from the API can never wipe the stock.
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

  -- Every stock row now points at this upload, so older API snapshots are only history. Keep two days of them (and every
  -- uploaded report, whoever made it).
  delete from public.inventory_uploads where uploaded_by is null and file_name = 'VR Prime API' and uploaded_at < now() - interval '2 days' and id <> v_id;

  update public.inventory_sync_state
  set last_try_at = now(), last_ok_at = now(), last_error = null, last_products = v_products, last_pieces = v_pieces
  where id;

  return jsonb_build_object('products', v_products, 'pieces', v_pieces);
end $$;
revoke all on function public.inventory_sync_save(jsonb) from public, anon, authenticated;
grant execute on function public.inventory_sync_save(jsonb) to service_role;

-- A failed sync is remembered, so the page can say so. The stock keeps its last good numbers.
create or replace function public.inventory_sync_fail(p_error text) returns void
language sql security definer set search_path = '' as $$
  update public.inventory_sync_state set last_try_at = now(), last_error = left(coalesce(nullif(btrim(p_error), ''), 'unknown error'), 500) where id;
$$;
revoke all on function public.inventory_sync_fail(text) from public, anon, authenticated;
grant execute on function public.inventory_sync_fail(text) to service_role;

create or replace function private.start_inventory_sync() returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.inventory_sync_state set last_try_at = now() where id;
  perform private.call_function('inventory-sync', jsonb_build_object('job', 'sync'));
end $$;
revoke all on function private.start_inventory_sync() from public, anon, authenticated;

-- The "Sync now" button: owner and admin. Pressed twice in 20 seconds, the second press does nothing.
create or replace function public.request_inventory_sync() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not private.is_staff() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if exists (select 1 from public.inventory_sync_state where id and last_try_at > now() - interval '20 seconds') then
    return;
  end if;
  perform private.start_inventory_sync();
end $$;
revoke all on function public.request_inventory_sync() from public, anon;
grant execute on function public.request_inventory_sync() to authenticated;

select cron.schedule('inventory-sync', '*/15 * * * *', $$select private.start_inventory_sync()$$);
