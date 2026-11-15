# Graphite Command Centre: progress

Branch `ui/graphite` from `origin/ui/glass` (7065af3). Spec: `docs/ui-overhaul/graphite-spec.md`.
Gaps: `graphite-gaps.md`. Inventory: `graphite-inventory.md` (all ticks cleared; ticked only after seeing each item).

## 1. Tokens, fonts, shared components, flow map, charts (Part A 1-7): done
- globals.css: every section 1 token (dark default, light column), solid surfaces, flat canvas, no backdrop-filter;
  glass variables deleted and their last uses replaced (`--accent`, `--surface`). Type classes per section 2 (no
  uppercase labels, no hero number). Layout per section 3 (1440 px max, 28/16/12 padding, 14 px gap).
- layout.tsx: Plus Jakarta Sans (600, 700), Inter (400, 500, 600), Geist Mono (400, 500); Manrope and Unbounded removed.
- ui.tsx: Card, IconBadge (5 tints), KPI card (replaces Stat, icon and tint by meaning), KPI row (4 / 2 / scroll-snap
  78%), ItemRow, buttons, chips, inputs, segmented, tables per section 4. icons.tsx: megaphone, star, return, bars added.
- lanes.tsx: the flow map (section 5), same props. charts.tsx: section 6 (bar-and-line TrendChart, no glow).
- Checks: tsc clean, lint clean, 298 tests pass. Seen on /dev/preview (tokens and fonts load).

## 2. App shell (Part A 8): done
- Rail 228 px (surface2, padding 22/16, 30 px mark, 44 px items, accent-soft active), three groups with a 14 px gap
  and no headings; "Command Deck" renamed "Command Centre" in rail, page title and palette. Sync status card at the
  bottom (dot, healthy line, "Orders read N ago · scope", Sync now for owner and admin); on the 72 px rail just the dot
  with a tooltip.
- Top bar 64 px on --canvas, no border: search pill (surface, line border, Ctrl K), date and time with green dot,
  + Post, bell, 34 px avatar with name and role. Sync status left the top bar; on phones it still leads the page.
- Bottom bar unchanged apart from tokens (--pop, no blur).
- Repair: removing the old worktree deleted part of node_modules through its link; restored with `npm ci` (lock file
  unchanged, no new packages).
- Checks: tsc, lint, 298 tests clean. Seen at 1440 (headless Edge).

## 3. Every page (Part A 9): done
- 9.1 Command Centre: header (title, headline subtitle, two buttons), KPI row of four (To dispatch today with the
  capacity sentence and late Chip, then the three pulses with sparklines), Order flow map 8 cols with Live pill,
  Orders and stock (first 4, View all) and Orders pulse stacked in 4 cols, Work and tickets / Stock by warehouse /
  Stock health (five list rows) 4+4+4, Dispatch 5 / Forecast 7.
- 9.2 Dashboard: greeting title, summary subtitle, month Chip; KPI row (Profit, Revenue with share bar, Ads with
  gauge, To dispatch with sparkline); pulses KPI row; charts as before; flow map 8 / Needs a look 4 (item rows).
- 9.3 Flipkart: Needs action sections use item rows with icon badges; the Orders flow map shows the stage captions.
- 9.4 Every other page: KPI rows everywhere (incl. the Review tracker and Stock warehouse tiles), item rows in the
  Ads tracker, Ads Desk problem cards, Team suggestions, Reviews removed and the alerts panel; section 8 page headers
  on Team, Tickets, My work, Ads tracker, Ads Desk, Review tracker. Figures in Inter tabular; Geist Mono only for IDs.
- Checks: tsc, lint clean. Seen in dark 1440 and 390 (headless Edge), light 1440 for the Command Centre.

## 4. Speed (Part B): done
- No blur anywhere (Phase 1). `src/server/short-cache.ts` (+ unit tests) and `short-cache-user.ts`: 30-second cache
  keyed by user id + function + JSON arguments around loadOrderCounts, deck_series, dispatch_series, team_order_load
  (deck and team), loadStockDesk, loadEmpties, loadCover, loadReturnRates, loadTeamCapacity and loadPnl (P&L and
  Dashboard money). Cleared at the end of startOrdersSync, startStockSync, syncInventoryNow, uploadInventory,
  syncAdsReport, uploadAdsReport, uploadMasterSkus and saveMasterCosts.
- next.config.ts: experimental.staleTimes.dynamic = 30 (documented in this version's staleTimes guide).
- loading.tsx with the shared skeleton (header, KPI row, two cards) on all 22 routes.
- Timings on the local dev server, live database, after one warm-up load each (ms):
  - before: loadDeck 672, 1052, 2198, 2162, 3488 · loadDashboard 1814, 1753, 5777, 787, 738
  - after: loadDeck 129, 135, 101, 134, 153 · loadDashboard 209, 224, 328, 229, 241
  Timing code removed. No query or calculation changed.

## 5. Returns to claim (Part C 12.2): done, migration not applied
- Migration `supabase/migrations/20261116091000_return_checks.sql`: return_claim_days setting (7), tickets.return_id,
  return_checks (RLS select like fk_returns), private.can_see_return, return_check_ok, return_check_ticket,
  returns_to_claim().
- src/lib/return-claims.ts (+ 6 unit tests); src/server/return-claims.ts; markReturnChecked action; createTicket saves
  return_id and the 'ticket' check; new-ticket form carries ?return= and ?item= as hidden fields; All returns Raise
  ticket carries them too. Flipkart › Returns › To claim tab with the To check count; Settings "Days to claim a return".
- Preview: /dev/preview?view=fclaim (and &ready=0 for the not-set-up state). Seen at 1440.
- Not testable until the migration is applied: the live list, Looks fine, the 'ticket' check, the tab count.

## 6. Closing report (Part C 12.4): done, migration not applied
- Migration `supabase/migrations/20261116093000_closing_report.sql`: closing_reports (RLS select: staff, warehouse
  role own warehouses), private.closing_report() (upsert per warehouse, notify owners/admins and warehouse users),
  cron 'closing-report' at '20 16 * * *'. Needs 20261116091000 first.
- Kinds closing_report, weekly_summary, listing_alert added to labels, tones, notificationUrl, the notify function's
  link rule and the alert icons (+ tests). The notify Edge Function needs redeploying by hand.
- /reports/closing (all roles) with day arrows, the table and a totals row; loading.tsx; "Closing report" secondary
  button in the Team header. src/lib/closing-report.ts (+ 3 tests), src/server/closing-report.ts.
- Preview: /dev/preview?view=closing (&empty=1, &ready=0). Screens: closing-dark-1440.png, closing-dark-390.png.
- Seen live: /reports/closing shows the not-set-up state (table missing); the Team button links there.
- Not testable until applied: the report rows, the 21:50 run, the notifications.
- Checks: tsc, lint clean; npm test 313 pass.

## 7. Business page (Part C 12.1): done, migration not applied
- Migration `supabase/migrations/20261116090000_business.sql`: private.business_week_data, public.business_week
  (owner only), the two target settings.
- src/lib/business.ts (+ 8 tests), src/lib/dead-stock.ts (+ 2 tests), src/server/business-data.ts.
- /business (owner; others get the owner-only notice) with This week, Targets and Dead stock; loading.tsx; rail item
  "Business" (bars) after Dashboard, owner only. Settings: new "Targets" card (target_sales_month,
  target_profit_month in SETTING_KEYS and validation).
- Preview: view=business, btargets, bdead. Screens: business-week/targets/dead-dark-1440.png and -390.png.
- Seen live (read only): This week shows the not-set-up state; Targets shows the empty states and the last months
  from the P&L loader; Dead stock lists real products from the forecast and inventory.
- Not testable until applied: the week figures, saving targets (Settings Save needs both migrations).
- Checks: tsc, lint clean; npm test 323 pass.
