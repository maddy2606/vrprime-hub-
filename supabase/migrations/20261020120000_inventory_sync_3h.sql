-- The live stock sync from the VR Prime Inventory API runs every 3 hours (it was every 15 minutes). "Sync now" still works any time.
select cron.unschedule('inventory-sync') where exists (select 1 from cron.job where jobname = 'inventory-sync');
select cron.schedule('inventory-sync', '0 */3 * * *', $$select private.start_inventory_sync()$$);
