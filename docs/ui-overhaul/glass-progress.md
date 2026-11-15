# Aurora Glass: progress

Branch `ui/glass` from `origin/main` (ac140b4). Spec: `docs/ui-overhaul/glass-spec.md`. Gaps: `glass-gaps.md`.
Inventory: `glass-inventory.md` (all ticks cleared; ticked only after seeing each item on the finished page).

## 1. Tokens, fonts, shared components (spec 1-6): code done, not yet seen on screen
- globals.css: every token from section 1 (dark default, Auto = dark, light under data-theme="light"), the new
  variables, the page background, type classes (.t-h1, .t-headline, .t-hero, .t-stat, .t-card-title, .t-caption,
  .t-label), 12/6/1 grid (.g-grid, .span-N), card, hero card, inner box, popover, chip, buttons, inputs, segmented,
  toolbar, stat strip, glass ledger, tone rows, skeleton sweep, toasts, scrollbars, and all section 6 motion.
- layout.tsx: Manrope, Unbounded, Geist Mono via next/font/google; browser bar colours follow the new canvas.
- ui.tsx, kit.tsx, data-table.tsx, charts.tsx, lanes.tsx, kpi.tsx, count-up.tsx (600 ms), sheet, toast, command
  palette, theme switch restyled in place.
- Shared table now shows as a table on phones too (sideways scroll, first column pinned, Sort by above it), per
  section 4; the phone card view is gone.
- Checks: tsc clean, lint clean, 298 tests pass. Not yet screenshotted or reviewed in the browser.

## Still to do
2 App shell · 3 Command Deck and Dashboard · 4 Flipkart · 5 Work, posts, Tickets, Notifications · 6 Ads, Ads Desk,
Reviews, Team, P&L · 7 Admin, sign-in, Money · 8 Accessibility pass and colour sweep · build · screenshots · report.

## 2. App shell (spec 7): done
- Rail 236 px from 1100 px (labels, Label group headings, 40 px items, gradient active bar), 72 px icons-only with
  tooltips from 700 px, bottom bar under 700 px (Deck, Work, Tickets, Flipkart, More; gradient dot above active).
- Top bar 64/56 px glass: search pill (420 px max, Ctrl K chip), sync status, Sync now (secondary), + Post (primary),
  bell, 32 px avatar. Phone: mark, search, + Post, bell, avatar; the sync status line (and Sync now for owner and
  admin) leads the page instead.
- Push banner: slim Card, ghost Not now, secondary Turn on notifications. Dev preview bar: one Card, caption links.
- Main area: max 1480 px, padding 24/16/12 px.
- Checks: tsc, lint, 298 tests clean. Seen in dark 1440, dark 390 and light 1440.

## 3. Command Deck and Dashboard (spec 8.1, 8.2): done
- Deck: 12-column grid in spec order. Headline (span 12), Today hero card (span 5, gradient border, t-hero, live late
  chip, capacity track, numbers strip), lanes (span 7), pulses (span 12), queue as two cards "Orders and stock"
  (span 7) and "Work and tickets" (span 5, with open tickets chip), orders trend 7 / dispatch 5, stock by warehouse
  6 / stock health 6 (3+2 strip), movers span 12 in two columns from 1100 px. Queue rows are tone rows.
- Dashboard: greeting with month chip and headline; Profit hero (span 5), Revenue 3, Ads 2 (gauge), To dispatch 2;
  pulses; orders a day 7 / money ring 5; month by month 7 / products 5; lanes 7 / needs a look 5.
- Added fake data: src/lib/dev-fixtures-pnl.ts (fakePnl, fakeDashboard) and preview views ?view=dashboard, ?view=pnl.
- Checks: tsc, lint, 298 tests clean. Seen in dark 1440 and dark 390 (deck, dashboard).

## 4. Flipkart, all tabs (spec 8.3): done
- Tab bar: groups as a segmented control; tabs of the open group as ghost pills (active on --accent-soft). Addresses unchanged.
- Needs action: caption, section Cards with tone bar header and count Chip, tone rows, Show N more; two columns from 1100 px, most urgent first.
- Orders: sync bar as a slim Card (status left, Sync now right, 4 px progress under; notices as tone rows); lanes as the
  hero card; toolbar; By SKU list, Order list, Cancelled and Cancellations per day as glass ledgers; "Could not load"
  as a bad tone row in a Card.
- Stock: sync bar as above; warehouse StatStrip (tap to filter, 3 + 2 wrap for five); list switch segmented; toolbar; ledger.
- Stock-outs, Forecasting, Overfill, Returns, Prices, Listing health: status lines as tone rows; Returns tiles as a
  StatStrip; Forecasting ranked list in the Forecast row style; its table is a glass ledger at every width.
- Master SKUs: toolbar; new master form as a Card; products as Cards with SKU chips; Not linked yet and Removed as ledgers.
- Fixed a 4 px sideways scroll on phones from edge-to-edge pill rows (Flipkart, Ads Desk, P&L, Expenses, Money, Team).
- Checks: tsc, lint, 298 tests clean. Seen in dark 1440 (needs, orders, stock, forecast, masters) and dark 390 (orders).

## 5. Work board, posts, Tickets, Notifications (spec 8.4–8.7): done
- Work board: My work / Everything segmented control; headline; three column Cards (Overdue, Due today, Next) with count
  Chips from 1100 px, stacked below; post cards as inner boxes with the 3 px tone bar.
- Post card: bar bad when overdue, warn when due today or High/Urgent; VR-N mono + chips; 15 px 600 title (2 lines);
  caption meta; due Chip bottom right. All posts: post cards as glass Cards in a 3 / 2 / 1 grid.
- Post page: left 8 columns (header, new-listing cards, done, photos, comments), right 4 sticky (Actions, facts,
  Tickets, History); phones: header, Actions, then the rest. New post: four option cards 2 × 2 with icons; form in one Card.
- Tickets: title, + Ticket, headline sentence; groups segmented with counts in the toolbar; ticket cards like post
  cards (bad bar when follow-up due) in 3 / 2 / 1. Ticket page: form Card 8 columns, linked post Card 4 columns.
- Notifications: 780 px centred; Alerts on this phone Card; filter pills; notifications as tone rows in one Card.
  The bell panel uses the same tone rows.
- Checks: tsc, lint, 298 tests clean. Seen in dark 1440 (mywork, post, notifications); no sideways scroll at 390 on
  mywork, all, post, new, tickets, ticket, newticket, notifications, listings, done.

## 6. Ads tracker, Ads Desk, Review tracker, Team, P&L (spec 8.8–8.12): done
- Ads tracker: title, scan picker and Sync right, notes as captions; figures as a StatStrip; Needs a look (tone rows)
  5 / Average daily spend 7; Every tracked SKU as a ledger; Campaign form Card 4 / Campaign log 8 (log full width
  while the form is closed); Tracked SKUs as chips.
- Ads Desk: title, dates and Sync reports right; section nav as a sticky glass pill row under the top bar; headline
  and StatStrip; Where every rupee went 7 / By placement 5; six problem Cards in a 2-column grid with tone bar headers
  (bad, bad, warn, ok, warn, warn) and tone rows; every list a glass ledger.
- Review tracker: four tiles as one StatStrip; Progress by priority 7 / Check by check 5; Nearly there 6 / Reviews
  removed 6 (tone rows); priority link groups as Cards in a 2-column grid; Every link toolbar + ledger.
- Team: headline + StatStrip; Suggestions as tone rows in a Card; Attendance 5 / capacity chart 7; per-warehouse cards
  in one row (3 + 2 at 700–1099 px, sideways scroll on phones); Day by day full; The team as a ledger; Owner tools as
  three Cards.
- P&L: title with the month switch right; 5-cell StatStrip (Sales, Cost, Ads, Fees, Profit after ads in --grad-accent);
  notes as captions; By product ledger with the unlinked SKUs as an inner box; Costing 7 / Ads reports + Fees 5.
- Checks: tsc, lint, 298 tests clean. Seen in dark 1440 (ads, adsdesk, reviews, team, pnl); no sideways scroll at 390.

## Area 7: Admin, sign-in, Money (8.13–8.15) — done
- Sign-in and change password: centred 400 px Card, lane mark, Unbounded 20 px name, caption, tone-row alert.
- Settings: General and Flipkart page Cards side by side, Money full width, sticky Save bar (--pop, blur, top border).
- People: header with counts and + Add user, user cards in g-cards (3/2/1), form as a Card in place.
- Money: shared styles only. Checked: no sideways scroll at 390 on settings, users, password. tsc, lint, tests clean.

## Area 8: Accessibility, performance, colour sweep (9) — done
- Contrast: 8 text tokens raised toward --ink (listed in glass-gaps.md). Touch targets: 36 px buttons to 40, transparent tap areas on 32 px seg options, phone VR mark, chip remove.
- backdrop-filter only on cards ≥700 px, rail/top/bottom bars (vr-bar, vr-bottom), popovers/tooltips and the settings Save bar.
- Hex/rgba sweep of component files: only literal colours left are meta theme colours (equal --canvas) and the WhatsApp QR white box.

## Final
- npm run build passes. 86 screenshots in docs/ui-overhaul/screens/glass (dark 1440 and 390 for 39 preview views and /login; light 1440 for deck, dashboard, forders, mywork, team, pnl).
- glass-inventory.md: 131 of 155 lines ticked; the rest are listed at its end with the reason.
