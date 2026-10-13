// The keys of app_settings that the Flipkart page and the Settings page read. A plain module (no "use client").
export const SETTING_KEYS = [
  "low_stock_threshold",
  "weight_alert_limit",
  "new_inactive_days",
  "price_drop_percent",
  "dispatch_sla_days",
  "running_out_days",
  "return_rate_percent",
  // Money (owner only to read on the Money page, owner only to change)
  "money_low_margin_percent",
  "money_default_fee_percent",
  "money_unpaid_after_days",
  "money_fee_deviation_points",
  "money_upload_reminder_days",
  "money_keep_months",
];
