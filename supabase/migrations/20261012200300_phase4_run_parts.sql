-- How many parts a run has, readable by the app (the plan itself is not), so the screen can show progress.
alter table public.order_runs add column parts integer generated always as (jsonb_array_length(plan)) stored;
grant select (parts) on public.order_runs to authenticated;
