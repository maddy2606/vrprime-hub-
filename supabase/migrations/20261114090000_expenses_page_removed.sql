-- The Expenses page was removed (owner's request, 14 Nov 2026). Stop the jobs that only fed it: the twice-daily WhatsApp
-- fetch and its hourly "not being fetched" alert. The expenses, budgets and WhatsApp tables are kept as they are.
select cron.unschedule(jobname) from cron.job where jobname in ('whatsapp-auto-fetch', 'alerts-whatsapp');
