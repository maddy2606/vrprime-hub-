-- Remote people: office staff who work from home. They are on the Team page for attendance only. They belong to no
-- warehouse, so no capacity sum, warehouse card, suggestion or capacity alert counts them (all of those group or join
-- people by warehouse_id, and a remote person has none).

alter table public.staff alter column warehouse_id drop not null;
alter table public.staff add column remote boolean not null default false;
alter table public.staff add constraint staff_remote_has_no_warehouse check (remote = (warehouse_id is null));

-- unique (warehouse_id, name) does not stop two remote people with the same name (nulls never clash), so this does.
create unique index staff_remote_name_key on public.staff (name) where remote;
