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
