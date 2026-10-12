-- How many parts a run has, readable by the app (the plan itself is not), so the screen can show progress.
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'order_runs' and column_name = 'parts') then
    alter table public.order_runs add column parts integer generated always as (jsonb_array_length(plan)) stored;
  end if;
end $$;
grant select (parts) on public.order_runs to authenticated;
