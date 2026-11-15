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
