-- 14 Nov 2026. Two small changes; neither touches business data.
-- Already applied to the live database on 14 Nov 2026 (version 20261114162252). Safe to run twice.
--
-- 1. team_order_load (the Command Deck's and the Team page's "order load") timed out 33 times in a week
--    ("canceling statement due to statement timeout"). Its "placed" half read every order row of the last 15 to 35 days
--    from the table itself (16,500 pages for 15 days). This index holds the five columns it needs, so the answer now comes
--    from the index alone: 35 days went from 1.4 s to 0.24 s, measured on the live database.
--    Undo: drop index if exists public.fk_order_items_day_load_idx;
create index if not exists fk_order_items_day_load_idx
  on public.fk_order_items (order_day) include (platform, stage, warehouse_id, order_id);

-- 2. cron.job_run_details (one row per scheduled-job run) was never trimmed: 62,000 rows and 10 MB in a month.
--    Keep 7 days. Only this run log is deleted, nothing else.
--    Undo: select cron.unschedule('cron-log-cleanup');
select cron.schedule('cron-log-cleanup', '50 20 * * *', $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$);
delete from cron.job_run_details where end_time < now() - interval '7 days';

-- Also done by hand the same evening, with no schema change (so nothing to replay here):
--   reindex table concurrently public.fk_order_items;   -- indexes 108 MB -> 33 MB
--   reindex table concurrently public.stock_levels;
--   reindex table concurrently public.fk_returns;
-- The whole database went from 264 MB to about 200 MB. Repeat when the indexes swell again.
