-- 14 Nov 2026. Already applied to the live database (version 20261114173039). Safe to run twice.
-- The pnl-cache job (private.refresh_pnl_cache) took 9 s on average, up to 30 s, every 10 minutes: the heaviest regular
-- load on this small database. The cached answers stay valid for 30 minutes, so every 20 minutes is enough and halves
-- that load. Nothing else changes.
-- Undo: select cron.schedule('pnl-cache', '*/10 * * * *', 'select private.refresh_pnl_cache()');
select cron.schedule('pnl-cache', '*/20 * * * *', 'select private.refresh_pnl_cache()');
