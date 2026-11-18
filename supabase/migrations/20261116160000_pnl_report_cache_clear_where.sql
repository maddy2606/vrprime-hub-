-- 16 Nov 2026. Uploading Flipkart's P&L report from the P&L page failed with
-- "Saving failed (money_add_pnl): UPDATE requires a WHERE clause".
-- The statement trigger on money_pnl_orders (20261112120000_speed_report_cache.sql) clears the report cache with an
-- UPDATE that has no WHERE. Supabase's safeupdate refuses that for calls through the API (the website), so no P&L report
-- could be uploaded from the site since 12 Nov. Uploads through the SQL editor or the CLI were not affected.
-- Same behaviour, with a WHERE that matches every row.
create or replace function private.pnl_report_cache_clear() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update private.pnl_report_cache set built_at = '-infinity', rows = '[]'::jsonb where true;
  return null;
end $$;
revoke all on function private.pnl_report_cache_clear() from public, anon, authenticated;
