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
