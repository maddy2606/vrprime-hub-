# VR Prime Ops: "Graphite Command Centre" build specification

Written 15 Nov 2026 for branch `ui/graphite`. Everything is decided here: the look, every page, the speed work and five
new features. The implementer chooses nothing. Where this document is silent, section 14 says exactly what to do.

The owner rejected the previous "Aurora Glass" build (`ui/glass`) as too colourful and too much like the old design. This
build keeps the page structure that `ui/glass` already has, replaces its look and its main components, and adds features.

**Base:** create `ui/graphite` from `origin/ui/glass` (commit `7065af3`). Its layouts (glass-spec.md section 8), preview
views, fixtures, tap-area fixes and token-only colour rule all stay unless this document changes them.

---

# PART A. THE LOOK

## 1. Colour tokens (`src/app/globals.css`)

Keep every existing variable name. Replace the values. Solid surfaces only: delete every `backdrop-filter` in the code
base and the variables `--blur-card`, `--blur-bar`, `--grad-accent`, `--grad-bad`, `--surface-solid`. Where the code used
`--grad-accent` use `--accent`; where it used `--grad-bad` use `--bad`. Text that was filled with a gradient becomes
plain `--ink`. The page background is the flat `--canvas` colour: remove all radial gradients.

Dark is the designed theme and the default (Auto = dark). The Light option stays and uses the light column.

| Variable | Dark | Light |
|---|---|---|
| `--canvas` | `#0a0c12` | `#f4f5f9` |
| `--surface` (cards) | `#121622` | `#ffffff` |
| `--panel2` (hover, raised, secondary buttons) | `#1b2030` | `#eceef5` |
| `--surface2` (rail, inset rows, inputs) | `#0d1018` | `#f7f8fb` |
| `--pop` (menus, sheets, palette, tooltips) | `#151a28` | `#ffffff` |
| `--line` | `#1d2230` | `#e2e4ee` |
| `--line-soft` | `#171b27` | `#eceef5` |
| `--grid` | `#1d2230` | `#e2e4ee` |
| `--ink` | `#eef0f8` | `#12141c` |
| `--muted` | `#9aa3bd` | `#5a6078` |
| `--faint` | `#7c86a3` | `#6b7189` |
| `--accent` | `#6d5dfc` | `#5b4ee0` |
| `--accent-ink` | `#ffffff` | `#ffffff` |
| `--accent-soft` | `#1d1b3d` | `#ebe9fd` |
| `--accent-text` | `#b3a8ff` | `#4a3fc4` |
| `--cyan` (second chart series) | `#4aa3ff` | `#1f6fb8` |
| `--cyan-soft` | `#13243f` | `#e3effa` |
| `--info` | `#7db4ff` | `#1f6fb8` |
| `--info-soft` | `#13243f` | `#e3effa` |
| `--bad` | `#ff8a98` | `#b71d2e` |
| `--madder` | `#ff6b7a` | `#c81e30` |
| `--bad-soft` | `#2c141a` | `#fbe6e8` |
| `--bad-ink` | `#0a0c12` | `#ffffff` |
| `--warn` | `#f5b84a` | `#855600` |
| `--warn-mark` | `#f5b84a` | `#c97f00` |
| `--warn-soft` | `#2a2110` | `#faefd6` |
| `--ok` | `#3ecf8e` | `#17703f` |
| `--ok-soft` | `#10291f` | `#dcf2e5` |
| `--wh-1` | `#8b7bff` | `#5b4ee0` |
| `--wh-2` | `#6d83ff` | `#3856c9` |
| `--wh-3` | `#4aa3ff` | `#1f6fb8` |
| `--wh-4` | `#2dd4bf` | `#0c8576` |
| `--wh-5` | `#c084fc` | `#8a45c9` |
| `--stage-1` | `#4b4a7a` | `#c9c4f2` |
| `--stage-2` | `#7c6cff` | `#8f84ee` |
| `--stage-3` | `#c9c1ff` | `#4a3fc4` |
| `--scrim` | `rgba(5,6,10,0.72)` | `rgba(18,20,28,0.45)` |
| `--radius` | `12px` | same |
| `--radius-lg` | `18px` | same |
| `--shadow-card` | `none` | `none` |
| `--shadow-pop` | `0 24px 60px -20px rgba(0,0,0,0.8), 0 0 0 1px #1d2230` | `0 24px 60px -24px rgba(18,20,28,0.3), 0 0 0 1px #e2e4ee` |
| `--glow` | `none` | `none` |

Colour meaning: purple and blue are the product; green, amber and red appear only for status (fine, at risk, late or
failed). No other hues anywhere. The only glow in the product is on the flow map streams (section 5).

## 2. Type (`src/app/layout.tsx`, `next/font/google`)

- **Plus Jakarta Sans** (600, 700): page titles, card titles, every large number. Variable `--font-display`.
- **Inter** (400, 500, 600): all other text and all table figures (`font-variant-numeric: tabular-nums`). `--font-sans`.
- **Geist Mono** (400, 500): only SKUs, order IDs, ticket IDs and VR-N numbers. `--font-mono`.
Remove Manrope and Unbounded.

| Role | Font | Size / line | Weight | Colour |
|---|---|---|---|---|
| Page title | Plus Jakarta Sans | 28 / 34 (phone 22 / 28) | 700, letter-spacing -0.02em | `--ink` |
| Page subtitle (the old headline sentence) | Inter | 14 / 20 | 400; numbers inside 600 | `--muted`; numbers `--ink`, or the tone colour when late or low |
| KPI number | Plus Jakarta Sans | 26 / 30 | 700, -0.02em | `--ink` |
| Card title | Plus Jakarta Sans | 16 / 22 | 600 | `--ink` |
| Body, table cell | Inter | 13 / 19 | 400 (figures 500) | `--ink` |
| Caption | Inter | 12 / 16 | 400 | `--muted` |
| Label (above numbers, table headers) | Inter | 12 / 16 | 500, sentence case, no letter-spacing | `--muted` |
| Chip | Inter | 11 / 14 | 600 | by tone |

No uppercase labels anywhere. No hero number: the 76 px figure from the glass build is removed.

## 3. Layout

Content max width 1440 px. Page padding 28 px (≥1100), 16 px (700–1099), 12 px (<700). Grid 12 / 6 / 1 columns, gap
14 px. Card padding 18 px (phone 14 px). Table rows 46 px. Controls 44 px tall.

## 4. Components (change the existing ones in place)

- **Card**: background `--surface`, border 1px `--line`, radius `--radius-lg`, no shadow, no blur.
- **Item row** (rows inside queue, alert and list cards; replaces the old "tone rows" and their left colour bar):
  background `--surface2`, border 1px `--line`, radius 12 px, padding 10 px, 8 px gap between rows. Grid: a 38 px icon
  badge, then title (13 px 600, one line, ellipsis) over detail (caption, one line), then on the right either a status
  pill or a 40 px secondary button. No left bar.
- **Icon badge**: square 38 px (46 px in KPI cards), radius 11 px (13 px in KPI cards), icon 18 px (22 px), stroke 1.8.
  Five tints: violet (`--accent-soft` / `--accent-text`), blue (`--cyan-soft` / `--info`), green (`--ok-soft` / `--ok`),
  amber (`--warn-soft` / `--warn`), red (`--bad-soft` / `--bad`).
- **KPI card** (replaces `Stat`; a row of them replaces every `StatStrip`): a Card with 16 px padding: icon badge 46 px
  on the left; right of it the Label, the KPI number, then one context line (12 px, `--muted`, or a tone colour when it
  states a problem). A sparkline, where the stat had one, sits at the far right, 72 × 28 px. KPI row: 4 per row ≥1100 px,
  2 per row 700–1099 px, and under 700 px a sideways scroll-snap row with each card 78% wide. Icon and tint by meaning:

  | Stat is about | Icon | Tint |
  |---|---|---|
  | orders, dispatch, units, stock units | box | violet |
  | on time, late, due, pickup | clock | amber when the value is a problem, else blue |
  | out of stock, low stock, weight alerts, price problems | warning triangle | amber |
  | tickets | ticket | green |
  | money: sales, revenue, profit, cost, fees, value | rupee | violet |
  | ads | megaphone | blue |
  | returns, cancellations | return arrow | amber |
  | reviews | star | violet |
  | people, attendance | users | blue |
  | forecast, trends, targets | trend line | blue |

  Use the icons in `src/components/icons.tsx`; add any that are missing there, in the same 24 px stroke style, from
  the paths in section 15.
- **Buttons** (44 px tall, radius 12 px, Inter 13 px 600, padding 0 18 px): primary `--accent` with `--accent-ink`
  text, hover brightness 1.08; secondary `--panel2`, no border, `--ink` text; ghost: no background, `--accent-text`;
  danger `--bad-soft` with `--bad` text. Row action buttons are secondary, 40 px tall, 12 px text.
- **Chip / status pill**: height 24 px, radius 8 px, padding 0 9 px, tone `-soft` background, tone text, no border.
  Neutral: `--panel2` and `--muted`.
- **Inputs**: 44 px tall, background `--surface2`, border 1px `--line`, radius 12 px; focus border `--accent`.
- **Segmented control and tabs**: container `--surface2`, radius 12 px, padding 3 px; options 36 px tall, radius 9 px,
  `--muted`; active option background `--accent-soft`, text `--ink`.
- **Tables**: in a Card with no padding. Header: Label style, bottom border 1px `--line`, background `--surface`,
  sticky. Rows 46 px, divided by 1px `--line-soft`, hover `--panel2`. Figures right-aligned, Inter tabular.
- **Popovers, sheets, palette, tooltips**: `--pop`, border 1px `--line`, radius 18 px, `--shadow-pop`. No blur.
- **Skeletons, empty states, toasts, scrollbars, toolbars**: as on `ui/glass`, with the new tokens.

## 5. The flow map (replaces the `Lanes` component everywhere it is used)

File `src/components/signal/lanes.tsx` keeps its name and props; its drawing is replaced by this.

- **Header row**, grid `128px 1fr 1fr 1fr 150px`, 10 px column gap, bottom border 1px `--line`: "Warehouse" (Label);
  then for To accept, To pack, To dispatch: the Label centred with the total for that stage under it (Plus Jakarta
  Sans 20 px 700); then "Next pickup" (Label, right-aligned).
- **One row per warehouse**, same grid, min-height 64 px, bottom border 1px `--line`, the whole row a link with its
  current tap behaviour:
  - Column 1: 9 px dot in the warehouse colour, name (15 px 600). Under it a caption: "N% on time · N active · N out"
    (and on Flipkart Orders the existing "Upcoming N · Processing N · In transit N · N on hold" as a second caption).
  - Columns 2–4: the count for that stage in a chip: min-width 58 px, padding 6 px 12 px, radius 10 px, background
    `--surface2`, border 1.5px in the warehouse colour, Plus Jakarta Sans 17 px 700, centred in its column.
  - Behind the chips: one stream line from the centre of column 2 to the centre of column 4, vertically centred,
    fully rounded, in the warehouse colour at 90% opacity, `box-shadow: 0 0 18px` of that colour at 40%. Its height is
    `max(2, round(18 × this warehouse's active orders ÷ the largest warehouse's active orders))` px.
  - On the stream, a 2 px line of moving dots: `repeating-linear-gradient(90deg, rgba(255,255,255,0.75) 0 4px,
    transparent 4px 30px)`, animated with `background-position` from 0 to 30 px over 1.1 s, linear, infinite.
  - Column 5, right-aligned: next pickup time (15 px 600); under it the state in 12 px: "All on time" in `--ok`,
    "Due soon" in `--warn`, "N late · how late" in `--warn` 600, "Nothing waiting" in `--muted`.
  - A warehouse with nothing active: stream 2 px in `--line`, no dots, chip text `--muted`.
- **Footer line**: caption left "Orders move left to right. A thicker line means more orders."; right the totals the
  old component showed (active, and any other total it had).
- **Under 700 px** each warehouse becomes a block: line 1 name and state; line 2 the three chips in a row, each with
  its stage name as a Label above it, the stream behind them; line 3 the captions and next pickup.
- Reduced motion: the dots do not move.

## 6. Charts

Gridlines `--grid`; axis labels Inter 11 px `--faint`. Series colour `--wh-1` (`#8b7bff`), second series `--cyan`.
- **TrendChart ("Orders a day", any per-day series with an average)**: bars for each day (series colour at 55%
  opacity, radius 4 px, the latest day at 100%), with the trend line over them 2 px in `--stage-3`, a 4 px `--ink` dot
  on the latest point, and the average as a 1px dashed `--muted` line.
- **AreaChart**: 2 px line in the series colour, fill from that colour at 22% to 0%. No drop-shadow.
- **Sparkline**: 1.6 px line in the series colour, no fill.
- **Bars, ShareBar, StackedRows, PairedRows, gauges, rings**: as on `ui/glass`, tracks `--surface2`, values in the
  series or tone colour, no gradients, no glow.

## 7. Motion

As glass-spec.md section 6, with these changes: remove the hero number; add the flow map dots (section 5) to the short
list of allowed loops. Everything else unchanged, including the reduced-motion rule.

## 8. App shell

- **Rail** (≥1100 px): 228 px, background `--surface2`, right border 1px `--line`, sticky full height, padding 22 px
  16 px. Mark: 30 px square, radius 9 px, `--accent`, "VR" in Plus Jakarta Sans 12 px 700 `--accent-ink`; then
  "VR Prime Ops" 16 px 700. Items 44 px tall, radius 11 px, icon 18 px, label 14 px, `--muted`; hover `--panel2`;
  active background `--accent-soft`, text `--ink` 600. No group headings: a 14 px gap separates the three groups
  (Command Centre, Dashboard, Business, Work board, Tickets, Team / Flipkart, Forecast, Ads tracker, Review tracker /
  P&L, People, Settings). "Command Deck" is renamed "Command Centre" in the rail, the page title and the palette.
  At the bottom of the rail, one Card (padding 14 px, radius 14 px, background `--surface`): "Sync status" with an 7 px
  dot (green when the last order read succeeded, amber when it failed or is over 3 hours old), a line "All syncs
  healthy" in `--ok` or "Orders sync needs a look" in `--warn`, the caption "Orders read N ago · scope", and for owner
  and admin the Sync now button (secondary, 36 px tall, full width). This card uses the data the top bar shows today.
- 700–1099 px: rail 72 px, icons only, tooltips; the sync card becomes just its dot with a tooltip.
- **Top bar**: 64 px, background `--canvas`, no border. Search pill (420 px max, `--surface`, border `--line`, "Ctrl K"
  hint), spacer, today's date and time with a 7 px green dot, + Post (primary), bell, avatar 34 px with name (13 px
  600) and role (11 px `--muted`). The sync status and Sync now leave the top bar (they are in the rail card); on
  phones they stay where `ui/glass` put them.
- **Bottom bar** (<700 px): as on `ui/glass`, background `--pop`, top border `--line`, no blur.
- **Page header** (every page): title left with the subtitle under it; the page's main action as a primary button on
  the right, other actions secondary beside it.

## 9. Pages

Every page keeps its `ui/glass` layout (glass-spec.md section 8) with these substitutions everywhere: StatStrip →
KPI row; lanes → flow map; tone rows → item rows; hero card → an ordinary Card; headline sentence → page subtitle.
The pages below also change layout.

### 9.1 Command Centre `/`
1. Header: title "Command Centre"; subtitle = the headline sentence; buttons "Open priority queue" (primary), "Jump
   to Flipkart" (secondary). Notes line and push banner under it as before.
2. KPI row of four: **To dispatch today** (the due count; context line: the capacity sentence for owner and admin,
   else "across N warehouses"; the late Chip beside the label), **Late dispatch**, **Out of stock**, **Due tomorrow**
   (these three are the pulses, with their sparklines and links).
3. **Flow map** Card, 8 cols, title "Order flow map" with a "Live" pill (6 px green dot, opacity loop 2 s).
   Right, 4 cols, stacked: **Orders and stock** queue Card (first 4 item rows, "View all" expands in place);
   **Orders pulse** Card (title, "N yesterday" KPI number, the TrendChart, then a 3-cell row: Yesterday, 7-day avg,
   Busiest).
4. **Work and tickets** 4 cols (item rows; "N open tickets" pill in the header); **Stock by warehouse** 4 cols;
   **Stock health** 4 cols as five list rows (Label left, number right in Plus Jakarta Sans 18 px 700, 72 px sparkline),
   each a link.
5. **Dispatch, last 7 days** 5 cols; **Forecast, top movers** 7 cols.

### 9.2 Dashboard `/dashboard`
1. Header: greeting as title; the existing summary sentence as subtitle; month Chip right.
2. KPI row of four: Profit after ads (context: margin, previous month, "On pace for …"), Revenue, Ads incl. GST,
   To dispatch today. The share bar and gauge those tiles had sit under their context lines.
3. Pulses KPI row. 4. Orders a day 7 cols; Where the money went 5 cols. 5. Month by month 7 cols; Products by profit
   5 cols. 6. Flow map 8 cols; Needs a look 4 cols (item rows).

### 9.3 Flipkart
First-level tabs become Today, Stock, Listings, Returns as now; second-level tabs as now plus two new ones: **Listing
check** in Listings (section 12.3) and **To claim** in Returns (section 12.2). Needs action sections use item rows.

### 9.4 Every other page
Layout as on `ui/glass`, components swapped as above. New pages: Business (12.1) and Closing report (12.4).

---

# PART B. SPEED

## 10. Faster pages

1. **No blur**: section 1 already removes every `backdrop-filter`.
2. **Short cache** for the heavy read-only loaders. New file `src/server/short-cache.ts` exporting
   `shortCache<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T>`: a module-level `Map` of key →
   `{ at, promise }`; returns the stored promise when it is younger than `ttlMs`, otherwise calls `load`, stores and
   returns it; a rejected promise is removed at once; the map never holds more than 500 keys (drop the oldest). Also
   `clearShortCache(): void`. Every key starts with the signed-in user's id so one user never sees another's data.
   Wrap exactly these, each with a 30 000 ms lifetime, key = user id + function name + JSON of its arguments:
   `loadOrderCounts`, the `team_order_load`, `deck_series` and `dispatch_series` calls, `loadStockDesk`, `loadEmpties`,
   `loadCover`, `loadReturnRates`, `loadTeamCapacity`, and the Dashboard's and P&L's money loaders in
   `src/server/dashboard-data.ts` and `src/server/pnl-data.ts`. Do not cache posts, tickets, notifications, settings,
   users or anything a form writes. Call `clearShortCache()` at the end of every server action that starts a sync or
   uploads a report.
3. **Router cache**: read the Next.js guide on `staleTimes` in `node_modules/next/dist/docs/`. If this version
   documents it, set `experimental.staleTimes.dynamic` to `30` in `next.config.ts`. If it does not, skip it and log it
   in `graphite-gaps.md`.
4. **Skeletons**: every route under `src/app/(app)/` has a `loading.tsx` that draws the page header and grey blocks in
   the shape of that page's first screen (KPI row, then two cards), using the Skeleton style.
5. **Measure**: before step 2 and after step 4, time `loadDeck` and the Dashboard loader five times each on the local
   dev server (`performance.now()` around the call, logged to the server console), and put the ten numbers in the
   report. Remove the timing code afterwards.

Numbers on every page must be identical before and after. Do not change any query or calculation for speed.

---

# PART C. NEW FEATURES

## 11. Rules for all five

- **Do not apply migrations and do not run SQL against the database.** The local site reads the live business
  database. Write each migration as a file in `supabase/migrations/` (names given below), write the code against it,
  and test the screens with fake data in `/dev/preview`. VRPRIME applies and checks the migrations afterwards.
- Do not deploy any Edge Function.
- Every new table has Row Level Security on, with the policies stated. Use the helpers that exist:
  `private.is_staff()` (owner or admin), `private.user_role()`, and the `user_warehouses` table for the warehouse role.
- Every new notification is created with `private.notify_user(user, kind, title, body, null, null)`, the way
  `private.alerts_stock()` does it, so the bell and push work unchanged. Add each new kind to: the `kind` check on
  `public.notifications` if one exists, the `NotificationKind` type in `src/lib/types.ts`, the labels in
  `src/lib/labels.ts`, `notificationUrl` in `src/lib/notifications.ts`, and the matching link rule in
  `supabase/functions/notify/index.ts`.
- Pure calculations go in `src/lib/` with unit tests (`*.test.ts`); screens get a `/dev/preview` view and fixtures.
- All dates are India time (Asia/Kolkata). Money shows as rupees in the existing format helpers.

## 12.1 Business page `/business` (owner only)

Route `src/app/(app)/business/page.tsx`; non-owners get the existing owner-only notice. Rail item "Business" (icon:
bars) after Dashboard, owner only. Tabs by `?tab=`: `week` (default), `targets`, `dead`.

**Migration `20261116090000_business.sql`:**
- `private.business_week_data(p_start date, p_days integer) returns jsonb`, `security definer`, `search_path ''`.
  For the dates `p_start` to `p_start + p_days - 1`, `platform = 'flipkart'`, it returns one object with:
  - `orders`: `count(distinct order_id)` from `fk_order_items` where `order_day` is in range and `stage <> 'cancelled'`
  - `units`: `sum(coalesce(quantity, 1))`, same rows
  - `sales`: `sum(selling_price)`, same rows, where `selling_price is not null`
  - `cancelled`: `count(distinct order_id)` where `stage = 'cancelled'` and `(cancelled_at at time zone
    'Asia/Kolkata')::date` is in range; also `cancelled_by`: the same count grouped by `cancel_type`
  - `returns_customer`, `returns_courier`: `sum(coalesce(quantity, 1))` from `fk_returns` where `created_date` is in
    range and `return_status <> 'cancelled'`, by `source`
  - `dispatched_units`: `sum(units)` from `dispatch_daily` where `dispatch_day` is in range
  - `late`: `count(distinct order_id)` from `fk_order_items` where `(alerted_at at time zone 'Asia/Kolkata')::date`
    is in range
  - `ad_spend`: `round(sum(spend) * 1.18, 2)` from `ad_daily` where `day` is in range; and `ads_read_to`: `max(day)`
    in `ad_daily`
  - `by_product`: an array of `{id, name, units}`: units per master product, joining `sku_master` on
    `channel_sku = sku` and multiplying by `units_per_order`; SKUs with no master are their own entry with
    `id = null` and `name = sku`
- `public.business_week(p_start date, p_days integer) returns jsonb`: raises unless `private.user_role() = 'owner'`;
  returns `{cur: business_week_data(p_start, p_days), prev: business_week_data(p_start - 7, p_days)}`. Execute granted
  to `authenticated` only.

**This week tab.** A week runs Monday to Sunday. Default: the current week, compared up to today against the same
number of days of the week before (`p_days` = days so far including today). Previous and next arrows move by one week;
a finished week uses 7 days. `src/lib/business.ts` holds: the week start for a date, `p_days`, the change and percent
for a pair of numbers, and which direction is good (up is good for orders, units, sales, dispatched units; down is
good for cancelled, both returns, late; ad spend has no good direction).
Screen: subtitle sentence "Orders are up N% on last week; sales ₹X against ₹Y." (or "down"). Then one Card with a
table: rows Orders, Units, Sales (seller price), Dispatched units, Cancelled, Customer returns, Courier returns,
Orders flagged late, Ads incl. 18% GST. Columns: This week, Last week, Change (signed number and percent; `--ok` when
the direction is good, `--bad` when it is bad, `--muted` when neutral or under 1%), and a pair of thin bars comparing
the two values. Under the ads row a caption "Ads report read up to <date>". Then two Cards side by side, "Rising" and
"Falling": the five products with the largest increase and the five with the largest fall in units against the week
before (ignore products under 5 units in both weeks), as item rows: name, "N units, was M", a signed pill.

**Targets tab.** Two new settings, owner-editable, in a new "Targets" Card on the Settings page:
`target_sales_month` and `target_profit_month` (whole rupees, 0 or more, blank means not set). Add both keys to
`SETTING_KEYS` and to the settings validation. The targets apply to every month.
The tab takes this month's revenue, profit after ads and "on pace for" figure from the same loader the Dashboard
uses, so the numbers match the Dashboard exactly. For Sales and for Profit, one Card each: target; so far; percent of
target; a progress bar (track `--surface2`, fill `--accent`) with a 2 px `--ink` marker at where today should be
(`target × day of month ÷ days in month`); "On pace for ₹X: ahead by ₹Y" in `--ok` or "behind by ₹Y" in `--warn`;
and "Needs ₹Z a day for the N days left" (`max(0, target − so far) ÷ days left including today`). A third Card shows
the last four months' actual sales and profit as bars with the target as a dashed line. With no target set, the Card
shows an empty state with a link to Settings.

**Dead stock tab.** Uses the per-product figures the Forecasting tab's "By product" table already computes with the
30-day window (stock now, average a day, days of cover, stock by warehouse), plus `master_costs.cost`. For a kit use
its own stock, not what can be made.
- Dead: stock above 0 and nothing dispatched in the last 30 days.
- Slow: stock above 0, something dispatched, and more than 90 days of cover.
`src/lib/dead-stock.ts` classifies and totals. Screen: KPI row (Dead stock value, Dead products, Slow stock value,
Products with no cost entered); segmented control Dead / Slow; toolbar with search and CSV; table: Product (code,
name), Stock, By warehouse (chips), Sold in 30 days, Days of cover, Cost a unit, Value (stock × cost; a "No cost"
Chip when missing, sorted last), sorted by value, largest first.

## 12.2 Returns to claim (Flipkart › Returns › "To claim", all roles)

**Migration `20261116091000_return_checks.sql`:**
- Setting `return_claim_days`, default `7`, added to `app_settings`, `SETTING_KEYS`, validation, and the Settings
  page's "Flipkart page" Card ("Days to claim a return").
- `alter table public.tickets add column return_id text`.
- Table `public.return_checks`: `platform text`, `return_id text`, `order_item_id text`, `outcome text check (outcome
  in ('ok','ticket'))`, `ticket_id uuid references public.tickets(id) on delete set null`, `checked_by uuid`,
  `checked_at timestamptz default now()`, primary key `(platform, return_id, order_item_id)`. RLS on; select allowed
  when the matching `fk_returns` row is visible to the caller (same test as that table's select policy); no direct
  insert, update or delete.
- `public.return_check_ok(p_return_id text, p_order_item_id text) returns void`, `security definer`: checks the
  caller can see that return, then inserts an `'ok'` row (do nothing if one exists).
- `public.returns_to_claim() returns jsonb`, `security invoker`: rows of `fk_returns` with `platform = 'flipkart'`,
  `return_status = 'completed'`, `(updated_date at time zone 'Asia/Kolkata')::date >= today − 30`, and no
  `return_checks` row; each with `days_left = return_claim_days − (today − that date)`.

**Screen.** KPI row: To check (days left 0 or more), Closing today or tomorrow (days left 0 or 1), Missed (days left
below 0), Checked this week. Segmented control: To check (default) / Missed. Toolbar: warehouse, type (courier,
customer), search, CSV. Table sorted by days left, fewest first: Days left (Chip: `--bad` at 0 or 1, `--warn` at 2
or 3, neutral above, "Missed" in `--bad` below 0), Returned (date), SKU, Type, Reason, Qty, Warehouse, Order ID, and
two row actions: **Looks fine** (secondary; calls `return_check_ok`, the row leaves the list, toast "Marked as
checked") and **Raise ticket** (primary).
Raise ticket opens the existing new-ticket form with `?return=<return_id>&item=<order_item_id>` added to the
parameters the Returns tab already sends. The form carries both as hidden fields; the create-ticket server action
saves `tickets.return_id` and inserts the `'ticket'` row in `return_checks` with the new ticket's id (through a
`security definer` function `public.return_check_ticket(p_return_id, p_order_item_id, p_ticket uuid)` in the same
migration). The same parameters are added to the "Raise ticket" button in the All returns table.
The tab label shows the To check count.

## 12.3 Listing check (Flipkart › Listings › "Listing check", owner and admin)

Flipkart refuses the website's server, so this runs on the owner's PC like the review counter.

**Migration `20261116092000_listing_check.sql`:** tables `public.listing_checks` (`id uuid pk default
gen_random_uuid()`, `checked_on date unique`, `created_at timestamptz default now()`) and `public.listing_check_rows`
(`check_id uuid references listing_checks on delete cascade`, `row_no integer`, `status text check (status in
('buyable','out_of_stock','unavailable','not_read'))`, `price numeric`, `expected_price numeric`, primary key
`(check_id, row_no)`); RLS on, select for `private.is_staff()` only. `public.listing_check_save(p_day date, p_rows
jsonb) returns jsonb`, `security definer`, callable by `service_role` and by staff: creates or reuses the check for
`p_day`; for each `{row_no, status, price}` upserts the row, except that a `'not_read'` never replaces a row already
saved today with another status; sets `expected_price` to the latest `stock_prices.selling_price` for that link's
`sku` (null for Shopsy links); then, comparing with the previous check, counts links that were buyable (or had no
row) and are now out of stock or unavailable, and links whose price newly differs by ₹1 or more from
`expected_price`; if that count is above 0 it notifies every active owner and admin once: kind `listing_alert`,
title "N listings need a look", body the first five product names. `notificationUrl` for `listing_alert` is
`/flipkart?tab=listingcheck`.

**Script `scripts/listing-check.mts`**, modelled line for line on `scripts/review-counter.mts` (same settings, same
two ways to save, same log file pattern, `--dry-run` and `--links`): reads the active `review_links`, requests each
link's product page (the listing address, not its reviews page) one at a time with a 2-second pause, and saves through
`listing_check_save`. A site that refuses is left `not_read` for the run, as the counter does.
**Parser `src/lib/listing-check.ts`**: `readListing(html: string): { status, price }`. To write it: run the script
with `--dry-run` on the PC against five Flipkart links, save the pages to a scratch folder outside the repo, and find
in them (a) the selling price shown to the buyer and (b) the text or button state that shows the product can be
bought, is sold out, or is unavailable. Rules: `buyable` when the page has a price and its buy or add-to-cart control
is enabled; `out_of_stock` when the page says sold out, out of stock or currently unavailable; `unavailable` when the
page loads but has no product (removed, not found); `not_read` for anything else, including a blocked request. Unit
tests use short trimmed snippets of those pages, never whole pages. If the PC cannot reach Flipkart during the build,
write the parser against the same markers `src/lib/review-count.ts` relies on for recognising a product page, mark
the price and stock detection as unverified in the report, and leave the tests for them as `todo`.
**`scripts/install-listing-check.ps1`**, modelled on `install-review-counter.ps1`: a daily Windows task at 09:15. Do
not run it; the report tells VRPRIME to.

**Screen.** KPI row: Buyable, Out of stock, Unavailable, Price differs, Not read. Caption "Read on the PC each
morning · last read <date>". Segmented control Problems (default) / All. Table: Product, Platform, Priority, Status
(Chip: green, amber, red, neutral), Price on page, Our price, a "Differs" Chip, and "Open" (opens the listing in a
new tab). Empty state before the first check: "No check yet. Install the PC task to start."

## 12.4 Closing report (`/reports/closing`, all roles)

**Migration `20261116093000_closing_report.sql`:** table `public.closing_reports` (`day date`, `warehouse_id uuid
references public.warehouses`, `dispatched_units integer`, `dispatched_orders integer`, `pending_today integer`,
`late_now integer`, `pending_total integer`, `present integer`, `half_day integer`, `absent integer`, `on_leave
integer`, `not_marked integer`, `returns_to_check integer`, `created_at timestamptz default now()`, primary key
`(day, warehouse_id)`); RLS on; select for staff, and for the warehouse role only rows of their warehouses.
`private.closing_report() returns void`: for today, per warehouse, upserts:
- `dispatched_units`: `sum(units)` in `dispatch_daily` for today
- `dispatched_orders`: `count(distinct order_id)` in `fk_order_items` with `stage = 'dispatched'` and
  `(dispatch_by at time zone 'Asia/Kolkata')::date = today`
- `pending_today`: `count(distinct order_id)` with `stage = 'pending'`, `not hold`, dispatch date today or earlier
- `late_now`: the same with `dispatch_by < now()`
- `pending_total`: `count(distinct order_id)` with `stage = 'pending'` and `not hold`
- attendance: active `staff` of the warehouse by today's `attendance.status`; staff with no mark are `not_marked`
- `returns_to_check`: that warehouse's count from `returns_to_claim()` with days left 0 or more
Then it notifies. Owners and admins get one notification: kind `closing_report`, title "Closing report · 15 Nov",
body one line per warehouse: "Bangalore: 412 units out, 3 pending, 1 late, 1 absent". Each warehouse-role user gets
the same with only their warehouses' lines. `notificationUrl` for `closing_report` is `/reports/closing`.
Schedule: `select cron.schedule('closing-report', '20 16 * * *', 'select private.closing_report()')` (21:50 India
time, after the last order read of the day).

**Screen.** Title "Closing report", subtitle the date; previous and next day arrows; one table: Warehouse, Units out,
Orders out, Pending for today, Late now, Pending in all, Present, Half day, Absent, On leave, Not marked, Returns to
check; a totals row. Late and Absent figures above 0 are in `--warn`. A day with no report: "No closing report for
this day." A secondary button "Closing report" in the Team page header links here.

## 12.5 Weekly summary message

In migration `20261116094000_weekly_summary.sql`: `private.weekly_summary() returns void`: takes
`business_week_data` for the week that ended yesterday (7 days from last Monday) and for the week before, and
notifies every active owner: kind `weekly_summary`, title "Last week: N orders, up X%" (or "down X%"), body "Sales
₹A (±B%) · Returns C · Cancelled D · Flagged late E". Schedule: `select cron.schedule('weekly-summary', '30 3 * * 1',
'select private.weekly_summary()')` (Mondays 9:00 India time). `notificationUrl` for `weekly_summary` is
`/business?tab=week&start=<that Monday>`; the page reads `start` and opens that week.

---

# PART D. RULES

## 13. What must not change

Existing numbers, links, role visibility, filters, sort orders, `?tab=` addresses, form fields and what every existing
button does. Flipkart stays read-only: nothing in this build writes to Flipkart. No buyer personal data. Money and
cost data stay owner-only. No new dependencies. Outside Part B and Part C, nothing in `supabase/`, `src/server/`, API
routes, `src/proxy.ts`, auth or the calculations in `src/lib` changes.

## 14. When this document does not cover something

1. Use the closest component in sections 4 to 6 with its values unchanged, and the layout rule in section 3.
2. For a feature detail, follow the nearest existing feature named in that section (review counter, alerts_stock,
   Returns tab, Forecasting tab) exactly.
3. Never invent a colour, size, font, animation, column, formula or rule. Never ask.
4. Log each case as one line in `docs/ui-overhaul/graphite-gaps.md`: what, where, which rule you applied.

## 15. Icon paths (24 px viewBox, stroke 1.8, round caps and joins, no fill)

- box: `M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8`
- clock: `M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2`
- warning triangle: `M12 3l9 16H3zM12 10v4M12 17v.5`
- ticket: `M3 8a2 2 0 012-2h14a2 2 0 012 2v2a2 2 0 000 4v2a2 2 0 01-2 2H5a2 2 0 01-2-2v-2a2 2 0 000-4z`
- rupee: `M7 5h10M7 9h10M7 5c5 0 5 8 0 8l7 7`
- megaphone: `M3 11v2a1 1 0 001 1h3l5 4V6L7 10H4a1 1 0 00-1 1zM16 9a4 4 0 010 6`
- return arrow: `M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3`
- star: `M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z`
- users: `M16 19v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 10a3 3 0 100-6 3 3 0 000 6zM21 19v-1a4 4 0 00-3-3.8M15.5 4.2a3 3 0 010 5.6`
- trend line: `M3 17l6-6 4 4 8-8M15 7h6v6`
- bars: `M4 20V10M10 20V4M16 20v-7M22 20H2`
