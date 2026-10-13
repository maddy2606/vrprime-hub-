-- The free database plan is 500 MB and goes read-only when full, which would stop the whole app, not just Money.
-- A month of settlements is about 140 MB, so an upload is refused while the database is above 430 MB.
create or replace function public.money_begin_upload(p_kind text, p_filename text) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
  v_mb numeric := pg_database_size(current_database()) / 1048576.0;
begin
  perform private.money_guard();
  if v_mb > 430 then
    raise exception 'The database is nearly full (% MB of 500 MB). Lower "months to keep" in Settings or upgrade the plan before uploading more.', round(v_mb)
      using errcode = '53100';
  end if;
  insert into public.money_uploads (kind, filename, uploaded_by)
  values (p_kind, left(p_filename, 300), (select auth.uid()))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.money_begin_upload(text, text) from public, anon;
grant execute on function public.money_begin_upload(text, text) to authenticated, service_role;
