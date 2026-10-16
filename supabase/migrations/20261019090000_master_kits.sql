-- Kits (combos): a master SKU made of other master SKUs, e.g. "Car Perfume" = 1 Berry Car Perfume + 1 Musk Car Perfume.
-- Forecasting shows a kit's stock as its own stock plus how many it can make from its parts' stock: the smallest of
-- (part stock / part quantity).
--
--   master_products.kit_parts  [{"part": "<master_products.id>", "qty": 1..1000}, ...]; empty = not a kit
--   master_set_kit(master, parts)  owner and admin; an empty list turns the kit off
--
-- One level only: a part cannot itself be a kit, and a kit cannot be a part of another kit.

alter table public.master_products
  add column kit_parts jsonb not null default '[]'::jsonb check (jsonb_typeof(kit_parts) = 'array' and jsonb_array_length(kit_parts) <= 20);

create or replace function public.master_set_kit(p_master uuid, p_parts jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_clean jsonb := '[]'::jsonb;
  v_seen uuid[] := '{}';
begin
  perform private.require_master_editor();
  if not exists (select 1 from public.master_products where id = p_master) then
    raise exception 'that master SKU does not exist' using errcode = '22023';
  end if;
  if p_parts is null or jsonb_typeof(p_parts) <> 'array' or jsonb_array_length(p_parts) > 20 then
    raise exception 'a kit has at most 20 parts' using errcode = '22023';
  end if;
  if jsonb_array_length(p_parts) > 0 and exists (
    select 1 from public.master_products k, jsonb_array_elements(k.kit_parts) e
    where k.id <> p_master and (e ->> 'part') = p_master::text
  ) then
    raise exception 'this master SKU is a part of another kit, so it cannot be a kit itself' using errcode = '22023';
  end if;
  for r in select e from jsonb_array_elements(p_parts) e loop
    if jsonb_typeof(r.e) <> 'object' or (r.e ->> 'part') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or jsonb_typeof(r.e -> 'qty') <> 'number' or (r.e ->> 'qty')::numeric not between 1 and 1000 or (r.e ->> 'qty')::numeric <> trunc((r.e ->> 'qty')::numeric) then
      raise exception 'each part needs a master SKU and a quantity from 1 to 1000' using errcode = '22023';
    end if;
    if (r.e ->> 'part')::uuid = p_master then
      raise exception 'a kit cannot be a part of itself' using errcode = '22023';
    end if;
    if (r.e ->> 'part')::uuid = any (v_seen) then
      raise exception 'a part is in the kit twice' using errcode = '22023';
    end if;
    if not exists (select 1 from public.master_products where id = (r.e ->> 'part')::uuid) then
      raise exception 'a part does not exist' using errcode = '22023';
    end if;
    if exists (select 1 from public.master_products where id = (r.e ->> 'part')::uuid and jsonb_array_length(kit_parts) > 0) then
      raise exception 'a part is a kit itself; kits cannot be nested' using errcode = '22023';
    end if;
    v_seen := v_seen || (r.e ->> 'part')::uuid;
    v_clean := v_clean || jsonb_build_object('part', r.e ->> 'part', 'qty', (r.e ->> 'qty')::integer);
  end loop;
  update public.master_products set kit_parts = v_clean where id = p_master;
end $$;

revoke all on function public.master_set_kit(uuid, jsonb) from public, anon;
grant execute on function public.master_set_kit(uuid, jsonb) to authenticated;
