-- Phase 4: the schedule for the order syncs. Applied after the Edge Function orders-sync is deployed,
-- so no run is started before there is something to answer it.

-- ---------------------------------------------------------------------------
-- Schedule (all UTC; IST is UTC+5:30)
--   orders-pending-a   every hour at :30 UTC, 01:30-16:30  = 07:00, 08:00 ... 22:00 IST
--   orders-pending-b   every hour at :00 UTC, 02:00-16:00  = 07:30, 08:30 ... 21:30 IST
--   orders-daily       03:40 UTC = 09:10 IST (after the 08:00 stock sync): shipped, cancelled, returns
--   orders-backfill    16:45 UTC = 22:15 IST, every night until the 30-day backfill is done
--   orders-watchdog    every 5 minutes
-- ---------------------------------------------------------------------------

select cron.unschedule(jobname) from cron.job
where jobname in ('orders-pending-a', 'orders-pending-b', 'orders-daily', 'orders-backfill', 'orders-watchdog');

select cron.schedule('orders-pending-a', '30 1-16 * * *', $$select private.start_order_run('pending', 'cron', null)$$);
select cron.schedule('orders-pending-b', '0 2-16 * * *', $$select private.start_order_run('pending', 'cron', null)$$);
select cron.schedule('orders-daily', '40 3 * * *', $$select private.start_order_run('daily', 'cron', null)$$);
select cron.schedule('orders-backfill', '45 16 * * *', $$select private.start_order_backfill()$$);
select cron.schedule('orders-watchdog', '*/5 * * * *', $$select private.resume_stalled_orders()$$);
