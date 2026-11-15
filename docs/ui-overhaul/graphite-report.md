VRPRIME,

The Graphite build is finished on branch `ui/graphite`, pushed to `origin`. Nothing is merged, nothing touched main or
the live site, and nothing was written to the database. All five migrations are written but not applied.

## Phases

All screenshots are in `docs/ui-overhaul/screens/graphite/`, named `<view>-dark-1440.png` and `<view>-dark-390.png`
for every `/dev/preview` view (45 views), plus `deck-light-1440.png`.

| # | Phase | Done | Screenshots |
|---|---|---|---|
| 1 | Tokens, fonts, components, flow map, charts | yes | every view (all use them) |
| 2 | App shell | yes | every view (rail, top bar; bottom bar at 390) |
| 3 | Every page | yes | deck, deckclear, dashboard, mywork, listings, empty, all, post, done, new, tickets, ticket, newticket, notifications, stock, stockempty, stockrunning, fneeds … fmasters, team, adsdesk, ads, reviews, pnl, settings, users, password, loading; deck-light-1440 |
| 4 | Speed, with timings | yes | loading-dark-1440/390 (skeleton) |
| 5 | 12.2 Returns to claim | yes (migration not applied) | fclaim-dark-1440/390 |
| 6 | 12.4 Closing report | yes (migration not applied) | closing-dark-1440/390, team-dark-1440/390 (button) |
| 7 | 12.1 Business page | yes (migration not applied) | business-, btargets-, bdead-dark-1440/390, settings-dark-1440 (Targets card) |
| 8 | 12.5 Weekly summary | yes (migration not applied) | notifications-dark-1440/390 (closing report and weekly summary messages) |
| 9 | 12.3 Listing check | yes (migration not applied, PC task not installed) | flistcheck-dark-1440/390 |
| 10 | Sweep, screenshots, report | yes | this set |

## Gaps (every line of graphite-gaps.md)

- Flow map state "N late · how late": the lane data carries no lateness duration, so the state reads "N late" only. `src/components/signal/lanes.tsx`. Rule 14.3 (never invent a figure).
- Team day-by-day grid sticky first column used the deleted `--surface-solid`; now `--surface` (the Card background it sits on). `src/components/team/board.tsx`. Rule 14.1.
- Expenses page decorative radial glow removed with the other radial gradients. `src/components/expenses/expenses-board.tsx`. Section 1, rule 14.1.
- Settings sticky save bar lost its `backdrop-blur` (no blur anywhere); background stays `--pop`. `src/components/admin/settings-form.tsx`. Section 1.
- Rail Sync status card "amber when it failed": the shell only knows the last finished order read (the data the top bar showed), not a failed one, so amber means no read yet or over 3 hours old. `src/components/shell/command-bar.tsx`. Rule 14.3.
- Top bar 700–1099 px: section 8 gives no tablet layout for the date and time and the name and role beside the avatar; both show from 1100 px, the avatar alone below. `src/components/shell/command-bar.tsx`. Rules 14.1 and 3 (layout by width band).
- Top bar date and time format: the existing `formatDate` · `formatDateTime` pair the deck header used ("15 Nov · 11:52 pm"). `src/components/shell/command-bar.tsx`. Rule 14.1.
- Geist Mono weight: section 2 loads Geist Mono at 400 and 500, but some IDs sit in 600 text (item row titles, card titles); mono text is capped at 500 so the browser never fakes a bold. `src/app/globals.css`. Rule 14.3.
- Command Centre header: section 9.1 drops the "Operations · date · time" label (the date and time are in the top bar from 1100 px); on phones and tablets the page no longer shows the time. `src/components/deck/sections.tsx`. Literal reading of 9.1 and section 8.
- Command Centre: the reassurance line from the glass headline stays as a caption under the subtitle (inventory item kept). `src/components/deck/sections.tsx`. Rule 14.1 (caption).
- To dispatch today KPI: 9.1 makes the capacity sentence the context line; the capacity bar the glass hero card drew is not repeated (9.1 does not list it, unlike 9.2's share bar and gauge). `src/components/deck/sections.tsx`. Literal reading.
- Queue item rows with two actions (Raise ticket, + Restock): item rows allow one 40 px button, but every existing button must stay (section 13), so both show as 40 px secondary buttons. The kind tag (Late, Risk…) leads the detail line so status is never colour alone. `src/components/deck/queue.tsx`. Rule 14.1.
- Queue icon badges by kind: late clock red, overfill box red, risk clock amber, dry warning amber, ticket green, work board violet (section 4 table and colour meaning; work has no row in the table, so the board icon from the rail in violet). `src/components/deck/queue.tsx`. Rule 14.1.
- Work and tickets card keeps the glass "first 6, Show N more" (9.1 gives "first 4, View all" only for Orders and stock). `src/components/deck/sections.tsx`. Glass layout kept.
- Orders pulse 3-cell row and Stock health rows: each row keeps its line under the Label (numbers in it must not disappear); cell numbers use the Stock health number style (Plus Jakarta Sans 18 px 700). `src/components/deck/sections.tsx`. Rule 14.1.
- Forecast, top movers is now 7 columns, so its rows run in one column (the two-column split was for the full-width glass card). `src/components/deck/sections.tsx`. Rule 14.1.
- Dashboard Needs a look item rows: notification kinds have no row in the section 4 icon table; warning triangle for bad and warn kinds, bell otherwise, tint from the kind's tone; the kind label is the status pill. `src/components/dashboard/board.tsx`. Rule 14.1.
- Dashboard KPI "To dispatch today": the late Chip beside the label leaves the label truncated at 1440 when the sparkline is also shown (KPI card layout as section 4). `src/components/dashboard/board.tsx`. Rule 14.1.
- Figures in Geist Mono (glass rule) moved to Inter tabular across all pages; Geist Mono kept only for SKUs, order, ticket, listing and campaign IDs and VR-N numbers. Email and password fields lose mono (not in the section 2 list). The shelved Money and Expenses pages keep theirs (glass 8.13: shared styles only). Section 2.
- Card headers with a glass tone bar (Needs action sections, Ads Desk problem cards, post page status cards): the bar is removed like the item-row left bar; the count Chip or text carries the tone. `src/app/globals.css` `.tone-head`. Section 4 (no left bar), rule 14.1.
- Single-message lines that used tone rows (sync bar notes, "Could not load" alerts, the Returns note, post form warning, Team "Nothing stands out", toasts) keep the item-row box without an icon badge: they are messages, not rows in a list. `src/app/globals.css` `.tone-row`. Rule 14.1.
- Item row titles and details are one line with an ellipsis (section 4), so long queue details and Team suggestions are cut at narrow widths; the full text stays in the row's link target or page. Literal reading of section 4.
- Review tracker tiles and Stock warehouse tiles were custom "stat-strip" cells, not `Stat`; both are now KPI cards in a KPI row with icon badges (reviews star violet, targets trend blue; warehouse stock box violet). The tiles keep their extra content (platform split, gauge, chips). Rule 14.1.
- Page headers with a glass label above the title (Ads tracker, Ads Desk, Review tracker, Team): the label text is now the subtitle under the title (section 8: title left, subtitle under it). Team's title is "Team" with its headline sentence as the subtitle. Section 8.
- My work: the headline sentence is the subtitle; the old subtitle "Your open work, most urgent first" follows it in the same line. Tickets: the headline sentence is the subtitle. Section 8 and 9.
- KPI icon for ROI: not in the section 4 table; treated as money (rupee, violet). Conversion falls to the default box icon. `src/components/ui.tsx`. Rule 14.1.
- Item rows under 700 px: with one or two 40 px buttons on the right the title had no room, so a row with buttons puts them on a second line under the title (section 3 width bands; the item row grid is kept above 700 px). `src/app/globals.css`. Rules 14.1 and 3.
- KPI icon: a label with "sales" or "revenue" is money even when it also says "price" ("Sales (seller price)"), so price problems keep the warning icon only for real price warnings. `src/components/ui.tsx`. Section 4 table.
- Short cache: dashboard-data.ts has no money loader of its own; its money comes from `loadPnl` (pnl-data.ts), which is wrapped, so both the Dashboard and the P&L use the cached P&L. `src/server/pnl-data.ts`. Literal reading of 10.2.
- Short cache cleared after P&L "Save costs" (`saveMasterCosts`) as well as after syncs and report uploads: without it the P&L page would show the old profit for up to 30 seconds right after saving, which changes what the button does (section 13). Other forms are not cleared (10.2), so for example a new attendance mark reaches the Command Centre capacity sentence up to 30 seconds later. `src/server/actions/pnl.ts`. Section 13 over 10.2.
- Short cache user key: the cached loaders take a database client, not a user, so the key reads the signed-in user's id from `getSessionUser` (already cached per request); with nobody signed in nothing is cached. `src/server/short-cache-user.ts`. Rule 14.2.
- Review sync and Ads Desk report syncs run through API routes, not server actions, and read nothing the short cache holds, so they do not clear it. 10.2 literal.
- Loading screens: the Flipkart and Money skeletons are replaced by the shared one (header, KPI row, two cards) like every other route (10.4). `src/app/(app)/**/loading.tsx`.
- 12.2 `return_check_ticket`: when a return already has an 'ok' check (possible from the All returns table), raising a ticket turns it into 'ticket' instead of being ignored, so the ticket is always recorded; the function also refuses a ticket the caller did not create. `supabase/migrations/20261116091000_return_checks.sql`. Rule 14.2.
- 12.2 visibility test written once as `private.can_see_return` (fk_returns_select's test) and used by both functions. Same migration. Rule 14.2.
- 12.2 `returns_to_claim()` rows carry return_id, order_item_id, order_id, sku, source, reason, sub_reason, quantity, warehouse_id, returned_on and days_left (the columns the screen needs). "Checked this week" counts visible return_checks since Monday 00:00 India time. Rule 14.2 (Returns tab).
- 12.2 "Days to claim a return" accepts 1 to 30 (the settings schema needs a range; 1 to 30 is the existing "dispatch_sla_days" range). No hint line under it (the spec gives none). `src/lib/validation.ts`. Rules 14.2 and 14.3.
- 12.2 Settings save checks every key exists in app_settings, so Save on the Settings page fails until migration 20261116091000 (which adds return_claim_days) is applied. Apply the migration before this branch goes live. Note for VRPRIME.
- 12.2 the To claim tab label count is read only while the Returns group is open (it is the only place the label shows). `src/app/(app)/flipkart/page.tsx`. Literal reading.
- 12.2 empty states: "Nothing to check" / "No missed returns", and "Returns to claim is not set up yet" while the migration is not applied (the spec gives no wording). `src/components/flipkart/claims-tab.tsx`. Rule 14.1 (empty state).
- 12.2 KPI icons: To check, Missed and Checked this week use the return arrow (returns, amber); Closing today or tomorrow uses the clock (amber when above 0). Section 4 table.
- 12.2 Raise ticket on To claim is primary at the 40 px row height and 12 px text (row action buttons are 40 px, section 4). `src/components/flipkart/claims-tab.tsx`. Rule 14.1.
- 12.2 a ticket raised from a return saves `tickets.return_id` only when a return is attached, so ordinary tickets keep working before the migration is applied. `src/server/actions/tickets.ts`.
- 12.4 / Part C: there is no `NotificationKind` type in `src/lib/types.ts` (kind is a plain string), so new kinds go only in the label, tone, link and icon maps. Rule 14.2.
- 12.4 closing_report and 12.5 weekly_summary are updates, not alerts (they ask for no action): not in ALERT_KINDS, tone info like money_reminder; icons truck and bars. listing_alert asks for action like listing_not_found: in ALERT_KINDS after it, tone bad, warning icon. `src/lib/alerts.ts`, `alert-card.tsx`. Rule 14.2.
- 12.4 private.closing_report() writes a row for every warehouse (zeros where nothing happened) and skips orders and dispatch rows with no warehouse; "dispatch date today or earlier" leaves out pending orders with no dispatch_by. Migration 20261116093000. Rule 14.2 (alerts_capacity's tests).
- 12.4 the owner/admin notification uses private.alert_people() (owners and admins), as alerts_stock does; body lines are joined by a new line. Rule 14.2.
- 12.4 the totals row is the last row of the ledger, in semibold, shown when there is more than one warehouse; the table is not sortable. `src/components/reports/closing-table.tsx`. Rule 14.1.
- 12.4 day arrows copy the Team attendance panel's (← and →, the next arrow dimmed on today); the subtitle reads "Today · 16 Nov" on today. Not-set-up state "The closing report is not set up yet". Rule 14.1.
- 12.4 no rail item for the closing report (the spec names only the Team header button); warehouse users reach it from the notification. Rule 14.3.
- 12.5 the weekly summary notification has no date in it, so its link takes the Monday a week before the day it was created (India time). `weeklySummaryStart` in `src/lib/notifications.ts` and the notify function. Rule 14.2.
- 12.1 a blank target is saved as an empty JSON string, not null: app_settings.value is not null and the REST API turns JSON null into SQL null. The migration seeds both keys as "". `saveSettings`, `readTargetValue`. Rule 14.2.
- 12.1 business_week_data: `sales` sums selling_price of the same non-cancelled rows; `by_product` groups by master product (several listings of one product are one entry), with units × units_per_order. `cancelled_by` keys a missing cancel_type as "unknown". Rule 14.2.
- 12.1 Change column shows "new" in place of a percent when last week was 0. `signedPct`. Rule 14.3 (no invented figure).
- 12.1 week table: the thin pair of bars is this week in --accent over last week in --muted, 6 px each, on the --surface2 track (Bar's track, thinner). `week-tab.tsx`. Rule 14.1.
- 12.1 week arrows copy the attendance panel's ← and → (next dimmed on the current week); the card caption names the dates and the days compared. Rule 14.1.
- 12.1 Rising and Falling rows use the trend icon (green; mirrored and red for Falling) with a signed Chip. Rule 14.1.
- 12.1 Targets tab: "on pace" for sales uses the Dashboard's profit pace rule (figure so far ÷ covered days × days in month). The marker is 2 px --ink, 4 px taller than the bar. Month bars copy the Dashboard's Month by month bars, without the ads bar; targets are 1 px dashed --muted lines (TrendChart's average line). Rule 14.1/14.2.
- 12.1 subtitles: Targets "This month against your monthly targets, from the same figures as the Dashboard."; Dead stock "Stock that is not selling, by its value at cost."; the week subtitle before the migration "The week against the week before." Rule 14.1.
- 12.1 Dead stock "Products with no cost entered" counts dead and slow products without a cost; rows without a cost sort last by stock. Rule 14.2.
- 12.1 Business tabs are a link segmented control (WorkSwitch's), so `?tab=` stays the address. Rule 14.1.
- 12.5 rupees in the message use Indian grouping through a small private.inr() in the migration; the percents use a true minus ("−5%") like the app. When the week before had no orders the title is "Last week: N orders" and the sales percent is left out. Rule 14.3.
- 12.5 "Returns" in the body is customer plus courier returns. Rule 14.2.
- 12.4/12.5 the bell splits a closing report's body by line (one warehouse a line); other kinds still split on " · ". `alertLines` in `src/lib/alerts.ts` (+ test). Rule 14.2.
- 12.4/12.5 preview: one closing report and one weekly summary added (read) to the fake notifications. `src/lib/dev-fixtures.ts`.
- 12.3 parser: the buyer's price is the schema.org Product offer's `price` (it matches the "Buy at ₹…" button; `finalPrice` differs on one page and is not used). Buyable needs that price, InStock in the offer and a CART_ADD or BUY_NOW control. "Enabled" could not be checked further: all five saved pages had the controls and none was disabled. `src/lib/listing-check.ts`. Rule 14.2.
- 12.3 out-of-stock and unavailable detection is unverified: none of the five pages was sold out or removed. Out of stock = schema.org OutOfStock/SoldOut/Discontinued or the words "sold out", "out of stock", "currently unavailable"; unavailable = HTTP 404/410 or a page with no Product block that says it was moved, deleted or not found. Their tests are `todo`. Rule 14.2 (the spec's words).
- 12.3 listing_check_save notifies at most once in 20 hours per person (alert_once's guard), since the PC may save twice a day; the five names follow priority order. Migration 20261116092000. Rule 14.2.
- 12.3 listing_check_rows has no foreign key to review_links (the spec gives none), so the screen reads the links separately and joins them in code. `src/server/listing-check.ts`. Rule 14.3.
- 12.3 the script's CLI save first sets the session's JWT role to service_role (the CLI signs in as the database owner, where auth.role() is empty), so listing_check_save accepts it. `scripts/listing-check.mts`. Rule 14.2.
- 12.3 screen: the Listing check tab sits in the Listings group after Listing health; owner and admin only (warehouse users never see it). Priority uses the Review tracker's names (P1…, Last). "Differs" Chip is amber; "Open" is a row button opening a new tab; the empty state body says how to install. Subtitle "Whether every listing can be bought, read on the PC each morning". Rule 14.1.
- Phase 10 sweep: the only colour literals left outside the token definitions are the browser theme-colour meta and the web manifest (`src/app/layout.tsx`, `src/app/manifest.ts`), which cannot read CSS variables; they equal `--canvas` dark and light. The Expenses preview's QR box stays white (bg-white, neutral-600 text) so phones can scan it; that page is preview-only and shelved. No backdrop-filter anywhere. Rule 14.3.

## Inventory: unticked items and why

85 of 155 lines ticked; 70 left. A line is ticked only when everything in it is visible on a finished screenshot. Most unticked lines are things a static capture of fake data cannot show. None was found broken.

- **Not visible in a static capture:** Shell: account menu, command palette, alerts panel (closed for the captures), toasts, error/not-found pages. Sign-in: login. Money: tabs, tiles and tables, SKU page (shelved, not in the preview). Admin: owner-only notice (another role). Push prompt one-line bar (headless browser has no push). Rail active marker (not distinguishable in captures). Shell: Flipkart and Money loading skeletons (only the app skeleton was captured).
- **Empty or "not set up" states the fake data never reaches:** Command Deck notes line; Dashboard Needs a look "All clear"; Needs action empty state; Orders empty / "Could not load"; Stock-outs empty states; Tickets empty states; Notifications empty states; Ads not-set-up; Reviews not-set-up / no-check; Team "Start by adding your team"; Flipkart per-tab skeleton.
- **Expanded rows, sheets or forms not opened in a capture:** Orders By SKU opened group; Forecasting expanded SKUs, Table layout, All SKUs list; Prices expanded history; Master SKUs kit parts form; Post Mark done proof form, Done card with ticket fields, photos grid, new-post form after the type picker; Ads campaign form; Ads Desk campaign table and sheet, Products / Search terms / Keywords / Day of week tables, Negative keywords (only Overview captured); Team staff money sheet, import preview; Admin user form.
- **Only partly visible, because the fake data doesn't trigger that state:** Today · to dispatch "orders still to go out across N warehouses" line; Dashboard Products by profit (no losing products in the fixture); Flipkart tab row (Listing health is behind its flag); Needs action "not found" and Money sections; Orders sync bar progress/failure; Stock sync bar "without details"/failure; Stock single-warehouse lists and other lists' columns; Stock-outs "(covers N days)" and Inactive chip; Returns "only returns that changed" warning, Warehouse and Order ID columns at the captured width; Returns rate table (the preview's `frates` view opens the same Returns list, an old preview limitation); Prices Discount and Changes columns; Listing health counts note and VR-N link; Forecasting failure status lines; Post card live chips; All posts New listings switch and "first N of M"; Tickets "Clear search and filters" / "first N of M"; Ticket page header details; Notifications push buttons (the browser reports "Not available"); Ads stale notes; Ads Desk "Start by syncing"; Team "Mark the rest present", expected line in the capacity chart; P&L "not added" notes and Save costs; Settings Money switch and master SKU note (not drawn in the preview); Change password first sign-in heading.

## The ten timings (ms; local dev server, live database, after one warm-up load)

- loadDeck: 129, 135, 101, 134, 153 (before: 672, 1052, 2198, 2162, 3488)
- loadDashboard: 209, 224, 328, 229, 241 (before: 1814, 1753, 5777, 787, 738)

## Per feature

**12.2 Returns to claim**: `supabase/migrations/20261116091000_return_checks.sql`.
- Couldn't test: the live list, "Looks fine", the 'ticket' check written when a ticket is raised from a return, the tab
  count, Settings Save. All of these need the migration. Before it, the tab shows "not set up yet".
- Unverified: none beyond that.

**12.4 Closing report**: `supabase/migrations/20261116093000_closing_report.sql` (needs 091000 first).
- Couldn't test: the 21:50 run, the rows, the notifications, warehouse users seeing only their own lines.
- Seen live: /reports/closing shows "not set up yet", and the Team button links there.

**12.1 Business page**: `supabase/migrations/20261116090000_business.sql`.
- Couldn't test: the week figures and Rising/Falling (need business_week), and saving targets. Settings Save needs
  090000 and 091000.
- Seen live, read only: Targets showed the empty states and the last months from the P&L loader. Dead stock listed
  real products.

**12.5 Weekly summary**: `supabase/migrations/20261116094000_weekly_summary.sql` (needs 090000 first).
- Couldn't test: the Monday 9:00 run and the real message. The link and the week it opens are covered by unit tests.

**12.3 Listing check**: `supabase/migrations/20261116092000_listing_check.sql`, plus `scripts/listing-check.mts` and
`scripts/install-listing-check.ps1` (not run).
- Pages: five Flipkart pages saved to `D:\Vrprime hub\flipkart-pages` (outside the repo).
- Dry run against the five live links (read only, nothing saved): all 5 buyable, at ₹185, 183, 186, 171 and 197.
- **Unverified**: out-of-stock and unavailable detection (no saved page was sold out or removed; those tests are
  `todo`), and whether a buy button is disabled (none was).
- Couldn't test: saving through `listing_check_save`, the listing_alert notification, the live tab.

## Manual steps, in order

1. Review the five migration files.
2. Apply them in file-name order: 090000 business, 091000 return_checks, 092000 listing_check, 093000 closing_report,
   094000 weekly_summary. Closing needs return_checks, and weekly needs business.
3. Check pg_cron has the jobs 'closing-report' (20 16 * * *) and 'weekly-summary' (30 3 * * 1).
4. Redeploy the notify Edge Function. It has new link rules for closing_report, weekly_summary and listing_alert.
5. Settings: check "Days to claim a return" (7), optionally set the two targets, then Save. Save fails until steps 2
   and 3 are done.
6. On the PC: `powershell -ExecutionPolicy Bypass -File scripts\install-listing-check.ps1 -RunNow`.
7. Look over the branch, then merge `ui/graphite` into main yourself when happy. Main deploys the live site.

## Checks

- `npx tsc --noEmit`: clean
- `npm run lint`: clean
- `npm test`: 330 pass, 0 fail, 2 todo (the unverified listing rules)
- `npm run build`: passes, with /business and /reports/closing in the route list
- Sweep: no backdrop-filter. Colour literals only in the theme-colour meta and manifest (equal to --canvas), and the
  Expenses preview's white QR box.

## How to view the branch

```
git fetch origin
git checkout ui/graphite
npm ci
npm run dev
```

Then open http://localhost:3000 signed in. Two things to know:
- Fake-data views are at http://localhost:3000/dev/preview?view=deck (the view names are listed at the top of that
  page; add `&role=admin` or `&role=warehouse`).
- The local site reads the live database, and the new features show "not set up yet" until the migrations are
  applied.
